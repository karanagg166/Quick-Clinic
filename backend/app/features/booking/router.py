"""Reservation and appointment HTTP contracts."""

from fastapi import APIRouter, Depends, HTTPException, Request

from app.infrastructure.database import get_db, tables
from app.core.security import current_user
from app.features.booking.service import (
    acquire_hold,
    confirm_hold,
    fetch_record,
    require_patient_profile,
    release_hold,
)
from app.features.payments.service import verify_payment
from .schemas import (
    SlotHoldRequest,
    SlotHoldCancellationRequest,
    AppointmentConfirmationRequest,
    AppointmentUpdateRequest,
)
from .appointments import require_profile_owner, list_appointments, get_authorized_appointment, change_status

router = APIRouter(prefix="/api", tags=["appointments"])


@router.post("/appointments/hold", status_code=201)
async def create_slot_hold(body: SlotHoldRequest, user=Depends(current_user), db=Depends(get_db)):
    patient = await require_patient_profile(db, user)
    return await acquire_hold(db, body.slotId, body.doctorId, patient["id"])


@router.post("/appointments/cancel-hold")
async def cancel_slot_hold(body: SlotHoldCancellationRequest, user=Depends(current_user), db=Depends(get_db)):
    patient = await require_patient_profile(db, user)
    if not await release_hold(db, body.slotId, patient["id"], str(body.holdToken)):
        raise HTTPException(409, "Hold expired or does not belong to this patient")
    return {"released": True}


@router.post("/appointments/confirm", status_code=201)
async def confirm_appointment(
    body: AppointmentConfirmationRequest, user=Depends(current_user), db=Depends(get_db)
):
    patient = await require_patient_profile(db, user)
    if body.paymentMethod == "ONLINE":
        if not body.transactionId:
            raise HTTPException(400, "A transaction ID is required for online payment")
        pay = tables["Payment"]
        payment = await fetch_record(
            db,
            pay,
            pay.c.userId == user["id"],
            pay.c.doctorId == body.doctorId,
            pay.c.slotId == body.slotId,
            pay.c.holdToken == str(body.holdToken),
        )
        if not payment:
            raise HTTPException(400, "No matching payment order found for this reservation")
        result = await verify_payment(
            db,
            user_id=user["id"],
            payment_id=body.transactionId,
            order_id=payment["razorpayOrderId"],
            trusted=True,
        )
        if not result.get("ok"):
            return result
        return {"appointment": result["appointment"]}
    appointment = await confirm_hold(
        db,
        slot_id=body.slotId,
        doctor_id=body.doctorId,
        patient_id=patient["id"],
        token=str(body.holdToken),
        payment_method="OFFLINE",
    )
    if not appointment:
        raise HTTPException(409, "Hold expired or does not belong to this patient")
    return {"appointment": appointment}


@router.get("/doctors/{doctor_id}/appointments")
async def doctor_appointments(
    doctor_id: str, request: Request, user=Depends(current_user), db=Depends(get_db)
):
    await require_profile_owner(db, user, "Doctor", doctor_id)
    return await list_appointments(db, request.query_params, "Doctor", doctor_id)


@router.get("/patients/{patient_id}/appointments")
async def patient_appointments(
    patient_id: str, request: Request, user=Depends(current_user), db=Depends(get_db)
):
    await require_profile_owner(db, user, "Patient", patient_id)
    return await list_appointments(db, request.query_params, "Patient", patient_id)


@router.post("/patients/{patient_id}/appointments", status_code=410)
async def reject_legacy_booking(patient_id: str, user=Depends(current_user), db=Depends(get_db)):
    await require_profile_owner(db, user, "Patient", patient_id)
    return {"message": "Use /api/appointments/hold followed by /api/appointments/confirm to book a slot"}


@router.get("/doctors/{doctor_id}/appointments/{appointment_id}")
async def get_doctor_appointment(
    doctor_id: str, appointment_id: str, user=Depends(current_user), db=Depends(get_db)
):
    _, detail = await get_authorized_appointment(db, user, "Doctor", doctor_id, appointment_id)
    return detail


@router.get("/patients/{patient_id}/appointments/{appointment_id}")
async def get_patient_appointment(
    patient_id: str, appointment_id: str, user=Depends(current_user), db=Depends(get_db)
):
    _, detail = await get_authorized_appointment(db, user, "Patient", patient_id, appointment_id)
    return detail


@router.patch("/doctors/{doctor_id}/appointments/{appointment_id}")
async def update_doctor_appointment(
    doctor_id: str,
    appointment_id: str,
    body: AppointmentUpdateRequest,
    user=Depends(current_user),
    db=Depends(get_db),
):
    row, _ = await get_authorized_appointment(db, user, "Doctor", doctor_id, appointment_id, write=True)
    if not body.status:
        raise HTTPException(400, "No status provided to update")
    if body.paymentMethod and body.paymentMethod != row["paymentMethod"]:
        raise HTTPException(400, "Payment method cannot be changed after booking")
    row = await change_status(db, row, body.status)
    return {"success": True, "status": row["status"], "appointment": row}


@router.patch("/patients/{patient_id}/appointments/{appointment_id}")
async def cancel_patient_appointment(
    patient_id: str, appointment_id: str, user=Depends(current_user), db=Depends(get_db)
):
    row, _ = await get_authorized_appointment(db, user, "Patient", patient_id, appointment_id, write=True)
    if row["status"] not in ("PENDING", "CONFIRMED", "CANCELLED"):
        raise HTTPException(400, f"Cannot cancel appointment with status: {row['status']}")
    await change_status(db, row, "CANCELLED")
    return {
        "message": "Appointment cancelled successfully",
        "refundProcessed": False,
        "refundStatus": "REFUND_PENDING" if row["paymentMethod"] == "ONLINE" else None,
    }
