"""Bounded recovery for provider ambiguity, refunds, webhook replay and outbox."""

import logging
import time
from datetime import timedelta
from urllib.parse import quote
from uuid import uuid4

from sqlalchemy import func, or_, select, update

from app.infrastructure.database import tables, utcnow
from app.features.booking.service import CLEAR_HOLD, expire_holds, fetch_record, persist_side_effects
from app.features.payments.service import attach_order, verify_payment
from app.features.payments.gateway import provider
from app.features.payments.refunds import enqueue_refund, execute_refund

from .outbox import dispatch_outbox
from .webhooks import process_webhook

logger = logging.getLogger(__name__)


async def expire_appointments(db):
    appointment_table, slot_table, payment_table = (tables[n] for n in ("Appointment", "Slot", "Payment"))
    today = utcnow().date()
    rows = (
        (
            await db.execute(
                select(appointment_table)
                .join(slot_table, slot_table.c.id == appointment_table.c.slotId)
                .where(
                    appointment_table.c.status.in_(("PENDING", "CONFIRMED")),
                    slot_table.c.date < today,
                )
                .limit(50)
                .with_for_update(of=appointment_table, skip_locked=True)
            )
        )
        .mappings()
        .all()
    )
    result = dict(expired=0, refunded=0, refundFailed=0)
    refunds = []
    for appointment_record in rows:
        changed = await db.execute(
            update(appointment_table)
            .where(
                appointment_table.c.id == appointment_record["id"],
                appointment_table.c.status == appointment_record["status"],
            )
            .values(
                status="EXPIRED",
                updatedAt=utcnow(),
                notes=(appointment_record["notes"] or "") + " | Auto-expired: appointment date passed.",
            )
        )
        if not changed.rowcount:
            continue
        await db.execute(
            update(slot_table)
            .where(slot_table.c.id == appointment_record["slotId"])
            .values(status="AVAILABLE", **CLEAR_HOLD)
        )
        if appointment_record["status"] == "PENDING" and appointment_record["paymentMethod"] == "ONLINE":
            payment = (
                await fetch_record(db, payment_table, payment_table.c.id == appointment_record["paymentId"])
                if appointment_record["paymentId"]
                else None
            )
            if payment and payment["status"] == "SUCCESS":
                refunds.append(
                    (await enqueue_refund(db, payment, "Appointment expired before confirmation"))["id"]
                )
        await persist_side_effects(db, dict(appointment_record), "EXPIRED")
        result["expired"] += 1
    await expire_holds(db)
    await db.commit()
    for refund_id in refunds:
        status = await execute_refund(db, refund_id)
        result["refunded" if status == "REFUNDED" else "refundFailed"] += 1
    return result


