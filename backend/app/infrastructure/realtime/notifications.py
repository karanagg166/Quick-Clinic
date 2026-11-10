"""Durable outbox delivery and explicit connection revocation."""

from sqlalchemy import select
from app.infrastructure import database
from app.infrastructure.database import tables
from .server import sio, encode, _sessions


async def publish_outbox(channel, target_user_id, payload):
    user_table = tables["User"]
    async with database.engine.connect() as db:
        active = (
            await db.execute(select(user_table.c.isActive).where(user_table.c.id == target_user_id))
        ).scalar()
    if not active:
        return
    event = {
        "SOCKET_NOTIFICATION": "new_notification",
        "SOCKET_APPOINTMENT_REQUEST": "new_appointment_request",
        "SOCKET_APPOINTMENT_STATUS": "appointment_status_update",
    }.get(channel)
    if not event:
        raise ValueError(f"Unsupported outbox channel: {channel}")
    notification = payload.get("notification")
    appointment = payload.get("appointment") or {
        key: value
        for key, value in payload.items()
        if key not in ("notification", "doctorUserId", "patientUserId", "userId")
    }
    if "appointmentId" in appointment and "id" not in appointment:
        appointment = {**appointment, "id": appointment["appointmentId"]}
    body = (
        {"notification": notification} if channel == "SOCKET_NOTIFICATION" else {"appointment": appointment}
    )
    await sio.emit(event, encode(body), room=f"user_{target_user_id}")
    if notification and channel != "SOCKET_NOTIFICATION":
        await sio.emit(
            "new_notification", encode({"notification": notification}), room=f"user_{target_user_id}"
        )


async def revoke_user(user_id, reason="Account access revoked"):
    await sio.emit("account_revoked", {"reason": reason}, room=f"user_{user_id}")
    for sid, session in list(_sessions.items()):
        if session["user"]["id"] == user_id:
            await sio.disconnect(sid)


async def revoke_relation(relation_id, reason="Conversation access revoked"):
    await sio.emit(
        "relation_revoked", {"relationId": relation_id, "reason": reason}, room=f"relation_{relation_id}"
    )
    for sid, session in list(_sessions.items()):
        if session.get("relationId") == relation_id:
            await sio.disconnect(sid)
