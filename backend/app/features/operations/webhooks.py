"""Replayable processing of verified, persisted Razorpay events."""

import logging
from datetime import timedelta
from urllib.parse import quote
from uuid import uuid4

from sqlalchemy import or_, update

from app.infrastructure.database import tables, utcnow
from app.features.booking.service import fetch_record
from app.features.payments.gateway import provider
from app.features.payments.refunds import execute_refund
from app.features.payments.service import verify_payment

logger = logging.getLogger(__name__)


async def process_webhook(db, stored):
    table = tables["WebhookEvent"]
    now, lease_owner = utcnow(), str(uuid4())
    claimed = await db.execute(
        update(table)
        .where(
            table.c.id == stored["id"],
            table.c.status.in_(("RECEIVED", "FAILED", "PROCESSING")),
            or_(table.c.leaseExpiresAt.is_(None), table.c.leaseExpiresAt <= now),
        )
        .values(
            status="PROCESSING",
            leaseOwner=lease_owner,
            leaseExpiresAt=now + timedelta(seconds=30),
            attempts=table.c.attempts + 1,
            processingStartedAt=now,
        )
    )
    await db.commit()
    if claimed.rowcount != 1:
        return {"received": True, "duplicate": True}
    try:
        event = stored["payload"]
        event_type = stored["eventType"]
        entity = event.get("payload", {}).get("payment", {}).get("entity", {})
        outcome = "IGNORED"
        if event_type in ("payment.captured", "order.paid", "payment.authorized"):
            if not entity.get("order_id"):
                order = event.get("payload", {}).get("order", {}).get("entity", {})
                items = (
                    await provider("GET", f"orders/{quote(order.get('id', ''), safe='')}/payments")
                    if order.get("id")
                    else {}
                )
                entity = next((p for p in items.get("items", []) if p.get("status") == "captured"), {})
            payment_record = await fetch_record(
                db, tables["Payment"], tables["Payment"].c.razorpayOrderId == entity.get("order_id")
            )
            if not payment_record:
                outcome = "RECEIVED"  # Provider may beat local order linkage.
            elif entity.get("id"):
                verified = await verify_payment(
                    db,
                    user_id=payment_record["userId"],
                    payment_id=entity["id"],
                    order_id=payment_record["razorpayOrderId"],
                    trusted=True,
                )
                outcome = "RECEIVED" if verified.get("status") == "PENDING_CAPTURE" else "PROCESSED"
        elif event_type == "payment.failed":
            payment_record = tables["Payment"]
            await db.execute(
                update(payment_record)
                .where(
                    payment_record.c.razorpayOrderId == entity.get("order_id"),
                    payment_record.c.status.not_in(("SUCCESS", "REFUNDED", "REFUND_PENDING")),
                )
                .values(status="FAILED", updatedAt=utcnow())
            )
            # Keep the order retryable while its reservation is alive.
            outcome = "PROCESSED"
        elif event_type.startswith("refund."):
            entity = event.get("payload", {}).get("refund", {}).get("entity", {})
            refund_record = await fetch_record(
                db, tables["Refund"], tables["Refund"].c.razorpayRefundId == entity.get("id")
            )
            if not refund_record and entity.get("payment_id"):
                payment_record = await fetch_record(
                    db, tables["Payment"], tables["Payment"].c.razorpayPaymentId == entity["payment_id"]
                )
                refund_record = (
                    await fetch_record(
                        db, tables["Refund"], tables["Refund"].c.paymentId == payment_record["id"]
                    )
                    if payment_record
                    else None
                )
                if refund_record:
                    # Enforce exact amount and currency binding before linking refund
                    entity_amount = entity.get("amount")
                    entity_currency = entity.get("currency")
                    if entity_amount is not None and entity_amount != refund_record["amount"]:
                        logger.warning(
                            "Webhook refund amount mismatch: %s != %s for refund %s",
                            entity_amount,
                            refund_record["amount"],
                            refund_record["id"],
                        )
                        refund_record = None
                    elif entity_currency and entity_currency != refund_record["currency"]:
                        logger.warning("Webhook refund currency mismatch for %s", refund_record["id"])
                        refund_record = None
                    elif not refund_record.get("razorpayRefundId"):
                        await db.execute(
                            update(tables["Refund"])
                            .where(tables["Refund"].c.id == refund_record["id"])
                            .values(razorpayRefundId=entity["id"])
                        )
            if refund_record:
                await execute_refund(db, refund_record["id"])
                outcome = "PROCESSED"
            else:
                outcome = "RECEIVED"
        await db.execute(
            update(table)
            .where(table.c.id == stored["id"], table.c.leaseOwner == lease_owner)
            .values(
                status=outcome,
                processedAt=utcnow() if outcome != "RECEIVED" else None,
                leaseOwner=None,
                leaseExpiresAt=None,
                nextAttemptAt=utcnow() + timedelta(seconds=30) if outcome == "RECEIVED" else None,
            )
        )
        await db.commit()
        return {
            "received": True,
            "processed": outcome == "PROCESSED",
            "pendingLinkage": outcome == "RECEIVED",
        }
    except Exception:
        logger.exception("Webhook processing failed for %s", stored["id"])
        await db.rollback()
        await db.execute(
            update(table)
            .where(table.c.id == stored["id"], table.c.leaseOwner == lease_owner)
            .values(
                status="FAILED",
                processingError="Webhook processing failed",
                leaseOwner=None,
                leaseExpiresAt=None,
                nextAttemptAt=utcnow() + timedelta(seconds=60),
            )
        )
        await db.commit()
        return {"received": True, "retryScheduled": True}
