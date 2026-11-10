"""Ownership-scoped inbox reads and mutations."""

from fastapi import HTTPException
from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncConnection
from app.core.security import ensure_owner
from app.infrastructure.database import tables, utcnow


async def list_notifications(user_id: str, user: dict, db: AsyncConnection):
    ensure_owner(user, user_id)
    notification = tables["Notification"]
    return [
        dict(row)
        for row in (
            await db.execute(
                select(notification)
                .where(notification.c.userId == user_id)
                .order_by(notification.c.createdAt.desc())
            )
        ).mappings()
    ]


async def mark_notification_read(user_id: str, notification_id: str, user: dict, db: AsyncConnection):
    ensure_owner(user, user_id)
    notification = tables["Notification"]
    row = (
        (
            await db.execute(
                update(notification)
                .where(notification.c.id == notification_id, notification.c.userId == user_id)
                .values(isRead=True, status="READ", readAt=utcnow())
                .returning(notification)
            )
        )
        .mappings()
        .first()
    )
    if not row:
        raise HTTPException(403, "Unauthorized or not found")
    return dict(row)


async def delete_notification(user_id: str, notification_id: str, user: dict, db: AsyncConnection):
    ensure_owner(user, user_id)
    notification = tables["Notification"]
    deleted = await db.execute(
        delete(notification)
        .where(notification.c.id == notification_id, notification.c.userId == user_id)
        .returning(notification.c.id)
    )
    if not deleted.first():
        raise HTTPException(403, "Unauthorized or not found")
    return {"message": "Notification deleted"}
