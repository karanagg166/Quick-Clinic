"""Domain-service executor for human-approved Doctor Agent actions.

Every handler here runs ONLY after claim_execution() succeeds and uses ONLY
the persisted, hashed parameters from AgentApproval.
"""

import json
import re
from typing import Any

from fastapi import HTTPException
from sqlalchemy import or_, select
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
from app.infrastructure.database import tables, utcnow

DAYS_OF_WEEK = ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday")
DAY_MAP = {day.lower(): day for day in DAYS_OF_WEEK}
for day in DAYS_OF_WEEK:
    DAY_MAP[day[:3].lower()] = day


def _normalize_time_str(val: Any) -> str:
    s = str(val).strip()
    am_pm_match = re.match(r"^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$", s, re.IGNORECASE)
    if am_pm_match:
        h, mn, mer = am_pm_match.groups()
        hour = int(h)
        minute = int(mn) if mn else 0
        if mer.lower() == "pm" and hour < 12:
            hour += 12
        elif mer.lower() == "am" and hour == 12:
            hour = 0
        return f"{hour:02d}:{minute:02d}"

    m = re.match(r"^(\d{1,2}):(\d{2})$", s)
    if m:
        h, mn = m.groups()
        return f"{int(h):02d}:{mn}"
    return s


def _normalize_slots(raw_slots: Any) -> list[dict[str, Any]]:
    if not raw_slots:
        return []
    if not isinstance(raw_slots, list):
        raw_slots = [raw_slots]

    normalized: list[dict[str, str]] = []
    for item in raw_slots:
        if isinstance(item, str):
            parts = re.split(r"\s*[-–—to]+\s*", item.strip())
            if len(parts) == 2:
                start = _normalize_time_str(parts[0])
                end = _normalize_time_str(parts[1])
                normalized.append({"start": start, "end": end})
        elif isinstance(item, dict):
            start = item.get("start") or item.get("startTime") or item.get("from")
            end = item.get("end") or item.get("endTime") or item.get("to")
            if start and end:
                normalized.append({
                    "start": _normalize_time_str(start),
                    "end": _normalize_time_str(end),
                })

    normalized.sort(key=lambda s: s["start"])
    return [
        {"slotNo": idx, "start": s["start"], "end": s["end"]}
        for idx, s in enumerate(normalized, 1)
    ]


def normalize_weekly_schedule_payload(raw: Any, existing_schedule: Any = None) -> list[dict[str, Any]]:
    """Convert arbitrary weekly schedule dictionary/list representations into canonical array."""
    if isinstance(raw, dict):
        if "weeklySchedule" in raw and isinstance(raw["weeklySchedule"], (list, dict)):
            raw = raw["weeklySchedule"]
        elif "weekly_schedule" in raw and isinstance(raw["weekly_schedule"], (list, dict)):
            raw = raw["weekly_schedule"]
        elif "schedule" in raw and isinstance(raw["schedule"], (list, dict)):
            raw = raw["schedule"]

    updates_by_day: dict[str, list[dict[str, Any]]] = {}
    if isinstance(raw, dict):
        if "day" in raw and "slots" in raw:
            day_name = DAY_MAP.get(str(raw["day"]).lower())
            if day_name:
                updates_by_day[day_name] = _normalize_slots(raw["slots"])
        else:
            for k, v in raw.items():
                day_name = DAY_MAP.get(str(k).lower())
                if day_name:
                    updates_by_day[day_name] = _normalize_slots(v)
    elif isinstance(raw, list):
        for item in raw:
            if isinstance(item, dict):
                day_name = DAY_MAP.get(str(item.get("day", "")).lower())
                if day_name:
                    updates_by_day[day_name] = _normalize_slots(item.get("slots", []))

    existing_by_day: dict[str, list[dict[str, Any]]] = {}
    if existing_schedule:
        if isinstance(existing_schedule, str):
            try:
                existing_schedule = json.loads(existing_schedule)
            except Exception:
                existing_schedule = []
        if isinstance(existing_schedule, dict) and "weeklySchedule" in existing_schedule:
            existing_schedule = existing_schedule["weeklySchedule"]
        if isinstance(existing_schedule, list):
            for item in existing_schedule:
                if isinstance(item, dict):
                    day_name = DAY_MAP.get(str(item.get("day", "")).lower())
                    if day_name:
                        existing_by_day[day_name] = _normalize_slots(item.get("slots", []))

    result = []
    for day in DAYS_OF_WEEK:
        if day in updates_by_day:
            slots = updates_by_day[day]
        elif day in existing_by_day:
            slots = existing_by_day[day]
        else:
            slots = []
        result.append({"day": day, "slots": slots})
    return result


