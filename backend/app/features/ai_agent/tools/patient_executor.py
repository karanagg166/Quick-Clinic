"""Idempotent domain executors for approved Patient AI Agent mutations."""

from typing import Any

from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncConnection

from app.features.accounts import notifications as notifications_svc
from app.features.accounts import service as accounts_svc
from app.features.booking import appointments as appointments_svc
from app.features.booking import service as booking_svc
from app.features.doctors import reviews as reviews_svc
from app.features.documents import service as documents_svc
from app.features.documents.schemas import DocumentRename
from app.features.messaging import service as messaging_svc
from app.features.patients import service as patients_svc


async def execute_approved_patient_action(
    db: AsyncConnection,
    *,
    actor: dict[str, Any],
    action_type: str,
    parameters: dict[str, Any],
    approval_id: str,
) -> tuple[str, dict[str, Any]]:
    """Execute a human-approved patient mutation through domain services."""

    if actor.get("role") != "PATIENT":
        raise HTTPException(403, "Patient role required for patient actions")

    if action_type == "UPDATE_PATIENT_ACCOUNT":
        body = {k: v for k, v in parameters.items() if k in {"name", "phoneNo", "address"} and v is not None}
        res = await accounts_svc.update_profile(actor["id"], body, actor, db)
        return "PROFILE_UPDATED", {"user": res.get("user", res)}

    if action_type == "UPDATE_MEDICAL_PROFILE":
        patient = await booking_svc.require_patient_profile(db, actor)
        body = {
            k: v
            for k, v in parameters.items()
            if k in {"medicalHistory", "allergies", "currentMedications"} and v is not None
        }
        res = await patients_svc.update_patient_profile(db, patient["id"], body, actor)
        return "MEDICAL_PROFILE_UPDATED", {"patient": res.get("patient", res)}

    if action_type == "CANCEL_PATIENT_APPOINTMENT":
        patient = await booking_svc.require_patient_profile(db, actor)
        appt_id = str(parameters["appointment_id"])
        appt, _ = await appointments_svc.get_authorized_appointment(
            db, actor, "Patient", patient["id"], appt_id, write=True
        )
        res = await appointments_svc.change_status(db, appt, "CANCELLED")
        return "APPOINTMENT_CANCELLED", {"appointment": res.get("appointment", res)}

    if action_type == "PROPOSE_BOOKING":
        patient = await booking_svc.require_patient_profile(db, actor)
        doctor_id = str(parameters["doctor_id"])
        slot_id = str(parameters["slot_id"])
        hold = await booking_svc.acquire_hold(db, slot_id, doctor_id, patient["id"])
        return "BOOKING_HOLD_CREATED", {
            "hold": hold,
            "checkoutHandoff": {
                "doctorId": doctor_id,
                "slotId": slot_id,
                "holdToken": hold.get("holdToken"),
                "expiresAt": hold.get("expiresAt"),
                "checkoutUrl": f"/patient/doctors/{doctor_id}?slotId={slot_id}",
                "note": "Proceed to the checkout UI to select payment method and confirm booking.",
            },
        }

    if action_type == "RENAME_DOCUMENT":
        doc_id = str(parameters["document_id"])
        payload = DocumentRename(title=str(parameters["title"]))
        res = await documents_svc.rename_patient_document(db, actor, doc_id, payload)
        return "DOCUMENT_RENAMED", res

    if action_type == "DELETE_DOCUMENT":
        doc_id = str(parameters["document_id"])
        res = await documents_svc.delete_patient_document(db, actor, doc_id, commit=False)
        return "DOCUMENT_DELETED", res

    if action_type == "SEND_DOCTOR_MESSAGE":
        relation_id = str(parameters["relation_id"])
        content = str(parameters["content"])
        sent, duplicate = await messaging_svc.send_rest_message(
            relation_id,
            {"text": content, "clientMessageId": f"agent_{approval_id}"},
            actor,
            db,
            commit=False,
        )
        return "MESSAGE_SENT", {"message": sent.get("chat", sent), "duplicate": duplicate}

    if action_type == "MARK_NOTIFICATION_READ":
        notif_id = str(parameters["notification_id"])
        res = await notifications_svc.mark_notification_read(actor["id"], notif_id, actor, db)
        return "NOTIFICATION_MARKED_READ", res

    if action_type == "SUBMIT_DOCTOR_FEEDBACK":
        doctor_id = str(parameters["doctor_id"])
        rating_val = parameters.get("rating")
        comment_val = str(parameters["comment"]).strip() if parameters.get("comment") else ""
        if rating_val is None and not comment_val:
            raise HTTPException(400, "Either rating or comment is required")
        out: dict[str, Any] = {"doctorId": doctor_id}
        if rating_val is not None:
            out["rating"] = await reviews_svc.submit_rating(
                doctor_id, {"rating": int(rating_val)}, actor, db
            )
        if comment_val:
            out["comment"] = await reviews_svc.create_comment(
                doctor_id, {"text": comment_val}, actor, db
            )
        return "FEEDBACK_SUBMITTED", out

    raise HTTPException(400, f"Unsupported patient action: {action_type}")
