"""Authorized patient and medical-document read queries for the Doctor Agent."""

from typing import Any

from fastapi import HTTPException
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncConnection

from app.features.documents.schemas import DocumentFilters
from app.features.documents.service import (
    document_query,
    record_access,
    require_doctor_record_access,
)
from app.features.documents.storage import document_metadata
from app.infrastructure.database import tables


async def _resolve_doctor(db: AsyncConnection, actor: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(actor, dict) or actor.get("role") != "DOCTOR" or actor.get("isActive") is not True:
        raise HTTPException(403, "Doctor authorization required")
    doctors = tables["Doctor"]
    row = (await db.execute(select(doctors).where(doctors.c.userId == actor["id"]))).mappings().first()
    if row is None:
        raise HTTPException(404, "Doctor profile not found")
    return dict(row)


async def _authorize_patient(
    db: AsyncConnection,
    actor: dict[str, Any],
    doctor_id: str,
    patient_id: str,
) -> None:
    """Verify eligible appointment OR active MedicalAccessGrant."""

    grants = tables.get("MedicalAccessGrant")
    if grants is not None:
        from app.infrastructure.database import utcnow

        now = utcnow()
        grant = (
            await db.execute(
                select(grants.c.id).where(
                    grants.c.doctorId == doctor_id,
                    grants.c.patientId == patient_id,
                    grants.c.revokedAt.is_(None),
                    or_(grants.c.expiresAt.is_(None), grants.c.expiresAt > now),
                ).limit(1)
            )
        ).first()
        if grant is not None:
            return

    await require_doctor_record_access(db, actor, patient_id)


async def list_my_patients(
    db: AsyncConnection,
    actor: dict[str, Any],
    search: str | None = None,
) -> dict[str, Any]:
    """List patients with an eligible appointment with this doctor."""

    doctor = await _resolve_doctor(db, actor)
    appointments = tables["Appointment"]
    patients = tables["Patient"]
    users = tables["User"]

    stmt = (
        select(
            patients.c.id.label("patientId"),
            users.c.id.label("userId"),
            users.c.name,
            users.c.age,
            users.c.gender,
        )
        .select_from(
            appointments.join(patients, patients.c.id == appointments.c.patientId).join(
                users, users.c.id == patients.c.userId
            )
        )
        .where(
            appointments.c.doctorId == doctor["id"],
            appointments.c.status.in_(["CONFIRMED", "COMPLETED"]),
        )
        .distinct()
        .order_by(users.c.name.asc())
        .limit(50)
    )
    if search and search.strip():
        stmt = stmt.where(users.c.name.icontains(search.strip(), autoescape=True))

    rows = (await db.execute(stmt)).mappings().all()
    return {
        "type": "AUTHORIZED_PATIENTS",
        "count": len(rows),
        "patients": [dict(r) for r in rows],
    }


async def get_patient_info(
    db: AsyncConnection,
    actor: dict[str, Any],
    patient_id: str,
) -> dict[str, Any]:
    """Return authorized patient clinical summary and basic demographics."""

    doctor = await _resolve_doctor(db, actor)
    await _authorize_patient(db, actor, doctor["id"], patient_id)

    patients = tables["Patient"]
    users = tables["User"]
    row = (
        await db.execute(
            select(
                patients.c.id.label("patientId"),
                patients.c.userId,
                patients.c.medicalHistory,
                patients.c.allergies,
                patients.c.currentMedications,
                users.c.name,
                users.c.age,
                users.c.gender,
            )
            .select_from(patients.join(users, users.c.id == patients.c.userId))
            .where(patients.c.id == patient_id)
        )
    ).mappings().first()

    if row is None:
        raise HTTPException(404, "Patient not found")
    await record_access(db, actor, patient_id, "AGENT_PATIENT_INFO")
    return {"type": "PATIENT_INFO", "patient": dict(row)}


async def get_patient_appointment_history(
    db: AsyncConnection,
    actor: dict[str, Any],
    patient_id: str,
) -> dict[str, Any]:
    """Return appointment history between this doctor and an authorized patient."""

    doctor = await _resolve_doctor(db, actor)
    await _authorize_patient(db, actor, doctor["id"], patient_id)

    appointments = tables["Appointment"]
    slots = tables["Slot"]
    rows = (
        await db.execute(
            select(
                appointments.c.id,
                appointments.c.status,
                appointments.c.paymentMethod,
                appointments.c.notes,
                appointments.c.bookedAt,
                slots.c.date,
                slots.c.startTime,
                slots.c.endTime,
            )
            .select_from(appointments.join(slots, slots.c.id == appointments.c.slotId))
            .where(
                appointments.c.doctorId == doctor["id"],
                appointments.c.patientId == patient_id,
            )
            .order_by(slots.c.startTime.desc())
            .limit(30)
        )
    ).mappings().all()

    return {
        "type": "PATIENT_APPOINTMENT_HISTORY",
        "patientId": patient_id,
        "count": len(rows),
        "appointments": [
            {
                "id": r["id"],
                "status": r["status"],
                "paymentMethod": r["paymentMethod"],
                "notes": r["notes"],
                "date": r["date"].isoformat() if r["date"] else None,
                "startTime": r["startTime"].isoformat() if r["startTime"] else None,
                "endTime": r["endTime"].isoformat() if r["endTime"] else None,
            }
            for r in rows
        ],
    }


async def list_patient_medical_documents(
    db: AsyncConnection,
    actor: dict[str, Any],
    patient_id: str,
    doc_type: str = "",
    search: str = "",
) -> dict[str, Any]:
    """List authorized medical document metadata (never exposing storagePath)."""

    doctor = await _resolve_doctor(db, actor)
    await _authorize_patient(db, actor, doctor["id"], patient_id)

    filters = DocumentFilters(type=doc_type, search=search)
    rows = (await db.execute(document_query(patient_id, filters))).mappings().all()
    await record_access(db, actor, patient_id, "AGENT_MEDICAL_DOCUMENT_LIST")
    return {
        "type": "PATIENT_MEDICAL_DOCUMENTS",
        "patientId": patient_id,
        "count": len(rows),
        "documents": [document_metadata(r) for r in rows],
    }
