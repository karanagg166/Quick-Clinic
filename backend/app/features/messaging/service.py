"""Human doctor/patient chat; REST and Socket.IO share persistence and checks."""

import math
from fastapi import HTTPException
from sqlalchemy import func, insert, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncConnection
from app.infrastructure.database import new_id, tables, utcnow
from app.core.security import issue_token, SOCKET_AUDIENCE
from app.core.config import get_settings

(relations_table, messages_table, users_table, doctors_table, patients_table) = (
    tables[name] for name in ("DoctorPatientRelation", "ChatMessages", "User", "Doctor", "Patient")
)


async def checked_relation(db, relation_id, user, lock=False):
    stmt = select(relations_table).where(relations_table.c.id == relation_id)
    if lock:
        stmt = stmt.with_for_update()
    row = (await db.execute(stmt)).mappings().first()
    if not row:
        raise HTTPException(404, "Relation not found")
    if user["role"] != "ADMIN" and (
        not (
            user["role"] == "DOCTOR"
            and row["doctorsUserId"] == user["id"]
            or (user["role"] == "PATIENT" and row["patientsUserId"] == user["id"])
        )
    ):
        raise HTTPException(403, "Forbidden")
    return dict(row)


async def message_view(db, row, rest=False):
    sender = (
        (
            await db.execute(
                select(users_table.c.id, users_table.c.name, users_table.c.role).where(
                    users_table.c.id == row["senderId"]
                )
            )
        )
        .mappings()
        .first()
    )
    result = dict(row)
    if rest:
        result["sender"] = dict(sender) if sender else None
    else:
        result.update(
            clientMessageId=row["clientMessageId"] or row["id"],
            senderName=sender["name"] if sender else None,
            senderRole=sender["role"] if sender else None,
        )
    return result


async def persist_message(db, relation_id, user, payload):
    await checked_relation(db, relation_id, user, lock=True)
    if not isinstance(payload, dict):
        raise HTTPException(400, "Invalid message payload")
    text = payload.get("text", payload.get("message"))
    if not isinstance(text, str) or not text.strip() or len(text.strip()) > 5000:
        raise HTTPException(400, "Message must contain 1–5000 characters")
    text = text.strip()
    key = payload.get("clientMessageId", payload.get("idempotencyKey", payload.get("id")))
    if key is not None and (not isinstance(key, str) or len(key.strip()) > 128):
        raise HTTPException(400, "clientMessageId must be a string of at most 128 characters")
    key = key.strip() or None if isinstance(key, str) else None

    async def existing_message():
        if not key:
            return None
        return (
            (
                await db.execute(
                    select(messages_table).where(
                        or_(messages_table.c.clientMessageId == key, messages_table.c.id == key)
                    )
                )
            )
            .mappings()
            .first()
        )

    def validate_existing(row):
        if row["doctorPatientRelationId"] != relation_id:
            raise HTTPException(403, "Idempotency key does not belong to this relation")
        if row["senderId"] != user["id"] or row["text"] != text:
            raise HTTPException(409, "Conflicting reuse of clientMessageId")

    existing = await existing_message()
    if existing:
        validate_existing(existing)
        return (await message_view(db, existing), True)
    message_id = key or new_id()
    try:
        async with db.begin_nested():
            await db.execute(
                insert(messages_table).values(
                    id=message_id,
                    clientMessageId=key,
                    doctorPatientRelationId=relation_id,
                    senderId=user["id"],
                    text=text,
                )
            )
    except IntegrityError:
        existing = await existing_message()
        if not existing:
            raise
        validate_existing(existing)
        return (await message_view(db, existing), True)
    await db.execute(
        update(relations_table).where(relations_table.c.id == relation_id).values(updatedAt=utcnow())
    )
    row = (await db.execute(select(messages_table).where(messages_table.c.id == message_id))).mappings().one()
    return (await message_view(db, row), False)


async def list_relations(user_id: str, role: str, user, db: AsyncConnection):
    if role not in ("PATIENT", "DOCTOR"):
        raise HTTPException(400, "role must be PATIENT or DOCTOR")
    if user["role"] != "ADMIN" and (user_id != user["id"] or role != user["role"]):
        raise HTTPException(403, "Forbidden")
    column = relations_table.c.patientsUserId if role == "PATIENT" else relations_table.c.doctorsUserId
    rows = (
        (
            await db.execute(
                select(relations_table).where(column == user_id).order_by(relations_table.c.updatedAt.desc())
            )
        )
        .mappings()
        .all()
    )
    result = []
    for row in rows:
        doctor = (
            await db.execute(select(users_table.c.name).where(users_table.c.id == row["doctorsUserId"]))
        ).scalar()
        patient = (
            await db.execute(select(users_table.c.name).where(users_table.c.id == row["patientsUserId"]))
        ).scalar()
        last = (
            (
                await db.execute(
                    select(messages_table)
                    .where(messages_table.c.doctorPatientRelationId == row["id"])
                    .order_by(messages_table.c.createdAt.desc(), messages_table.c.id.desc())
                    .limit(1)
                )
            )
            .mappings()
            .first()
        )
        result.append(
            {
                "id": row["id"],
                "doctorsUserId": row["doctorsUserId"],
                "patientsUserId": row["patientsUserId"],
                "doctorName": doctor or "Doctor",
                "patientName": patient or "Patient",
                "lastMessage": last["text"] if last else None,
                "lastMessageAt": last["createdAt"] if last else row["updatedAt"],
            }
        )
    return {"relations": result}


