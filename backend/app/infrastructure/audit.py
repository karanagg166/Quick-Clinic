"""Audit event persistence shared across feature use cases."""

from sqlalchemy import insert
from sqlalchemy.ext.asyncio import AsyncConnection
from app.infrastructure.database import new_id, tables, utcnow


async def record_audit_event(db: AsyncConnection, user_id: str, action: str, metadata=None):
    await db.execute(
        insert(tables["AuditLog"]).values(
            id=new_id(), userId=user_id, action=action, tag="AUTH", metadata=metadata, createdAt=utcnow()
        )
    )
