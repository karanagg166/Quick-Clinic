"""Razorpay saga: persist intent, call provider, then record the outcome."""

import hashlib
import logging
from datetime import timedelta
from urllib.parse import quote
from uuid import uuid4

import httpx
from fastapi import HTTPException
from sqlalchemy import insert, update

from app.core.config import get_settings
from app.infrastructure.database import new_id, tables, utcnow
from app.features.booking.service import (
    acquire_hold,
    as_utc_datetime,
    confirm_hold,
    insert_unique,
    fetch_record,
)

from .gateway import provider, verify_signature
from .queries import checkout_result
from .refunds import enqueue_refund, execute_refund

logger = logging.getLogger(__name__)


async def initiate_checkout(db, user, patient, data, *, existing_hold=None):
    checkout_table = tables["Checkout"]
    existing_checkout = await fetch_record(
        db, checkout_table, checkout_table.c.idempotencyKey == data["idempotencyKey"]
    )
    if existing_checkout:
        if any(
            existing_checkout[key] != value
            for key, value in dict(
                userId=user["id"],
                doctorId=data["doctorId"],
                slotId=data["slotId"],
                paymentMethod=data["paymentMethod"],
            ).items()
        ):
            raise HTTPException(409, "Idempotency key has already been used with different booking details")
        appointment = (
            await fetch_record(
                db,
                tables["Appointment"],
                tables["Appointment"].c.id == existing_checkout.get("appointmentId"),
            )
            if existing_checkout.get("appointmentId")
            else None
        )
        return checkout_result(existing_checkout, reused=True, appointment=appointment)
    if data["paymentMethod"] == "ONLINE" and not get_settings().razorpay_key_secret:
        raise HTTPException(503, "Payment provider is not configured")
    doctor = await fetch_record(
        db,
        tables["Doctor"],
        tables["Doctor"].c.id == data["doctorId"],
        tables["Doctor"].c.isReleaseFixture.is_(False),
    )
    if not doctor:
        raise HTTPException(404, "Doctor not found")
    amount = doctor["fees"] * 100
    if amount < 100:
        raise HTTPException(400, "The doctor has not configured a valid consultation fee")
    if existing_hold:
        slot = await fetch_record(db, tables["Slot"], tables["Slot"].c.id == data["slotId"], lock=True)
        if (
            not slot
            or slot["doctorId"] != data["doctorId"]
            or slot["status"] != "HELD"
            or slot["heldByPatientId"] != patient["id"]
            or slot["holdToken"] != existing_hold
            or not slot["holdExpiresAt"]
            or as_utc_datetime(slot["holdExpiresAt"]) <= as_utc_datetime(utcnow())
        ):
            raise HTTPException(409, "Hold expired or does not belong to this patient")
        hold = dict(holdToken=existing_hold, expiresAt=slot["holdExpiresAt"])
    else:
        hold = await acquire_hold(db, data["slotId"], data["doctorId"], patient["id"])
    now = utcnow()
    # Hash avoids provider receipt collisions caused by truncating a client key.
    receipt = "qc_" + hashlib.sha256(data["idempotencyKey"].encode()).hexdigest()[:32]
    checkout_record = dict(
        id=new_id(),
        idempotencyKey=data["idempotencyKey"],
        userId=user["id"],
        patientId=patient["id"],
        doctorId=doctor["id"],
        slotId=data["slotId"],
        holdToken=hold["holdToken"],
        paymentMethod=data["paymentMethod"],
        amount=amount,
        currency="INR",
        status="PENDING_ORDER",
        expiresAt=hold["expiresAt"],
        providerReference=receipt,
        createdAt=now,
        updatedAt=now,
    )
    # An independently racing identical key rolls its slot hold back on conflict.
    await db.execute(insert(checkout_table).values(**checkout_record))
    if data["paymentMethod"] == "OFFLINE":
        appointment = await confirm_hold(
            db,
            slot_id=checkout_record["slotId"],
            doctor_id=checkout_record["doctorId"],
            patient_id=patient["id"],
            token=checkout_record["holdToken"],
            payment_method="OFFLINE",
        )
        if not appointment:
            raise HTTPException(409, "This slot is no longer available")
        checkout_record.update(status="CONFIRMED", appointmentId=appointment["id"], confirmedAt=now)
        await db.execute(
            update(checkout_table)
            .where(checkout_table.c.id == checkout_record["id"])
            .values(status="CONFIRMED", appointmentId=appointment["id"], confirmedAt=now)
        )
        return checkout_result(checkout_record, appointment=appointment)
    checkout_record["leaseOwner"] = str(uuid4())
    checkout_record["leaseExpiresAt"] = now + timedelta(seconds=30)
    await db.execute(
        update(checkout_table)
        .where(checkout_table.c.id == checkout_record["id"])
        .values(
            leaseOwner=checkout_record["leaseOwner"],
            leaseExpiresAt=checkout_record["leaseExpiresAt"],
            processingStartedAt=now,
        )
    )
    await db.commit()  # Intent survives a provider timeout or process restart.
    try:
        order = await provider(
            "POST",
            "orders",
            payload=dict(
                amount=amount,
                currency="INR",
                receipt=receipt,
                notes=dict(
                    checkoutId=checkout_record["id"],
                    userId=user["id"],
                    doctorId=doctor["id"],
                    slotId=checkout_record["slotId"],
                ),
            ),
        )
    except (httpx.HTTPError, HTTPException):
        logger.exception("Razorpay order outcome unresolved for checkout %s", checkout_record["id"])
        await db.execute(
            update(checkout_table)
            .where(checkout_table.c.id == checkout_record["id"])
            .values(
                status="UNRESOLVED",
                leaseOwner=None,
                leaseExpiresAt=None,
                nextAttemptAt=utcnow() + timedelta(seconds=30),
                lastError="Order provider outcome unresolved",
            )
        )
        await db.commit()
        checkout_record["status"] = "UNRESOLVED"
        return checkout_result(checkout_record)
    return await attach_order(db, checkout_record, order)


