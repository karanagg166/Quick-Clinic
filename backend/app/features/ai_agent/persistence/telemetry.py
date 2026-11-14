"""Tool call, model call, citation, and memory snapshot persistence."""

import hashlib
import json
from typing import Any

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncConnection

from app.infrastructure.database import new_id, tables, utcnow


def _sha256_json(payload: Any) -> str:
    encoded = json.dumps(payload, sort_keys=True, default=str, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


async def record_tool_call(
    db: AsyncConnection,
    *,
    thread_id: str,
    turn_id: str,
    tool_call_id: str,
    tool_name: str,
    input_json: dict[str, Any],
    status: str,
    action_type: str | None = None,
    risk_level: str | None = None,
    approval_id: str | None = None,
    result_json: Any = None,
    error_code: str | None = None,
    duration_ms: int | None = None,
) -> dict[str, Any]:
    tool_calls = tables["AgentToolCall"]
    now = utcnow()
    existing = (
        await db.execute(
            select(tool_calls).where(
                tool_calls.c.threadId == thread_id,
                tool_calls.c.toolCallId == tool_call_id,
            )
        )
    ).mappings().first()

    values = {
        "actionType": action_type,
        "riskLevel": risk_level,
        "resultJson": result_json,
        "resultSha256": _sha256_json(result_json) if result_json is not None else None,
        "status": status,
        "approvalId": approval_id,
        "errorCode": error_code,
        "durationMs": duration_ms,
        "completedAt": now if status in {"COMPLETED", "FAILED", "REJECTED"} else None,
    }
    if existing is not None:
        row = (
            await db.execute(
                update(tool_calls)
                .where(tool_calls.c.id == existing["id"])
                .values(**values)
                .returning(tool_calls)
            )
        ).mappings().first()
        return dict(row)

    row = (
        await db.execute(
            tool_calls.insert()
            .values(
                id=new_id(),
                threadId=thread_id,
                turnId=turn_id,
                toolCallId=tool_call_id,
                toolName=tool_name,
                inputJson=input_json,
                inputSha256=_sha256_json(input_json),
                startedAt=now,
                **values,
            )
            .returning(tool_calls)
        )
    ).mappings().first()
    return dict(row)


async def record_model_call(
    db: AsyncConnection,
    *,
    thread_id: str,
    turn_id: str | None,
    purpose: str,
    provider: str,
    model: str,
    status: str = "COMPLETED",
    prompt_tokens: int | None = None,
    completion_tokens: int | None = None,
    total_tokens: int | None = None,
    latency_ms: int | None = None,
    error_code: str | None = None,
    fallback_from: str | None = None,
) -> dict[str, Any]:
    model_calls = tables["AgentModelCall"]
    now = utcnow()
    row = (
        await db.execute(
            model_calls.insert()
            .values(
                id=new_id(),
                threadId=thread_id,
                turnId=turn_id,
                purpose=purpose,
                provider=provider,
                model=model,
                promptTokens=prompt_tokens,
                completionTokens=completion_tokens,
                totalTokens=total_tokens,
                latencyMs=latency_ms,
                fallbackFrom=fallback_from,
                status=status,
                errorCode=error_code,
                createdAt=now,
                completedAt=now,
            )
            .returning(model_calls)
        )
    ).mappings().first()
    return dict(row)


async def create_memory_snapshot(
    db: AsyncConnection,
    *,
    thread_id: str,
    summary: str,
    covered_message_ids: list[str],
    source_chunk_ids: list[str],
    permission_revision: int,
    latest_message_id: str | None = None,
    summarizer_model: str | None = None,
) -> dict[str, Any]:
    snapshots = tables["AgentMemorySnapshot"]
    threads = tables["AgentThread"]

    thread = (await db.execute(select(threads).where(threads.c.id == thread_id))).mappings().first()
    next_version = int(thread["latestMemoryVersion"] if thread else 0) + 1
    now = utcnow()
    row = (
        await db.execute(
            snapshots.insert()
            .values(
                id=new_id(),
                threadId=thread_id,
                version=next_version,
                summary=summary,
                summarySha256=hashlib.sha256(summary.encode("utf-8")).hexdigest(),
                coveredMessageIds=covered_message_ids,
                sourceChunkIds=source_chunk_ids,
                latestMessageId=latest_message_id,
                tokenCount=max(1, len(summary.split())),
                summarizerModel=summarizer_model,
                permissionRevision=permission_revision,
                createdAt=now,
            )
            .returning(snapshots)
        )
    ).mappings().first()
    await db.execute(
        update(threads).where(threads.c.id == thread_id).values(latestMemoryVersion=next_version, updatedAt=now)
    )
    return dict(row)


async def get_latest_valid_memory(
    db: AsyncConnection,
    *,
    thread_id: str,
    permission_revision: int,
) -> dict[str, Any] | None:
    snapshots = tables["AgentMemorySnapshot"]
    row = (
        await db.execute(
            select(snapshots)
            .where(
                snapshots.c.threadId == thread_id,
                snapshots.c.invalidatedAt.is_(None),
                snapshots.c.permissionRevision == permission_revision,
            )
            .order_by(snapshots.c.version.desc())
            .limit(1)
        )
    ).mappings().first()
    return dict(row) if row else None


async def invalidate_thread_memory(
    db: AsyncConnection,
    *,
    thread_id: str,
    reason: str,
) -> None:
    snapshots = tables["AgentMemorySnapshot"]
    threads = tables["AgentThread"]
    now = utcnow()
    await db.execute(
        update(snapshots)
        .where(snapshots.c.threadId == thread_id, snapshots.c.invalidatedAt.is_(None))
        .values(invalidatedAt=now, invalidationReason=reason)
    )
    await db.execute(
        update(threads)
        .where(threads.c.id == thread_id)
        .values(permissionRevision=threads.c.permissionRevision + 1, updatedAt=now)
    )
