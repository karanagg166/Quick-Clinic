"""Patient profiles and appointment-scoped clinical access rules."""

from fastapi import HTTPException
from sqlalchemy import func, insert, select, update
from sqlalchemy.ext.asyncio import AsyncConnection
from app.infrastructure.database import new_id, tables, utcnow

MEDICAL_FIELDS = ("medicalHistory", "allergies", "currentMedications")


async def get_patient_record(db: AsyncConnection, patient_id: str):
    patient = tables["Patient"]
    row = (await db.execute(select(patient).where(patient.c.id == patient_id))).mappings().first()
    if not row:
        raise HTTPException(404, "Patient not found")
    return dict(row)


async def authorize_patient_access(db: AsyncConnection, patient: dict, user: dict, allow_doctor=False):
    if user["role"] == "ADMIN" or (user["role"] == "PATIENT" and patient["userId"] == user["id"]):
        return
    if allow_doctor and user["role"] == "DOCTOR":
        doctor, appointment = (tables["Doctor"], tables["Appointment"])
        allowed = (
            await db.execute(
                select(appointment.c.id)
                .select_from(appointment.join(doctor, appointment.c.doctorId == doctor.c.id))
                .where(
                    doctor.c.userId == user["id"],
                    appointment.c.patientId == patient["id"],
                    appointment.c.status.in_(["CONFIRMED", "COMPLETED"]),
                )
                .limit(1)
            )
        ).first()
        if allowed:
            return
    raise HTTPException(403, "Forbidden")


def validated_medical_fields(body: dict):
    values = {key: body[key] for key in MEDICAL_FIELDS if key in body}
    if any((not isinstance(value, str) or len(value) > 20000 for value in values.values())):
        raise HTTPException(400, "Medical profile fields must be strings of at most 20000 characters")
    return values


async def create_patient_profile(body: dict, user: dict, db: AsyncConnection):
    user_id = body.get("userId")
    if not isinstance(user_id, str) or not user_id:
        raise HTTPException(400, "userId is required")
    if user["role"] != "ADMIN" and (user["role"] != "PATIENT" or user["id"] != user_id):
        raise HTTPException(403, "Forbidden")
    users, patient = (tables["User"], tables["Patient"])
    if not (
        await db.execute(select(users.c.id).where(users.c.id == user_id, users.c.role == "PATIENT"))
    ).first():
        raise HTTPException(404, "Patient user not found")
    if (await db.execute(select(patient.c.id).where(patient.c.userId == user_id))).first():
        raise HTTPException(409, "Patient profile already exists for this user")
    values = {key: "" for key in MEDICAL_FIELDS}
    values.update(
        validated_medical_fields(body), id=new_id(), userId=user_id, createdAt=utcnow(), updatedAt=utcnow()
    )
    await db.execute(insert(patient).values(**values))
    return {"patient": values}


async def update_patient_profile(db: AsyncConnection, patient_id: str, body: dict, user: dict):
    existing = await get_patient_record(db, patient_id)
    await authorize_patient_access(db, existing, user)
    values = validated_medical_fields(body)
    await db.execute(
        update(tables["Patient"])
        .where(tables["Patient"].c.id == patient_id)
        .values(**values, updatedAt=utcnow())
    )
    return {"patient": await get_patient_record(db, patient_id)}


async def get_patient_profile(patient_id: str, user: dict, db: AsyncConnection):
    patient = await get_patient_record(db, patient_id)
    await authorize_patient_access(db, patient, user, allow_doctor=True)
    users = tables["User"]
    row = dict((await db.execute(select(users).where(users.c.id == patient["userId"]))).mappings().one())
    for key in ("password", "isActive"):
        row.pop(key, None)
    patient["user"] = row
    return {"patient": patient}


async def get_patient_stats(patient_id: str, user: dict, db: AsyncConnection):
    patient = await get_patient_record(db, patient_id)
    await authorize_patient_access(db, patient, user)
    appointment, slot, relation = (tables["Appointment"], tables["Slot"], tables["DoctorPatientRelation"])
    counts = dict(
        (
            await db.execute(
                select(appointment.c.status, func.count())
                .where(appointment.c.patientId == patient_id)
                .group_by(appointment.c.status)
            )
        ).all()
    )
    upcoming = (
        await db.execute(
            select(func.count())
            .select_from(appointment.join(slot, appointment.c.slotId == slot.c.id))
            .where(
                appointment.c.patientId == patient_id,
                appointment.c.status.in_(["PENDING", "CONFIRMED"]),
                slot.c.date >= utcnow().date(),
            )
        )
    ).scalar_one()
    assigned = (
        await db.execute(
            select(func.count()).select_from(relation).where(relation.c.patientsUserId == patient["userId"])
        )
    ).scalar_one()
    completed = counts.get("COMPLETED", 0)
    return {
        "upcomingAppointments": upcoming,
        "assignedDoctors": assigned,
        "pendingApprovals": counts.get("PENDING", 0),
        "completedAppointments": completed,
        "wellnessScore": min(100, completed * 10),
    }