async def attach_order(db, checkout_record, order):
    checkout_table, payment_table = tables["Checkout"], tables["Payment"]
    if (
        order.get("amount") != checkout_record["amount"]
        or order.get("currency") != checkout_record["currency"]
    ):
        raise HTTPException(502, "Payment order does not match reservation")
    now = utcnow()
    payment_record = await insert_unique(
        db,
        payment_table,
        dict(
            id=new_id(),
            idempotencyKey=checkout_record["idempotencyKey"],
            amount=checkout_record["amount"],
            currency=checkout_record["currency"],
            userId=checkout_record["userId"],
            doctorId=checkout_record["doctorId"],
            slotId=checkout_record["slotId"],
            holdToken=checkout_record["holdToken"],
            status="CREATED",
            razorpayOrderId=order["id"],
            createdAt=now,
            updatedAt=now,
        ),
        payment_table.c.razorpayOrderId == order["id"],
    )
    await db.execute(
        update(checkout_table)
        .where(checkout_table.c.id == checkout_record["id"], checkout_table.c.appointmentId.is_(None))
        .values(
            status="READY_FOR_PAYMENT",
            razorpayOrderId=order["id"],
            paymentId=payment_record["id"],
            leaseOwner=None,
            leaseExpiresAt=None,
            updatedAt=now,
        )
    )
    checkout_record.update(
        status="READY_FOR_PAYMENT", razorpayOrderId=order["id"], paymentId=payment_record["id"]
    )
    return checkout_result(checkout_record)