async def _owned_doctor_id(db: AsyncConnection, actor: dict[str, Any]) -> str:
    doctors = tables["Doctor"]
    row = (await db.execute(select(doctors.c.id).where(doctors.c.userId == actor["id"]))).first()
    if not row:
        raise HTTPException(404, "Doctor profile not found")
    return str(row[0])


async def _require_authorized_patient_messaging(
    db: AsyncConnection,
    *,
    actor: dict[str, Any],
    doctor_id: str,
    patient_user_id: str,
) -> None:
    """Ensure the doctor already has a relation, eligible appointment, or active access grant."""

    patients = tables["Patient"]
    patient = (
        await db.execute(select(patients.c.id).where(patients.c.userId == patient_user_id))
    ).first()
    if not patient:
        raise HTTPException(404, "Patient not found")
    patient_id = str(patient[0])

    relations = tables["DoctorPatientRelation"]
    existing_rel = (
        await db.execute(
            select(relations.c.id)
            .where(
                relations.c.doctorsUserId == actor["id"],
                relations.c.patientsUserId == patient_user_id,
            )
            .limit(1)
        )
    ).first()
    if existing_rel is not None:
        return

    appointments = tables["Appointment"]
    eligible_appt = (
        await db.execute(
            select(appointments.c.id)
            .where(
                appointments.c.doctorId == doctor_id,
                appointments.c.patientId == patient_id,
                appointments.c.status.in_(["PENDING", "CONFIRMED", "COMPLETED"]),
            )
            .limit(1)
        )
    ).first()
    if eligible_appt is not None:
        return

    grants = tables.get("MedicalAccessGrant")
    if grants is not None:
        now = utcnow()
        active_grant = (
            await db.execute(
                select(grants.c.id)
                .where(
                    grants.c.doctorId == doctor_id,
                    grants.c.patientId == patient_id,
                    grants.c.revokedAt.is_(None),
                    or_(grants.c.expiresAt.is_(None), grants.c.expiresAt > now),
                )
                .limit(1)
            )
        ).first()
        if active_grant is not None:
            return

    raise HTTPException(403, "Doctor is not authorized to message this patient")


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
        return "APPLY_LEAVE_OK", {"leaveId": res.get("id") or res.get("leave", {}).get("id")}

    if action_type == "UPDATE_LEAVE":
        body = {
            "leaveId": str(parameters["leave_id"]),
            "newStartDate": _iso_dt(str(parameters["start_date"])),
            "newEndDate": _iso_dt(str(parameters["end_date"]), end_of_day=True),
            "reason": str(parameters["reason"]),
        }
        res = await upsert_leave(doctor_id, body, "PATCH", actor, db)
        return "UPDATE_LEAVE_OK", {
            "leaveId": res.get("leave", {}).get("id") or str(parameters["leave_id"])
        }

    if action_type == "CANCEL_LEAVE":
        await cancel_leave(doctor_id, str(parameters["leave_id"]), actor, db)
        return "CANCEL_LEAVE_OK", {"leaveId": str(parameters["leave_id"])}

    if action_type == "UPDATE_SCHEDULE":
        schedules_table = tables["Schedule"]
        sched_row = (
            await db.execute(
                select(schedules_table.c.weeklySchedule).where(schedules_table.c.doctorId == doctor_id)
            )
        ).scalar()
        normalized = normalize_weekly_schedule_payload(parameters, sched_row)
        await upsert_schedule(doctor_id, {"weeklySchedule": normalized}, actor, db)
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
        if not body:
            raise HTTPException(400, "At least one doctor profile field is required")
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
        await _require_authorized_patient_messaging(db, actor=actor, doctor_id=doctor_id, patient_user_id=patient_user_id)
        rel = await create_or_get_relation(
            {"doctorsUserId": actor["id"], "patientsUserId": patient_user_id},
            actor,
            db,
        )
        relation_id = rel["relation"]["id"]
        sent, duplicate = await send_rest_message(
            relation_id,
            {"text": str(parameters["text"]), "clientMessageId": f"agent_{approval_id}"},
            actor,
            db,
            commit=False,
        )
        return "SEND_PATIENT_MESSAGE_OK", {
            "messageId": sent.get("chat", {}).get("id"),
            "duplicate": duplicate,
        }

    raise HTTPException(403, f"Unsupported approved action: {action_type}")