async def create_or_get_relation(body, user, db: AsyncConnection):
    (doctor_id, patient_id) = (body.get("doctorsUserId"), body.get("patientsUserId"))
    if not isinstance(doctor_id, str) or not isinstance(patient_id, str):
        raise HTTPException(400, "doctorsUserId and patientsUserId are required")
    if user["role"] != "ADMIN" and (
        not (
            user["role"] == "DOCTOR"
            and doctor_id == user["id"]
            or (user["role"] == "PATIENT" and patient_id == user["id"])
        )
    ):
        raise HTTPException(403, "Forbidden")
    doctor = (
        (await db.execute(select(doctors_table).where(doctors_table.c.userId == doctor_id).with_for_update()))
        .mappings()
        .first()
    )
    patient = (
        (await db.execute(select(patients_table).where(patients_table.c.userId == patient_id)))
        .mappings()
        .first()
    )
    if not doctor or not patient:
        raise HTTPException(404, "Doctor or patient not found")
    row = (
        (
            await db.execute(
                select(relations_table).where(
                    relations_table.c.doctorsUserId == doctor_id,
                    relations_table.c.patientsUserId == patient_id,
                )
            )
        )
        .mappings()
        .first()
    )
    is_new = row is None
    if is_new:
        relation_id = new_id()
        await db.execute(
            insert(relations_table).values(id=relation_id, doctorsUserId=doctor_id, patientsUserId=patient_id)
        )
        row = (
            (await db.execute(select(relations_table).where(relations_table.c.id == relation_id)))
            .mappings()
            .one()
        )
    return {"relation": dict(row), "isNew": is_new}


async def message_page(db, relation_id, page=1, limit=50, ascending=False, rest=False):
    if not 1 <= limit <= 100 or page < 1:
        raise HTTPException(400, "page must be positive and limit between 1 and 100")
    count = (
        await db.execute(
            select(func.count())
            .select_from(messages_table)
            .where(messages_table.c.doctorPatientRelationId == relation_id)
        )
    ).scalar()
    stmt = (
        select(messages_table)
        .where(messages_table.c.doctorPatientRelationId == relation_id)
        .order_by(
            messages_table.c.createdAt.asc() if ascending else messages_table.c.createdAt.desc(),
            messages_table.c.id.asc() if ascending else messages_table.c.id.desc(),
        )
        .offset((page - 1) * limit)
        .limit(limit)
    )
    rows = list((await db.execute(stmt)).mappings().all())
    if not ascending:
        rows.reverse()
    return ([await message_view(db, row, rest=rest) for row in rows], count)


async def list_messages(relation_id: str, page: int, limit: int, order: str, user, db: AsyncConnection):
    await checked_relation(db, relation_id, user)
    (rows, count) = await message_page(db, relation_id, page, limit, order == "asc", rest=True)
    pages = max(1, math.ceil(count / limit))
    return {
        "chats": rows,
        "pagination": {
            "currentPage": page,
            "pageSize": limit,
            "totalMessages": count,
            "totalPages": pages,
            "hasNextPage": page < pages,
            "hasPreviousPage": page > 1,
        },
    }


async def send_rest_message(relation_id: str, body, user, db: AsyncConnection):
    (message, duplicate) = await persist_message(db, relation_id, user, body)
    await db.commit()
    if not duplicate:
        from app.infrastructure.realtime import sio, encode

        await sio.emit("new_message", {"message": encode(message)}, room=f"relation_{relation_id}")
    return ({"chat": message}, duplicate)


async def issue_socket_ticket(relation_id, user, db):
    if relation_id:
        if not isinstance(relation_id, str):
            raise HTTPException(400, "Invalid relationId")
        await checked_relation(db, relation_id, user)
    token = issue_token({**user, "relationId": relation_id}, audience=SOCKET_AUDIENCE, expires_seconds=600)
    return {
        "success": True,
        "token": token,
        "socketUrl": get_settings().backend_public_url,
        "user": {key: user[key] for key in ("id", "name", "role")},
    }
