"""Administrative reporting, account governance and withdrawal use cases."""

import math
import secrets
from fastapi import HTTPException
from sqlalchemy import delete, func, insert, or_, select, update
from sqlalchemy.ext.asyncio import AsyncConnection
from app.core.config import get_settings
from app.infrastructure.database import new_id, tables, utcnow
from app.infrastructure.audit import record_audit_event
from app.features.accounts.service import get_account


async def get_admin_record(db: AsyncConnection, user_id: str):
    table = tables["Admin"]
    row = (await db.execute(select(table).where(table.c.userId == user_id))).mappings().first()
    return dict(row) if row else None


async def require_super_admin(db: AsyncConnection, user: dict):
    admin = await get_admin_record(db, user["id"])
    if not admin or admin["managerId"] is not None:
        raise HTTPException(403, "Forbidden: Super Admin privilege required")


async def get_detailed_account(db: AsyncConnection, user_id: str):
    user = await get_account(db, user_id)
    user.pop("password", None)
    for model, key in (("Doctor", "doctor"), ("Patient", "patient"), ("Admin", "admin")):
        table = tables[model]
        row = (await db.execute(select(table).where(table.c.userId == user_id))).mappings().first()
        user[key] = dict(row) if row else None
    if user["doctor"]:
        doctor_id = user["doctor"]["id"]
        qualifications, schedule = (tables["DoctorQualification"], tables["Schedule"])
        user["doctor"]["doctorQualifications"] = [
            dict(row)
            for row in (
                await db.execute(select(qualifications).where(qualifications.c.doctorId == doctor_id))
            ).mappings()
        ]
        row = (await db.execute(select(schedule).where(schedule.c.doctorId == doctor_id))).mappings().first()
        user["doctor"]["schedule"] = dict(row) if row else None
    if user["admin"]:
        admin = tables["Admin"]
        user["admin"]["manager"] = None
        if user["admin"]["managerId"]:
            manager = (
                (await db.execute(select(admin).where(admin.c.id == user["admin"]["managerId"])))
                .mappings()
                .first()
            )
            if manager:
                user["admin"]["manager"] = {
                    **dict(manager),
                    "user": {
                        key: (await get_account(db, manager["userId"]))[key]
                        for key in ("id", "name", "email")
                    },
                }
        subadmins = []
        for row in (
            await db.execute(select(admin).where(admin.c.managerId == user["admin"]["id"]))
        ).mappings():
            owner = await get_account(db, row["userId"])
            subadmins.append({**dict(row), "user": {key: owner[key] for key in ("id", "name", "email")}})
        user["admin"]["subAdmins"] = subadmins
    return user


async def onboard_admin(body: dict, user: dict, db: AsyncConnection):
    if body.get("userId") != user["id"]:
        raise HTTPException(403, "Forbidden: You can only onboard yourself")
    secret = body.get("secretCode")
    configured = get_settings().super_admin_code
    if secret and (
        not configured or not isinstance(secret, str) or (not secrets.compare_digest(secret, configured))
    ):
        raise HTTPException(400, "Invalid Super Admin Code")
    manager_id = None
    if not secret:
        if not body.get("managerEmail"):
            raise HTTPException(400, "Either Manager Email or Secret Code is required")
        users, admin = (tables["User"], tables["Admin"])
        manager = (
            await db.execute(
                select(admin.c.id, admin.c.userId)
                .select_from(admin.join(users, admin.c.userId == users.c.id))
                .where(users.c.email == body["managerEmail"], users.c.isActive.is_(True))
            )
        ).first()
        if not manager or manager.userId == user["id"]:
            raise HTTPException(404, "Manager not found or not an admin")
        manager_id = manager.id
    values = {key: body[key] for key in ("name", "phoneNo", "gender") if key in body}
    if any(not isinstance(value, str) or not value.strip() for value in values.values()):
        raise HTTPException(400, "Profile fields must be non-empty strings")
    if "gender" in values and values["gender"] not in {"MALE", "FEMALE", "BINARY"}:
        raise HTTPException(400, "Invalid gender")
    if "age" in body:
        try:
            values["age"] = int(body["age"])
        except (ValueError, TypeError) as exc:
            raise HTTPException(400, "Invalid age") from exc
    await db.execute(
        update(tables["User"])
        .where(tables["User"].c.id == user["id"])
        .values(**values, isActive=bool(secret), updatedAt=utcnow())
    )
    existing = await get_admin_record(db, user["id"])
    admin = tables["Admin"]
    if existing:
        await db.execute(
            update(admin).where(admin.c.id == existing["id"]).values(managerId=manager_id, updatedAt=utcnow())
        )
    else:
        await db.execute(
            insert(admin).values(
                id=new_id(), userId=user["id"], managerId=manager_id, createdAt=utcnow(), updatedAt=utcnow()
            )
        )
    await record_audit_event(
        db, user["id"], "Admin Onboarding", {"managerId": manager_id, "isActive": bool(secret)}
    )
    return {"success": True, "isActive": bool(secret), "managerId": manager_id}