async def list_patients(params: dict[str, str], user: dict, db: AsyncConnection):
    doctor_id = params.get("doctorId")
    scope_all = params.get("all") == "true" or params.get("scope") == "all"
    patient, users, doctor, appointment, location = (
        tables[key] for key in ("Patient", "User", "Doctor", "Appointment", "Location")
    )
    if user["role"] == "DOCTOR":
        own_doctor = (
            await db.execute(select(doctor.c.id).where(doctor.c.userId == user["id"]))
        ).scalar_one_or_none()
        if not own_doctor:
            raise HTTPException(404, "Doctor profile not found")
        if scope_all or (doctor_id and doctor_id != own_doctor):
            raise HTTPException(403, "Forbidden")
        doctor_id = own_doctor
    elif user["role"] != "ADMIN":
        raise HTTPException(403, "Access denied")
    if not scope_all and (not doctor_id):
        raise HTTPException(400, "doctorId is required when scope is not all")
    query = select(patient).select_from(
        patient.join(users, patient.c.userId == users.c.id).join(
            location, users.c.pinCode == location.c.pincode
        )
    )
    if not scope_all:
        query = query.where(
            patient.c.id.in_(
                select(appointment.c.patientId).where(
                    appointment.c.doctorId == doctor_id, appointment.c.status.in_(["CONFIRMED", "COMPLETED"])
                )
            )
        )
    for param, column in (
        ("medicalHistory", patient.c.medicalHistory),
        ("allergy", patient.c.allergies),
        ("currentMedications", patient.c.currentMedications),
        ("name", users.c.name),
        ("city", location.c.city),
        ("state", location.c.state),
    ):
        if params.get(param):
            query = query.where(column.ilike(f"%{params[param]}%"))
    for param in ("age", "minAge", "maxAge"):
        if params.get(param):
            try:
                age = int(params[param])
            except ValueError as exc:
                raise HTTPException(400, "Invalid age filter") from exc
            query = query.where(
                users.c.age == age
                if param == "age"
                else users.c.age >= age
                if param == "minAge"
                else users.c.age <= age
            )
    if params.get("gender", "all").upper() in {"MALE", "FEMALE", "BINARY"}:
        query = query.where(users.c.gender == params["gender"].upper())
    patients = (await db.execute(query.order_by(patient.c.createdAt.desc()).limit(500))).mappings().all()
    result = []
    slot = tables["Slot"]
    for row in patients:
        owner = (await db.execute(select(users).where(users.c.id == row["userId"]))).mappings().one()
        loc = (
            (await db.execute(select(location).where(location.c.pincode == owner["pinCode"])))
            .mappings()
            .first()
        )
        history_query = select(appointment).where(appointment.c.patientId == row["id"])
        if doctor_id:
            history_query = history_query.where(appointment.c.doctorId == doctor_id)
        history = []
        for event in (
            await db.execute(history_query.order_by(appointment.c.bookedAt.desc()).limit(500))
        ).mappings():
            item = {
                key: event[key]
                for key in (
                    "id",
                    "status",
                    "bookedAt",
                    "paymentMethod",
                    "transactionId",
                    "isAppointmentOffline",
                    "notes",
                )
            }
            slot_row = (
                (
                    await db.execute(
                        select(slot.c.date, slot.c.startTime, slot.c.endTime).where(
                            slot.c.id == event["slotId"]
                        )
                    )
                )
                .mappings()
                .first()
            )
            item["slot"] = dict(slot_row) if slot_row else None
            history.append(item)
        result.append(
            {
                "id": row["id"],
                **{key: owner[key] for key in ("name", "gender", "age", "email", "phoneNo")},
                "city": loc["city"] if loc else "",
                "state": loc["state"] if loc else "",
                **{key: row[key] for key in MEDICAL_FIELDS},
                "appointments": history,
            }
        )
    return result
