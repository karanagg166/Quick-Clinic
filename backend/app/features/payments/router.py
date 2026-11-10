"""Canonical checkout and compatibility payment endpoints."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import Field
from .schemas import (
    CheckoutInitiationRequest,
    CheckoutVerificationRequest,
    LegacyOrderRequest,
    LegacyPaymentVerificationRequest,
)

from app.infrastructure.database import get_db
from app.core.security import current_user
from app.features.booking.service import require_patient_profile
from app.features.payments.service import initiate_checkout, verify_payment
from app.features.payments.queries import authoritative_status

router = APIRouter(prefix="/api", tags=["payments"])


@router.post("/checkout")
async def process_checkout(
    body: Annotated[CheckoutInitiationRequest | CheckoutVerificationRequest, Field(discriminator="action")],
    response: Response,
    user=Depends(current_user),
    db=Depends(get_db),
):
    patient = await require_patient_profile(db, user)
    if isinstance(body, CheckoutInitiationRequest):
        result = await initiate_checkout(db, user, patient, body.model_dump())
        response.status_code = 200 if result.get("reused") else 201
        return result
    result = await verify_payment(
        db,
        user_id=user["id"],
        payment_id=body.paymentId,
        order_id=body.orderId,
        checkout_id=body.checkoutId,
        signature=body.signature,
    )
    if not result.get("ok"):
        response.status_code = 202 if result.get("status") == "PENDING_CAPTURE" else 409
    return result


@router.get("/checkout/{checkout_id}/status")
async def get_checkout_status(checkout_id: str, user=Depends(current_user), db=Depends(get_db)):
    await require_patient_profile(db, user)
    return await authoritative_status(db, user_id=user["id"], checkout_id=checkout_id)


@router.post("/user/{user_id}/payments/createOrder")
async def create_payment_order(
    user_id: str, body: LegacyOrderRequest, response: Response, user=Depends(current_user), db=Depends(get_db)
):
    if user["id"] != user_id:
        raise HTTPException(403, "Forbidden")
    patient = await require_patient_profile(db, user)
    data = body.model_dump()
    data.update(
        paymentMethod="ONLINE",
        idempotencyKey=body.idempotencyKey or f"ord_{user_id[-6:]}_{body.slotId}_{body.holdToken}",
    )
    result = await initiate_checkout(db, user, patient, data, existing_hold=str(body.holdToken))
    response.status_code = 200 if result.get("reused") else 201
    if result["status"] != "READY_FOR_PAYMENT":
        response.status_code = 202
        return result
    return {
        "ok": True,
        "order": {
            "id": result["orderId"],
            "razorpayOrderId": result["orderId"],
            "amount": result["amount"],
            "currency": result["currency"],
            "status": "created",
        },
        "keyId": result["keyId"],
        "reused": result["reused"],
    }


@router.post("/user/{user_id}/payments/verifyOrder")
async def verify_payment_order(
    user_id: str,
    body: LegacyPaymentVerificationRequest,
    response: Response,
    user=Depends(current_user),
    db=Depends(get_db),
):
    if user["id"] != user_id:
        raise HTTPException(403, "Forbidden")
    await require_patient_profile(db, user)
    result = await verify_payment(
        db, user_id=user_id, payment_id=body.paymentId, order_id=body.orderId, signature=body.signature
    )
    if not result.get("ok"):
        response.status_code = 202 if result.get("status") == "PENDING_CAPTURE" else 409
    return result


@router.get("/user/{user_id}/payments/{order_id}/status")
async def get_payment_status(user_id: str, order_id: str, user=Depends(current_user), db=Depends(get_db)):
    if user["id"] != user_id:
        raise HTTPException(403, "Forbidden")
    await require_patient_profile(db, user)
    return await authoritative_status(db, user_id=user_id, order_id=order_id)
