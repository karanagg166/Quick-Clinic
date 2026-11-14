"""Atomic execution claiming and completion for approved agent actions."""

from datetime import timedelta
from typing import Any

from fastapi import HTTPException
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncConnection

from app.infrastructure.audit import record_audit_event
from app.infrastructure.database import utcnow

from .approval_helpers import (
    EXECUTION_LEASE_SECONDS,
    approval_table,
    check_text,
    enum_value,
    require_doctor_actor,
)


async def claim_execution(
    db: AsyncConnection,
    *,
    actor: dict[str, Any],
    thread_id: str,
    approval_id: str,
    tool_call_id: str,
    action_type: str,
    payload_hash: str,
    idempotency_key: str,
) -> dict[str, Any]:
    """Atomically claim execution exactly once.

    The caller must execute using the persisted parameters returned here,
    never newly generated LLM arguments.
    """

    action_type = enum_value(action_type)
    actor_id = require_doctor_actor(actor, action_type)
    table = approval_table()
    now = utcnow()
    lease_expires_at = now + timedelta(seconds=EXECUTION_LEASE_SECONDS)

    row = (
        await db.execute(
            update(table)
            .where(
                table.c.id == approval_id,
                table.c.threadId == thread_id,
                table.c.toolCallId == tool_call_id,
                table.c.requestedByUserId == actor_id,
                table.c.approvedByUserId == actor_id,
                table.c.actionType == action_type,
                table.c.payloadHash == payload_hash,
                table.c.idempotencyKey == idempotency_key,
                table.c.status == "APPROVED",
                table.c.executionStatus == "NOT_STARTED",
                table.c.expiresAt > now,
            )
            .values(
                executionStatus="EXECUTING",
                executedAt=now,
                executionLeaseExpiresAt=lease_expires_at,
                executionAttempts=table.c.executionAttempts + 1,
            )
            .returning(table)
        )
    ).mappings().first()

    if row is None:
        raise HTTPException(409, "Approval unavailable or execution already claimed")

    return dict(row)


async def complete_execution(
    db: AsyncConnection,
    *,
    actor: dict[str, Any],
    thread_id: str,
    approval_id: str,
    success: bool,
    result_code: str,
    error_code: str | None = None,
) -> dict[str, Any]:
    """Record a minimal outcome without private patient data."""

    actor_id = require_doctor_actor(actor)
    result_code = check_text(result_code, "execution result code", 64)
    table = approval_table()
    now = utcnow()

    row = (
        await db.execute(
            update(table)
            .where(
                table.c.id == approval_id,
                table.c.threadId == thread_id,
                table.c.requestedByUserId == actor_id,
                table.c.approvedByUserId == actor_id,
                table.c.status == "APPROVED",
                table.c.executionStatus == "EXECUTING",
            )
            .values(
                executionStatus="COMPLETED" if success else "FAILED",
                completedAt=now,
                executionLeaseExpiresAt=None,
                lastErrorCode=error_code,
                executionResult={"code": result_code},
            )
            .returning(table)
        )
    ).mappings().first()

    if row is None:
        raise HTTPException(409, "Execution state cannot be completed")

    await record_audit_event(
        db,
        actor_id,
        "AI_AGENT:APPROVAL_EXECUTION",
        {
            "approvalId": approval_id,
            "success": success,
            "code": result_code,
        },
    )

    return dict(row)


async def recover_stale_executions(db: AsyncConnection) -> int:
    """Mark expired EXECUTING leases as FAILED so recovery is explicit."""

    table = approval_table()
    now = utcnow()
    res = await db.execute(
        update(table)
        .where(
            table.c.executionStatus == "EXECUTING",
            table.c.executionLeaseExpiresAt.is_not(None),
            table.c.executionLeaseExpiresAt <= now,
        )
        .values(
            executionStatus="FAILED",
            completedAt=now,
            executionLeaseExpiresAt=None,
            lastErrorCode="EXECUTION_LEASE_EXPIRED",
            executionResult={"code": "EXECUTION_LEASE_EXPIRED"},
        )
    )
    return int(res.rowcount or 0)