async def list_users(params: dict[str, str], user: dict, db: AsyncConnection):
    params, users = (params, tables["User"])
    try:
        page = max(1, int(params.get("page", "1")))
        limit = min(100, max(1, int(params.get("limit", "20"))))
    except ValueError as exc:
        raise HTTPException(400, "Invalid pagination") from exc
    conditions = []
    if params.get("role", "").upper() in {"PATIENT", "DOCTOR", "ADMIN"}:
        conditions.append(users.c.role == params["role"].upper())
    if params.get("search"):
        conditions.append(
            or_(
                *(
                    column.ilike(f"%{params['search']}%")
                    for column in (users.c.name, users.c.email, users.c.phoneNo)
                )
            )
        )
    total = (await db.execute(select(func.count()).select_from(users).where(*conditions))).scalar_one()
    rows = (
        (
            await db.execute(
                select(users.c.id)
                .where(*conditions)
                .order_by(users.c.createdAt.desc())
                .offset((page - 1) * limit)
                .limit(limit)
            )
        )
        .scalars()
        .all()
    )
    return {
        "users": [await get_detailed_account(db, user_id) for user_id in rows],
        "pagination": {
            "page": page,
            "limit": limit,
            "totalUsers": total,
            "totalPages": math.ceil(total / limit),
            "hasMore": page * limit < total,
        },
    }


async def get_user(user_id: str, user: dict, db: AsyncConnection):
    return {"user": await get_detailed_account(db, user_id)}


async def update_user(user_id: str, body: dict, user: dict, db: AsyncConnection):
    target = await get_account(db, user_id)
    if target["role"] == "ADMIN" and user_id != user["id"]:
        await require_super_admin(db, user)
    values = {}
    if "isActive" in body:
        if not isinstance(body["isActive"], bool):
            raise HTTPException(400, "isActive must be boolean")
        values["isActive"] = body["isActive"]
    if "role" in body:
        if body["role"] not in {"PATIENT", "DOCTOR", "ADMIN"}:
            raise HTTPException(400, "Invalid role")
        if body["role"] != target["role"]:
            await require_super_admin(db, user)
        values["role"] = body["role"]
    if values.get("isActive") is False and target["isActive"]:
        doctor, patient, appointment, slot = (
            tables[key] for key in ("Doctor", "Patient", "Appointment", "Slot")
        )
        doctor_id = (
            await db.execute(select(doctor.c.id).where(doctor.c.userId == user_id))
        ).scalar_one_or_none()
        patient_id = (
            await db.execute(select(patient.c.id).where(patient.c.userId == user_id))
        ).scalar_one_or_none()
        if doctor_id:
            await db.execute(
                update(appointment)
                .where(
                    appointment.c.doctorId == doctor_id, appointment.c.status.in_(["PENDING", "CONFIRMED"])
                )
                .values(status="CANCELLED", updatedAt=utcnow())
            )
            await db.execute(
                update(slot)
                .where(slot.c.doctorId == doctor_id, slot.c.status.in_(["AVAILABLE", "HELD"]))
                .values(
                    status="UNAVAILABLE",
                    heldByPatientId=None,
                    holdToken=None,
                    heldAt=None,
                    holdExpiresAt=None,
                    updatedAt=utcnow(),
                )
            )
        elif patient_id:
            slots = (
                (
                    await db.execute(
                        select(appointment.c.slotId).where(
                            appointment.c.patientId == patient_id,
                            appointment.c.status.in_(["PENDING", "CONFIRMED"]),
                        )
                    )
                )
                .scalars()
                .all()
            )
            await db.execute(
                update(appointment)
                .where(
                    appointment.c.patientId == patient_id, appointment.c.status.in_(["PENDING", "CONFIRMED"])
                )
                .values(status="CANCELLED", updatedAt=utcnow())
            )
            if slots:
                await db.execute(
                    update(slot)
                    .where(slot.c.id.in_(slots))
                    .values(
                        status="AVAILABLE",
                        heldByPatientId=None,
                        holdToken=None,
                        heldAt=None,
                        holdExpiresAt=None,
                        updatedAt=utcnow(),
                    )
                )
    await db.execute(
        update(tables["User"]).where(tables["User"].c.id == user_id).values(**values, updatedAt=utcnow())
    )
    await record_audit_event(db, user["id"], f"Admin Updated User {user_id}", {"changes": values})
    updated = await get_account(db, user_id)
    return {"user": {key: updated[key] for key in ("id", "name", "email", "role", "isActive", "updatedAt")}}


async def delete_user(user_id: str, user: dict, db: AsyncConnection):
    await require_super_admin(db, user)
    await get_account(db, user_id)
    if user_id == user["id"]:
        raise HTTPException(409, "Cannot delete your own administrator account")
    await db.execute(delete(tables["User"]).where(tables["User"].c.id == user_id))
    await record_audit_event(db, user["id"], f"Admin Deleted User {user_id}")
    return {"success": True, "message": "User deleted successfully"}