async def verify_payment(
    db, *, user_id, payment_id, order_id=None, checkout_id=None, signature=None, trusted=False
):
    checkout_table, payment_table = tables["Checkout"], tables["Payment"]
    checkout_record = None
    if checkout_id:
        checkout_record = await fetch_record(
            db, checkout_table, checkout_table.c.id == checkout_id, checkout_table.c.userId == user_id
        )
    elif order_id:
        checkout_record = await fetch_record(
            db,
            checkout_table,
            checkout_table.c.razorpayOrderId == order_id,
            checkout_table.c.userId == user_id,
        )
    if checkout_record and order_id and checkout_record.get("razorpayOrderId") != order_id:
        raise HTTPException(400, "Payment order does not match checkout")
    order_id = checkout_record.get("razorpayOrderId") if checkout_record else order_id
    payment_record = await fetch_record(
        db, payment_table, payment_table.c.razorpayOrderId == order_id, payment_table.c.userId == user_id
    )
    if not payment_record or (checkout_id and not checkout_record):
        raise HTTPException(404, "Payment order not found")
    if not trusted and not verify_signature(
        f"{order_id}|{payment_id}".encode(), signature or "", get_settings().razorpay_key_secret
    ):
        raise HTTPException(400, "Invalid payment signature")
    # Network lookup is authoritative even for signed webhook events.
    await db.commit()
    try:
        details = await provider("GET", f"payments/{quote(payment_id, safe='')}")
    except httpx.HTTPError as exc:
        raise HTTPException(502, "Unable to verify payment with provider") from exc
    if (
        details.get("id") != payment_id
        or details.get("order_id") != order_id
        or details.get("amount") != payment_record["amount"]
        or details.get("currency") != payment_record["currency"]
    ):
        raise HTTPException(400, "Payment details do not match the order")
    # Serialize callbacks and reconciliation per payment.
    payment_record = await fetch_record(
        db, payment_table, payment_table.c.id == payment_record["id"], lock=True
    )
    if (
        payment_record.get("razorpayPaymentId")
        and payment_record["razorpayPaymentId"] != payment_id
        and payment_record["status"] in ("SUCCESS", "REFUND_PENDING", "REFUNDED")
    ):
        raise HTTPException(409, "Order is linked to a different payment")
    if payment_record["status"] in ("REFUNDED", "REFUND_PENDING"):
        return {
            "ok": False,
            "error": "Payment has been refunded or is pending refund",
            "refundStatus": payment_record["status"],
            "transactionId": payment_id,
        }
    existing = await fetch_record(
        db, tables["Appointment"], tables["Appointment"].c.paymentId == payment_record["id"]
    )
    if existing:
        return {"ok": True, "appointment": existing, "transactionId": payment_id}
    if details.get("status") != "captured" or not details.get("captured", False):
        if details.get("status") in ("authorized", "created"):
            return {
                "ok": False,
                "status": "PENDING_CAPTURE",
                "message": "Payment capture is pending",
                "transactionId": payment_id,
            }
        raise HTTPException(400, "Payment is not captured")
    payment_record.update(status="SUCCESS", razorpayPaymentId=payment_id)
    await db.execute(
        update(payment_table)
        .where(payment_table.c.id == payment_record["id"])
        .values(status="SUCCESS", razorpayPaymentId=payment_id, capturedAt=utcnow(), updatedAt=utcnow())
    )
    patient = await fetch_record(db, tables["Patient"], tables["Patient"].c.userId == user_id)
    if not patient or (checkout_record and checkout_record["patientId"] != patient["id"]):
        raise HTTPException(403, "Patient mismatch")
    appointment_record = await confirm_hold(
        db,
        slot_id=payment_record["slotId"],
        doctor_id=payment_record["doctorId"],
        patient_id=patient["id"],
        token=payment_record["holdToken"],
        payment_method="ONLINE",
        payment=payment_record,
    )
    if appointment_record:
        if checkout_record:
            await db.execute(
                update(checkout_table)
                .where(checkout_table.c.id == checkout_record["id"])
                .values(
                    status="CONFIRMED",
                    appointmentId=appointment_record["id"],
                    confirmedAt=utcnow(),
                    updatedAt=utcnow(),
                )
            )
        return {
            "ok": True,
            "appointment": appointment_record,
            "transactionId": payment_id,
            "message": "Payment verified and appointment confirmed",
        }
    refund = await enqueue_refund(
        db, payment_record, "Reservation expired before captured payment could be booked"
    )
    if checkout_record:
        await db.execute(
            update(checkout_table)
            .where(checkout_table.c.id == checkout_record["id"])
            .values(status="EXPIRED", updatedAt=utcnow())
        )
    await db.commit()
    status = await execute_refund(db, refund["id"])
    return {
        "ok": False,
        "error": "Reservation expired; refund initiated",
        "refundStatus": status,
        "transactionId": payment_id,
    }
