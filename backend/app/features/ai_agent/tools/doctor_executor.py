"""Domain-service executor for human-approved Doctor Agent actions.

Every handler here runs ONLY after claim_execution() succeeds and uses ONLY
the persisted, hashed parameters from AgentApproval.
"""

from typing import Any

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncConnection

from app.features.booking.appointments import change_status, get_authorized_appointment
from app.features.doctors.profiles import update_doctor_profile
from app.features.messaging.service import create_or_get_relation, send_rest_message
from app.features.scheduling.availability import (
    create_ad_hoc_slot,
    remove_available_slot,
    set_slot_availability,
)
from app.features.scheduling.leave import cancel_leave, upsert_leave
from app.features.scheduling.service import upsert_schedule
from app.infrastructure.database import tables


async def _owned_doctor_id(db: AsyncConnection, actor: dict[str, Any]) -> str:
    doctors = tables["Doctor"]
    row = (await db.execute(select(doctors.c.id).where(doctors.c.userId == actor["id"]))).first()
    if not row:
        raise HTTPException(404, "Doctor profile not found")
    return str(row[0])


def _iso_dt(value: str, *, end_of_day: bool = False) -> str:
    if "T" in value:
        return value
    suffix = "T23:59:59+05:30" if end_of_day else "T00:00:00+05:30"
    return f"{value}{suffix}"


async def execute_approved_doctor_action(
    db: AsyncConnection,
    *,
    actor: dict[str, Any],
    action_type: str,
    parameters: dict[str, Any],
    approval_id: str,
) -> tuple[str, dict[str, Any]]:
    """Invoke the authoritative domain service for an approved action."""

    doctor_id = await _owned_doctor_id(db, actor)

    if action_type == "APPLY_LEAVE":
        body = {
            "startDate": _iso_dt(str(parameters["start_date"])),
            "endDate": _iso_dt(str(parameters["end_date"]), end_of_day=True),
            "reason": str(parameters["reason"]),
        }
        res = await upsert_leave(doctor_id, body, "POST", actor, db)
        return "APPLY_LEAVE_OK", {"leaveId": res.get("leave", {}).get("id")}

    if action_type == "UPDATE_LEAVE":
        body = {
            "leaveId": str(parameters["leave_id"]),
            "newStartDate": _iso_dt(str(parameters["start_date"])),
            "newEndDate": _iso_dt(str(parameters["end_date"]), end_of_day=True),
            "reason": str(parameters["reason"]),
        }
        res = await upsert_leave(doctor_id, body, "PATCH", actor, db)
        return "UPDATE_LEAVE_OK", {"leaveId": res.get("leave", {}).get("id")}

    if action_type == "CANCEL_LEAVE":
        await cancel_leave(doctor_id, str(parameters["leave_id"]), actor, db)
        return "CANCEL_LEAVE_OK", {"leaveId": str(parameters["leave_id"])}

    if action_type == "UPDATE_SCHEDULE":
        await upsert_schedule(doctor_id, {"weeklySchedule": dict(parameters["weekly_schedule"])}, actor, db)
        return "UPDATE_SCHEDULE_OK", {"doctorId": doctor_id}

    if action_type == "CREATE_SLOT":
        body = {
            "date": str(parameters["date"]),
            "startTime": str(parameters["start_time"]),
            "endTime": str(parameters["end_time"]),
        }
        res = await create_ad_hoc_slot(doctor_id, body, actor, db)
        return "CREATE_SLOT_OK", {"slotId": res.get("slot", {}).get("id")}

    if action_type == "UPDATE_SLOT":
        body = {"slotIds": [str(parameters["slot_id"])], "status": str(parameters["status"])}
        await set_slot_availability(doctor_id, body, actor, db)
        return "UPDATE_SLOT_OK", {"slotId": str(parameters["slot_id"])}

    if action_type == "REMOVE_SLOT":
        await remove_available_slot(doctor_id, {"slotId": str(parameters["slot_id"])}, actor, db)
        return "REMOVE_SLOT_OK", {"slotId": str(parameters["slot_id"])}

    if action_type == "UPDATE_DOCTOR_PROFILE":
        body = {}
        if parameters.get("experience") is not None:
            body["experience"] = int(parameters["experience"])
        if parameters.get("fees") is not None:
            body["fees"] = int(parameters["fees"])
        if parameters.get("doctor_bio") is not None:
            body["doctorBio"] = str(parameters["doctor_bio"])
        await update_doctor_profile(doctor_id, body, actor, db)
        return "UPDATE_DOCTOR_PROFILE_OK", {"doctorId": doctor_id}

    if action_type in {"UPDATE_APPOINTMENT", "CANCEL_APPOINTMENT"}:
        appt_id = str(parameters["appointment_id"])
        target_status = "CANCELLED" if action_type == "CANCEL_APPOINTMENT" else str(parameters["status"])
        row, _ = await get_authorized_appointment(db, actor, "Doctor", doctor_id, appt_id, write=True)
        updated = await change_status(db, row, target_status)
        return "UPDATE_APPOINTMENT_OK", {"appointmentId": updated["id"], "status": updated["status"]}

    if action_type == "SEND_PATIENT_MESSAGE":
        patient_user_id = str(parameters["patient_user_id"])
        rel = await create_or_get_relation(
            {"doctorsUserId": actor["id"], "patientsUserId": patient_user_id},
            actor,
            db,
        )
        relation_id = rel["relation"]["id"]
        sent = await send_rest_message(
            relation_id,
            {"text": str(parameters["text"]), "clientMessageId": f"agent_{approval_id}"},
            actor,
            db,
        )
        return "SEND_PATIENT_MESSAGE_OK", {"messageId": sent.get("message", {}).get("id")}

    raise HTTPException(403, f"Unsupported approved action: {action_type}")
