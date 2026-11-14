"""Read queries for durable agent approvals."""

from typing import Any

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncConnection

from .approval_helpers import approval_table, require_doctor_actor


async def get_approval(
    db: AsyncConnection,
    *,
    actor: dict[str, Any],
    thread_id: str,
    approval_id: str,
) -> dict[str, Any]:
    """Return only an approval belonging to this doctor."""

    actor_id = require_doctor_actor(actor)
    table = approval_table()
    row = (
        await db.execute(
            select(table).where(
                table.c.id == approval_id,
                table.c.threadId == thread_id,
                table.c.requestedByUserId == actor_id,
            )
        )
    ).mappings().first()

    if row is None:
        raise HTTPException(404, "Approval not found")
    return dict(row)


async def list_thread_approvals(
    db: AsyncConnection,
    *,
    actor: dict[str, Any],
    thread_id: str,
) -> list[dict[str, Any]]:
    """List approvals for an owned thread."""

    actor_id = require_doctor_actor(actor)
    table = approval_table()
    rows = (
        await db.execute(
            select(table)
            .where(table.c.threadId == thread_id, table.c.requestedByUserId == actor_id)
            .order_by(table.c.createdAt.asc())
        )
    ).mappings().all()
    return [dict(row) for row in rows]
