"""Owner-scoped checkout, appointment, payment and refund snapshots."""

from fastapi import HTTPException
from sqlalchemy import or_

from app.core.config import get_settings
from app.infrastructure.database import tables
from app.features.booking.service import fetch_record


async def authoritative_status(db, *, user_id, checkout_id=None, order_id=None):
    checkout, payment, appointment, refund = (
        tables[n] for n in ("Checkout", "Payment", "Appointment", "Refund")
    )
    checkout_record = await fetch_record(
        db,
        checkout,
        checkout.c.userId == user_id,
        or_(checkout.c.id == checkout_id, checkout.c.razorpayOrderId == checkout_id)
        if checkout_id
        else checkout.c.razorpayOrderId == order_id,
    )
    payment_record = await fetch_record(
        db,
        payment,
        payment.c.userId == user_id,
        payment.c.id == checkout_record.get("paymentId")
        if checkout_record
        else payment.c.razorpayOrderId == order_id,
    )
    if not checkout_record and not payment_record:
        raise HTTPException(404, "Payment order not found")
    appointment_record = (
        await fetch_record(db, appointment, appointment.c.paymentId == payment_record["id"])
        if payment_record
        else None
    )
    if not appointment_record and checkout_record and checkout_record.get("appointmentId"):
        appointment_record = await fetch_record(
            db, appointment, appointment.c.id == checkout_record["appointmentId"]
        )
    refund_record = (
        await fetch_record(db, refund, refund.c.paymentId == payment_record["id"]) if payment_record else None
    )
    result = dict(checkout_record or payment_record)
    result.update(
        checkoutId=checkout_record["id"] if checkout_record else None,
        appointment=appointment_record,
        refund=refund_record,
        refundStatus=(
            {"PROCESSED": "REFUNDED", "FAILED": "FAILED"}.get(refund_record["status"], "REFUND_PENDING")
        )
        if refund_record
        else None,
        orderId=payment_record["razorpayOrderId"] if payment_record else None,
        paymentId=payment_record.get("razorpayPaymentId") if payment_record else None,
        capturedAt=payment_record.get("capturedAt") if payment_record else None,
    )
    return {
        "ok": True,
        "status": result["status"],
        "isConfirmed": bool(appointment_record),
        "appointment": appointment_record,
        "appointmentId": appointment_record["id"] if appointment_record else None,
        "paymentStatus": result,
        "checkout": result,
        "refundStatus": result["refundStatus"],
        "amount": result["amount"],
        "currency": result["currency"],
        "orderId": result["orderId"],
        "paymentId": result["paymentId"],
        "capturedAt": result["capturedAt"],
        "refund": refund_record,
    }


def checkout_result(checkout, *, reused=False, appointment=None):
    return dict(
        ok=checkout["status"] in ("CONFIRMED", "READY_FOR_PAYMENT"),
        checkoutId=checkout["id"],
        status=checkout["status"],
        paymentMethod=checkout["paymentMethod"],
        amount=checkout["amount"],
        currency=checkout["currency"],
        expiresAt=checkout["expiresAt"],
        orderId=checkout.get("razorpayOrderId"),
        keyId=get_settings().razorpay_key_id,
        reused=reused,
        appointment=appointment,
        canRetry=checkout["status"] in ("UNRESOLVED", "PENDING_ORDER", "READY_FOR_PAYMENT"),
        canRestart=checkout["status"] in ("EXPIRED", "FAILED"),
    )
