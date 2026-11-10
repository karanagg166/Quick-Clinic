"""Durable, idempotent full-refund claims and provider reconciliation."""

import logging
import re
from datetime import timedelta
from urllib.parse import quote
from uuid import uuid4

import httpx
from fastapi import HTTPException
from sqlalchemy import select, update

from app.infrastructure.database import new_id, tables, utcnow
from app.features.booking.service import as_utc_datetime, fetch_record, insert_unique
from .gateway import provider

logger = logging.getLogger(__name__)


async def enqueue_refund(db, payment_record, reason):
    refund_table = tables["Refund"]
    # Reuse pre-migration refund keys as well as new keys. Serializing on Payment
    # prevents two cancellation/recovery paths from creating competing refunds.
    locked = await fetch_record(
        db, tables["Payment"], tables["Payment"].c.id == payment_record["id"], lock=True
    )
    if locked:
        payment_record = locked
    existing = (
        (
            await db.execute(
                select(refund_table)
                .where(refund_table.c.paymentId == payment_record["id"])
                .order_by(refund_table.c.createdAt)
            )
        )
        .mappings()
        .first()
    )
    if existing:
        await db.execute(
            update(tables["Payment"])
            .where(tables["Payment"].c.id == payment_record["id"])
            .values(
                status="REFUNDED" if existing["status"] == "PROCESSED" else "REFUND_PENDING",
                updatedAt=utcnow(),
            )
        )
        return dict(existing)
    key = f"refund:full:{payment_record['id']}"
    now = utcnow()
    refund_record = await insert_unique(
        db,
        refund_table,
        dict(
            id=new_id(),
            paymentId=payment_record["id"],
            amount=payment_record["amount"],
            currency=payment_record["currency"],
            reason=reason,
            status="PROCESSED" if payment_record["status"] == "REFUNDED" else "PENDING",
            idempotencyKey=key,
            processedAt=now if payment_record["status"] == "REFUNDED" else None,
            createdAt=now,
            updatedAt=now,
        ),
        refund_table.c.idempotencyKey == key,
    )
    if refund_record["status"] != "PROCESSED":
        await db.execute(
            update(tables["Payment"])
            .where(tables["Payment"].c.id == payment_record["id"], tables["Payment"].c.status != "REFUNDED")
            .values(status="REFUND_PENDING", updatedAt=now)
        )
    return refund_record


async def execute_refund(db, refund_id):
    refund_table, payment_table = tables["Refund"], tables["Payment"]
    refund_record = await fetch_record(db, refund_table, refund_table.c.id == refund_id, lock=True)
    if not refund_record or refund_record["status"] == "PROCESSED":
        return "REFUNDED" if refund_record else "FAILED"
    now, lease_owner = utcnow(), str(uuid4())
    if refund_record.get("leaseExpiresAt") and as_utc_datetime(
        refund_record["leaseExpiresAt"]
    ) > as_utc_datetime(now):
        return "REFUND_PENDING"
    payment_record = await fetch_record(
        db, payment_table, payment_table.c.id == refund_record["paymentId"], lock=True
    )
    await db.execute(
        update(refund_table)
        .where(refund_table.c.id == refund_record["id"])
        .values(
            status="PROCESSING",
            leaseOwner=lease_owner,
            leaseExpiresAt=now + timedelta(seconds=30),
            attempts=refund_table.c.attempts + 1,
            lastAttemptAt=now,
        )
    )
    await db.commit()
    try:
        provider_payment_id = quote(payment_record["razorpayPaymentId"] or "", safe="")
        if not provider_payment_id:
            outcome = None
        elif refund_record.get("razorpayRefundId"):
            outcome = await provider(
                "GET",
                f"payments/{provider_payment_id}/refunds/{quote(refund_record['razorpayRefundId'], safe='')}",
            )
        else:
            safe_key = re.sub(r"[^a-zA-Z0-9_-]", "_", refund_record["idempotencyKey"])[:40]
            outcome = await provider(
                "POST",
                f"payments/{provider_payment_id}/refund",
                payload=dict(amount=refund_record["amount"], notes=dict(reason=refund_record["reason"])),
                headers={"X-Refund-Idempotency": safe_key},
            )
        complete = outcome and outcome.get("status") == "processed"
        failed = outcome and outcome.get("status") == "failed"
        if outcome:
            provider_payment_out = outcome.get("payment_id")
            provider_amount = outcome.get("amount")
            provider_currency = outcome.get("currency")
            if provider_payment_out and provider_payment_out != payment_record["razorpayPaymentId"]:
                logger.error("Provider refund payment ID mismatch for %s", refund_record["id"])
                failed, complete = True, False
            elif provider_amount is not None and provider_amount != refund_record["amount"]:
                logger.error("Provider refund amount mismatch for %s", refund_record["id"])
                failed, complete = True, False
            elif provider_currency and provider_currency != refund_record["currency"]:
                logger.error("Provider refund currency mismatch for %s", refund_record["id"])
                failed, complete = True, False
        values = dict(
            status="PROCESSED" if complete else ("FAILED" if failed else "PENDING"),
            leaseOwner=None,
            leaseExpiresAt=None,
            updatedAt=utcnow(),
            nextAttemptAt=None if complete else utcnow() + timedelta(seconds=60),
        )
        if outcome:
            values["razorpayRefundId"] = outcome["id"]
        if complete:
            values["processedAt"] = utcnow()
            await db.execute(
                update(payment_table)
                .where(payment_table.c.id == payment_record["id"])
                .values(status="REFUNDED", updatedAt=utcnow())
            )
        await db.execute(
            update(refund_table)
            .where(refund_table.c.id == refund_record["id"], refund_table.c.leaseOwner == lease_owner)
            .values(**values)
        )
        await db.commit()
        return "REFUNDED" if complete else "REFUND_PENDING"
    except (httpx.HTTPError, HTTPException):
        logger.exception("Refund outcome unresolved for refund %s", refund_id)
        await db.execute(
            update(refund_table)
            .where(refund_table.c.id == refund_record["id"], refund_table.c.leaseOwner == lease_owner)
            .values(
                status="PENDING",
                leaseOwner=None,
                leaseExpiresAt=None,
                nextAttemptAt=utcnow() + timedelta(seconds=60),
                failureReason="Provider refund outcome unresolved",
            )
        )
        await db.commit()
        return "REFUND_PENDING"
