"""Human chat event adapters share canonical persistence with the REST API."""

import time
from fastapi import HTTPException
from sqlalchemy import and_, or_, select, update
from app.infrastructure.database import tables, utcnow
from app.features.messaging.service import message_page, message_view, persist_message
from app.features.scheduling.validation import parse_datetime
from .server import sio, encode, _limits
from .sessions import checked_event


@sio.event
@checked_event()
async def get_initial_messages(sid, data, db, session):
    page, limit = max(1, int(data.get("page", 1))), min(100, max(1, int(data.get("limit", 50))))
    messages, count = await message_page(db, session["relationId"], page, limit)
    result = encode(
        {
            "messages": messages,
            "pagination": {"page": page, "limit": limit, "total": count, "hasMore": page * limit < count},
        }
    )
    await sio.emit("initial_messages", result, to=sid)
    return {"success": True, **result}


@sio.event
@checked_event()
async def sync_messages(sid, data, db, session):
    messages = tables["ChatMessages"]
    stmt = select(messages).where(messages.c.doctorPatientRelationId == session["relationId"])
    if data.get("since"):
        since = parse_datetime(data["since"])
        condition = messages.c.createdAt > since
        if data.get("lastMessageId"):
            condition = or_(
                condition, and_(messages.c.createdAt == since, messages.c.id > data["lastMessageId"])
            )
        stmt = stmt.where(condition)
    limit = min(100, max(1, int(data.get("limit", 100))))
    rows = (
        (await db.execute(stmt.order_by(messages.c.createdAt, messages.c.id).limit(limit))).mappings().all()
    )
    result = encode(
        {
            "success": True,
            "messages": [await message_view(db, row) for row in rows],
            "hasMore": len(rows) == limit,
        }
    )
    await sio.emit("sync_messages_result", result, to=sid)
    return result


def check_limit(sid, name, count, seconds):
    key = (sid, name)
    now = time.monotonic()
    events = [stamp for stamp in _limits.get(key, []) if now - stamp < seconds]
    if len(events) >= count:
        raise HTTPException(429, "Rate limit exceeded")
    _limits[key] = events + [now]


@sio.event
@checked_event()
async def send_message(sid, data, db, session):
    check_limit(sid, "message", 30, 60)
    message, duplicate = await persist_message(db, session["relationId"], session["user"], data)
    # Commit before exposing canonical message to clients.
    await db.commit()
    if not duplicate:
        await sio.emit("new_message", {"message": encode(message)}, room=f"relation_{session['relationId']}")
    return {"success": True, "message": encode(message)}


@sio.event
@checked_event()
async def user_typing(sid, data, db, session):
    check_limit(sid, "typing", 1, 1.5)
    user = session["user"]
    await sio.emit(
        "user_typing",
        {"userId": user["id"], "userName": user["name"], "userRole": user["role"]},
        room=f"relation_{session['relationId']}",
        skip_sid=sid,
    )
    return {"success": True}


@sio.event
@checked_event()
async def user_stop_typing(sid, data, db, session):
    await sio.emit(
        "user_stop_typing",
        {"userId": session["user"]["id"]},
        room=f"relation_{session['relationId']}",
        skip_sid=sid,
    )
    return {"success": True}


@sio.event
@checked_event()
async def mark_as_read(sid, data, db, session):
    messages, relations = tables["ChatMessages"], tables["DoctorPatientRelation"]
    relation_id, user = session["relationId"], session["user"]
    stmt = select(messages).where(messages.c.doctorPatientRelationId == relation_id)
    if data.get("messageId"):
        stmt = stmt.where(messages.c.id == data["messageId"])
    elif data.get("lastReadAt"):
        stmt = stmt.where(messages.c.createdAt <= parse_datetime(data["lastReadAt"]))
    else:
        raise HTTPException(400, "messageId or lastReadAt required")
    target = (
        (await db.execute(stmt.order_by(messages.c.createdAt.desc(), messages.c.id.desc()).limit(1)))
        .mappings()
        .first()
    )
    if not target or target["senderId"] == user["id"]:
        return {"success": False, "error": "Message not found or sent by self"}
    now = utcnow()
    await db.execute(
        update(messages)
        .where(
            messages.c.doctorPatientRelationId == relation_id,
            messages.c.senderId != user["id"],
            messages.c.createdAt <= target["createdAt"],
            messages.c.isRead.is_(False),
        )
        .values(isRead=True, readAt=now, updatedAt=now)
    )
    if user["role"] in ("DOCTOR", "PATIENT"):
        cursor = relations.c.doctorLastReadAt if user["role"] == "DOCTOR" else relations.c.patientLastReadAt
        await db.execute(
            update(relations)
            .where(relations.c.id == relation_id, or_(cursor.is_(None), cursor < target["createdAt"]))
            .values({cursor.name: target["createdAt"]})
        )
    await db.commit()
    receipt = {"messageId": target["id"], "readBy": user["id"]}
    await sio.emit("message_read", receipt, room=f"relation_{relation_id}", skip_sid=sid)
    await sio.emit(
        "message_read", {**receipt, "relationId": relation_id}, room=f"user_{user['id']}", skip_sid=sid
    )
    return {"success": True, **receipt, "relationId": relation_id, "readAt": encode(now)}
