"""Thread, turn, and message persistence for Quick-Clinic AI agents."""

import hashlib
from typing import Any

from fastapi import HTTPException
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncConnection

from app.infrastructure.database import new_id, tables, utcnow


def _sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _require_actor(actor: dict[str, Any]) -> str:
    if not isinstance(actor, dict) or not actor.get("id") or actor.get("isActive") is not True:
        raise HTTPException(403, "Active authenticated user required")
    return str(actor["id"])


async def _resolve_doctor_id(db: AsyncConnection, actor: dict[str, Any]) -> str | None:
    if actor.get("role") != "DOCTOR":
        return None
    doctors = tables["Doctor"]
    row = (await db.execute(select(doctors.c.id).where(doctors.c.userId == actor["id"]))).first()
    return row[0] if row else None


async def create_or_get_thread(
    db: AsyncConnection,
    *,
    actor: dict[str, Any],
    thread_id: str | None = None,
    scope_type: str = "GENERAL",
    purpose: str = "CLINIC_ASSISTANT",
    title: str = "New conversation",
    patient_id: str | None = None,
) -> dict[str, Any]:
    """Create a thread owned by the authenticated user or return it if owned."""

    user_id = _require_actor(actor)
    threads = tables["AgentThread"]
    tid = (thread_id or "").strip() or new_id()

    existing = (await db.execute(select(threads).where(threads.c.id == tid))).mappings().first()
    if existing is not None:
        if existing["ownerUserId"] != user_id or existing["status"] == "REDACTED":
            raise HTTPException(404, "Conversation thread not found")
        return dict(existing)

    doctor_id = await _resolve_doctor_id(db, actor)
    now = utcnow()
    clean_title = (title or "New conversation").strip()[:120] or "New conversation"
    row = (
        await db.execute(
            threads.insert()
            .values(
                id=tid,
                ownerUserId=user_id,
                doctorId=doctor_id,
                patientId=patient_id,
                scopeType=scope_type,
                purpose=purpose,
                title=clean_title,
                status="ACTIVE",
                permissionRevision=1,
                latestMemoryVersion=0,
                createdAt=now,
                updatedAt=now,
            )
            .returning(threads)
        )
    ).mappings().first()
    return dict(row)


async def get_owned_thread(
    db: AsyncConnection,
    *,
    actor: dict[str, Any],
    thread_id: str,
) -> dict[str, Any]:
    user_id = _require_actor(actor)
    threads = tables["AgentThread"]
    row = (
        await db.execute(
            select(threads).where(
                threads.c.id == thread_id,
                threads.c.ownerUserId == user_id,
                threads.c.status != "REDACTED",
            )
        )
    ).mappings().first()
    if row is None:
        raise HTTPException(404, "Conversation thread not found")
    return dict(row)


async def list_owned_threads(
    db: AsyncConnection,
    *,
    actor: dict[str, Any],
    limit: int = 30,
) -> list[dict[str, Any]]:
    user_id = _require_actor(actor)
    threads = tables["AgentThread"]
    rows = (
        await db.execute(
            select(threads)
            .where(
                threads.c.ownerUserId == user_id,
                threads.c.status == "ACTIVE",
            )
            .order_by(threads.c.updatedAt.desc())
            .limit(max(1, min(limit, 100)))
        )
    ).mappings().all()
    return [dict(r) for r in rows]


async def archive_owned_thread(
    db: AsyncConnection,
    *,
    actor: dict[str, Any],
    thread_id: str,
) -> dict[str, Any]:
    user_id = _require_actor(actor)
    threads = tables["AgentThread"]
    row = (
        await db.execute(
            update(threads)
            .where(threads.c.id == thread_id, threads.c.ownerUserId == user_id)
            .values(status="ARCHIVED", updatedAt=utcnow())
            .returning(threads)
        )
    ).mappings().first()
    if row is None:
        raise HTTPException(404, "Conversation thread not found")
    return dict(row)


async def append_turn(
    db: AsyncConnection,
    *,
    thread_id: str,
    original_query: str,
    retrieval_query: str | None = None,
    rewritten: bool = False,
    requires_history: bool = False,
    query_route: str | None = None,
    classification: dict[str, Any] | None = None,
    planned_tools: list[str] | None = None,
) -> dict[str, Any]:
    turns = tables["AgentTurn"]
    max_idx = (
        await db.execute(select(func.coalesce(func.max(turns.c.turnIndex), 0)).where(turns.c.threadId == thread_id))
    ).scalar_one()
    row = (
        await db.execute(
            turns.insert()
            .values(
                id=new_id(),
                threadId=thread_id,
                turnIndex=int(max_idx) + 1,
                originalQuery=original_query,
                retrievalQuery=retrieval_query,
                rewritten=rewritten,
                requiresHistory=requires_history,
                queryRoute=query_route,
                classification=classification,
                plannedTools=planned_tools,
                status="RUNNING",
                startedAt=utcnow(),
            )
            .returning(turns)
        )
    ).mappings().first()
    return dict(row)


async def complete_turn(
    db: AsyncConnection,
    *,
    turn_id: str,
    status: str = "COMPLETED",
    response_text: str | None = None,
) -> None:
    turns = tables["AgentTurn"]
    await db.execute(
        update(turns)
        .where(turns.c.id == turn_id)
        .values(
            status=status,
            responseHash=_sha256_text(response_text) if response_text else None,
            completedAt=utcnow(),
        )
    )


async def append_message(
    db: AsyncConnection,
    *,
    thread_id: str,
    turn_id: str | None,
    role: str,
    content: str,
    status: str = "COMPLETED",
    metadata: dict[str, Any] | None = None,
) -> dict[str, Any]:
    messages = tables["AgentMessage"]
    threads = tables["AgentThread"]
    max_seq = (
        await db.execute(
            select(func.coalesce(func.max(messages.c.sequence), 0)).where(messages.c.threadId == thread_id)
        )
    ).scalar_one()
    now = utcnow()
    row = (
        await db.execute(
            messages.insert()
            .values(
                id=new_id(),
                threadId=thread_id,
                turnId=turn_id,
                sequence=int(max_seq) + 1,
                role=role,
                status=status,
                content=content,
                contentSha256=_sha256_text(content),
                messageMetadata=metadata,
                createdAt=now,
            )
            .returning(messages)
        )
    ).mappings().first()

    title_update: dict[str, Any] = {"lastMessageAt": now, "updatedAt": now}
    if role == "USER" and int(max_seq) == 0:
        clean = content.strip().replace("\n", " ")
        title_update["title"] = (clean[:45] + "...") if len(clean) > 48 else (clean or "New conversation")
    await db.execute(update(threads).where(threads.c.id == thread_id).values(**title_update))
    return dict(row)


async def list_thread_messages(
    db: AsyncConnection,
    *,
    thread_id: str,
    limit: int = 50,
) -> list[dict[str, Any]]:
    messages = tables["AgentMessage"]
    rows = (
        await db.execute(
            select(messages)
            .where(messages.c.threadId == thread_id, messages.c.status != "REDACTED")
            .order_by(messages.c.sequence.asc())
            .limit(max(1, min(limit, 200)))
        )
    ).mappings().all()
    return [dict(r) for r in rows]