async def reconcile(db):
    started = time.monotonic()
    results = dict(
        reconciledUnresolved=0,
        reconciledRefunds=0,
        reconciledPayments=0,
        reconciledCheckouts=0,
        replayedWebhooks=0,
        outboxDelivered=0,
        outboxFailed=0,
        errors=[],
    )
    checkout_table, refund_table, webhook_table = (tables[n] for n in ("Checkout", "Refund", "WebhookEvent"))
    now = utcnow()
    pending = (
        (
            await db.execute(
                select(checkout_table)
                .where(
                    checkout_table.c.status.in_(
                        ("UNRESOLVED", "PENDING_ORDER", "READY_FOR_PAYMENT", "EXPIRED")
                    ),
                    or_(checkout_table.c.leaseExpiresAt.is_(None), checkout_table.c.leaseExpiresAt <= now),
                    or_(checkout_table.c.nextAttemptAt.is_(None), checkout_table.c.nextAttemptAt <= now),
                )
                .order_by(checkout_table.c.createdAt)
                .limit(20)
            )
        )
        .mappings()
        .all()
    )
    for row in pending:
        if time.monotonic() - started >= 22:
            break
        worker_id = f"worker_{uuid4().hex[:12]}"
        # Atomically claim checkout lease
        claimed = await db.execute(
            update(checkout_table)
            .where(
                checkout_table.c.id == row["id"],
                or_(checkout_table.c.leaseExpiresAt.is_(None), checkout_table.c.leaseExpiresAt <= now),
            )
            .values(leaseOwner=worker_id, leaseExpiresAt=now + timedelta(seconds=30))
        )
        if not claimed.rowcount:
            continue
        await db.commit()

        try:
            record = dict(row)
            if not record.get("razorpayOrderId"):
                # Never issue a second order after an ambiguous creation response.
                orders = await provider(
                    "GET", "orders", params=dict(receipt=record["providerReference"], count=100)
                )
                matches = [
                    o for o in orders.get("items", []) if o.get("receipt") == record["providerReference"]
                ]
                if len(matches) == 1:
                    await attach_order(db, record, matches[0])
                    results["reconciledUnresolved"] += 1
                elif len(matches) > 1:
                    await db.execute(
                        update(checkout_table)
                        .where(checkout_table.c.id == row["id"])
                        .values(status="MANUAL_REVIEW", lastError="Multiple provider orders for receipt")
                    )
            if record.get("razorpayOrderId"):
                items = await provider("GET", f"orders/{quote(record['razorpayOrderId'], safe='')}/payments")
                for captured in items.get("items", []):
                    if captured.get("status") == "captured":
                        await verify_payment(
                            db,
                            user_id=record["userId"],
                            order_id=record["razorpayOrderId"],
                            payment_id=captured["id"],
                            trusted=True,
                        )
                        results["reconciledPayments"] += 1
                        break
            await db.execute(
                update(checkout_table)
                .where(checkout_table.c.id == row["id"])
                .values(nextAttemptAt=utcnow() + timedelta(minutes=2), leaseOwner=None, leaseExpiresAt=None)
            )
            await db.commit()
        except Exception as exc:
            logger.warning("Checkout reconciliation retry for %s: %s", row["id"], type(exc).__name__)
            await db.rollback()
            await db.execute(
                update(checkout_table)
                .where(checkout_table.c.id == row["id"])
                .values(
                    nextAttemptAt=utcnow() + timedelta(minutes=2),
                    leaseOwner=None,
                    leaseExpiresAt=None,
                    lastError=f"Checkout {row['id']} requires retry",
                )
            )
            await db.commit()
            results["errors"].append(f"Checkout {row['id']} requires retry")
    # Pre-migration Payment rows may have no canonical Checkout. Recover them too.
    payment_table, appointment_table = tables["Payment"], tables["Appointment"]
    legacy = (
        (
            await db.execute(
                select(payment_table)
                .where(
                    ~select(checkout_table.c.id)
                    .where(checkout_table.c.paymentId == payment_table.c.id)
                    .exists(),
                    ~select(appointment_table.c.id)
                    .where(appointment_table.c.paymentId == payment_table.c.id)
                    .exists(),
                    payment_table.c.status.in_(("CREATED", "PENDING", "FAILED", "SUCCESS")),
                    or_(payment_table.c.nextAttemptAt.is_(None), payment_table.c.nextAttemptAt <= utcnow()),
                )
                .order_by(payment_table.c.createdAt)
                .limit(15)
            )
        )
        .mappings()
        .all()
    )
    for row in legacy:
        if time.monotonic() - started >= 22:
            break
        try:
            items = await provider("GET", f"orders/{quote(row['razorpayOrderId'], safe='')}/payments")
            for captured in items.get("items", []):
                if captured.get("status") == "captured":
                    await verify_payment(
                        db,
                        user_id=row["userId"],
                        order_id=row["razorpayOrderId"],
                        payment_id=captured["id"],
                        trusted=True,
                    )
                    results["reconciledPayments"] += 1
                    break
            await db.execute(
                update(payment_table)
                .where(payment_table.c.id == row["id"])
                .values(nextAttemptAt=utcnow() + timedelta(minutes=2))
            )
            await db.commit()
        except Exception as exc:
            await db.rollback()
            logger.warning("Legacy payment reconciliation retry for %s: %s", row["id"], type(exc).__name__)
            results["errors"].append(f"Payment {row['id']} requires retry")
    rows = (
        (
            await db.execute(
                select(refund_table.c.id)
                .where(
                    refund_table.c.status.in_(("PENDING", "PROCESSING", "FAILED")),
                    or_(refund_table.c.nextAttemptAt.is_(None), refund_table.c.nextAttemptAt <= utcnow()),
                    or_(refund_table.c.leaseExpiresAt.is_(None), refund_table.c.leaseExpiresAt <= utcnow()),
                )
                .limit(20)
            )
        )
        .scalars()
        .all()
    )
    for refund_id in rows:
        if time.monotonic() - started >= 22:
            break
        if await execute_refund(db, refund_id) == "REFUNDED":
            results["reconciledRefunds"] += 1
    rows = (
        (
            await db.execute(
                select(webhook_table)
                .where(
                    webhook_table.c.status.in_(("RECEIVED", "FAILED", "PROCESSING")),
                    or_(webhook_table.c.nextAttemptAt.is_(None), webhook_table.c.nextAttemptAt <= utcnow()),
                    or_(webhook_table.c.leaseExpiresAt.is_(None), webhook_table.c.leaseExpiresAt <= utcnow()),
                )
                .limit(20)
            )
        )
        .mappings()
        .all()
    )
    for row in rows:
        if time.monotonic() - started >= 22:
            break
        await process_webhook(db, row)
        results["replayedWebhooks"] += 1
    stale = await db.execute(
        update(checkout_table)
        .where(
            checkout_table.c.expiresAt <= utcnow(),
            checkout_table.c.status.in_(("PENDING_ORDER", "READY_FOR_PAYMENT")),
            checkout_table.c.appointmentId.is_(None),
        )
        .values(status="EXPIRED", updatedAt=utcnow())
    )
    results["reconciledCheckouts"] = stale.rowcount
    await expire_holds(db)
    await db.commit()
    if time.monotonic() - started < 22:
        outbox = await dispatch_outbox(db, 15)
        results.update(outboxDelivered=outbox["delivered"], outboxFailed=outbox["failed"])
    backlog = {}
    for name, key, states in (
        ("Checkout", "pendingCheckouts", ("PENDING_ORDER", "READY_FOR_PAYMENT", "UNRESOLVED")),
        ("Refund", "pendingRefunds", ("PENDING", "PROCESSING", "FAILED")),
        ("WebhookEvent", "pendingWebhooks", ("RECEIVED", "PROCESSING", "FAILED")),
        ("NotificationOutbox", "pendingOutbox", ("PENDING", "PROCESSING", "FAILED")),
    ):
        table = tables[name]
        backlog[key] = (
            await db.execute(select(func.count()).select_from(table).where(table.c.status.in_(states)))
        ).scalar_one()
    elapsed = time.monotonic() - started
    return dict(
        ok=not results["errors"],
        results=results,
        backlog=backlog,
        skipped=False,
        budgetExceeded=elapsed >= 22,
        executionDurationMs=round(elapsed * 1000),
    )
