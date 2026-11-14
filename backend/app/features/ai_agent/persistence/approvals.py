"""Durable approval repository for the Quick-Clinic Doctor Agent.

Requires the AgentApproval database table and SQLAlchemy mapping.
All operations use the caller's existing database transaction.
"""

from datetime import timedelta
from typing import Any

from fastapi import HTTPException
from sqlalchemy import or_, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.ext.asyncio import AsyncConnection

from app.infrastructure.audit import record_audit_event
from app.infrastructure.database import new_id, utcnow

from .approval_execution import (
    claim_execution,
    complete_execution,
    recover_stale_executions,
)
from .approval_queries import get_approval, list_thread_approvals
from .approval_helpers import (
    APPROVAL_TTL_SECONDS,
    DOCTOR_ACTION_PERMISSIONS,
    approval_table,
    check_text,
    enum_value,
    payload_hash,
    require_doctor_actor,
)

__all__ = [
    "APPROVAL_TTL_SECONDS",
    "DOCTOR_ACTION_PERMISSIONS",
    "claim_execution",
    "complete_execution",
    "create_or_get_approval",
    "decide_approval",
    "get_approval",
    "list_thread_approvals",
    "recover_stale_executions",
    "verify_approved",
]


async def create_or_get_approval(
    db: AsyncConnection,
    *,
    actor: dict[str, Any],
    thread_id: str,
    tool_call_id: str,
    action_type: str,
    risk_level: str,
    parameters: dict[str, Any],
    title: str,
    summary: str,
    reason: str,
    idempotency_key: str,
) -> dict[str, Any]:
    """Create one durable approval per proposed tool call.

    Retries return the original proposal without renewing expiry.
    """

    action_type = enum_value(action_type)
    risk_level = enum_value(risk_level)
    actor_id = require_doctor_actor(actor, action_type)

    if risk_level != "MEDIUM_HUMAN_APPROVAL":
        raise HTTPException(403, "Unsupported approval risk level")

    thread_id = check_text(thread_id, "thread ID", 128)
    tool_call_id = check_text(tool_call_id, "tool call ID", 128)
    idempotency_key = check_text(idempotency_key, "idempotency key", 128, 16)
    title = check_text(title, "title", 120)
    summary = check_text(summary, "summary", 600)
    reason = check_text(reason, "reason", 300)

    digest = payload_hash(
        actor_id=actor_id,
        thread_id=thread_id,
        tool_call_id=tool_call_id,
        action_type=action_type,
        risk_level=risk_level,
        parameters=parameters,
        title=title,
        summary=summary,
        reason=reason,
        idempotency_key=idempotency_key,
    )

    table = approval_table()
    now = utcnow()
    values = {
        "id": new_id(),
        "threadId": thread_id,
        "toolCallId": tool_call_id,
        "requestedByUserId": actor_id,
        "approvedByUserId": None,
        "actionType": action_type,
        "riskLevel": risk_level,
        "title": title,
        "summary": summary,
        "reason": reason,
        "parameters": parameters,
        "payloadHash": digest,
        "idempotencyKey": idempotency_key,
        "status": "PENDING",
        "executionStatus": "NOT_STARTED",
        "createdAt": now,
        "expiresAt": now + timedelta(seconds=APPROVAL_TTL_SECONDS),
    }

    if db.dialect.name == "postgresql":
        stmt = pg_insert(table).values(**values).on_conflict_do_nothing()
    elif db.dialect.name == "sqlite":
        stmt = sqlite_insert(table).values(**values).on_conflict_do_nothing()
    else:
        raise RuntimeError("Unsupported approval database dialect")

    result = await db.execute(stmt)
    rows = (
        await db.execute(
            select(table)
            .where(
                or_(
                    (table.c.threadId == thread_id) & (table.c.toolCallId == tool_call_id),
                    table.c.idempotencyKey == idempotency_key,
                )
            )
            .limit(2)
        )
    ).mappings().all()

    if len(rows) != 1:
        raise HTTPException(409, "Conflicting approval proposal")

    approval = dict(rows[0])
    if (
        approval["requestedByUserId"] != actor_id
        or approval["threadId"] != thread_id
        or approval["toolCallId"] != tool_call_id
        or approval["payloadHash"] != digest
        or approval["idempotencyKey"] != idempotency_key
    ):
        raise HTTPException(409, "Approval proposal does not match the original")

    if result.rowcount:
        await record_audit_event(
            db,
            actor_id,
            "AI_AGENT:APPROVAL_PROPOSED",
            {"approvalId": approval["id"], "action": action_type},
        )

    return approval


async def decide_approval(
    db: AsyncConnection,
    *,
    actor: dict[str, Any],
    thread_id: str,
    approval_id: str,
    decision: str,
    decision_reason: str | None = None,
) -> dict[str, Any]:
    """Atomically approve or reject a pending request."""

    actor_id = require_doctor_actor(actor)
    decision = enum_value(decision)
    if decision not in {"APPROVED", "REJECTED"}:
        raise HTTPException(422, "Invalid approval decision")
    if decision_reason is not None:
        check_text(decision_reason, "decision reason", 300, 0)

    current = await get_approval(db, actor=actor, thread_id=thread_id, approval_id=approval_id)
    require_doctor_actor(actor, enum_value(current["actionType"]))

    table = approval_table()
    now = utcnow()
    row = (
        await db.execute(
            update(table)
            .where(
                table.c.id == approval_id,
                table.c.threadId == thread_id,
                table.c.requestedByUserId == actor_id,
                table.c.status == "PENDING",
                table.c.expiresAt > now,
            )
            .values(
                status=decision,
                approvedByUserId=actor_id,
                decidedAt=now,
                decisionReason=decision_reason,
            )
            .returning(table)
        )
    ).mappings().first()

    if row is not None:
        await record_audit_event(
            db,
            actor_id,
            "AI_AGENT:APPROVAL_DECIDED",
            {"approvalId": approval_id, "decision": decision},
        )
        return dict(row)

    current = await get_approval(db, actor=actor, thread_id=thread_id, approval_id=approval_id)
    if current["expiresAt"] <= now and enum_value(current["executionStatus"]) == "NOT_STARTED":
        await db.execute(
            update(table)
            .where(
                table.c.id == approval_id,
                table.c.status.in_(["PENDING", "APPROVED"]),
                table.c.executionStatus == "NOT_STARTED",
                table.c.expiresAt <= now,
            )
            .values(status="EXPIRED")
        )
        raise HTTPException(410, "Approval expired")

    if enum_value(current["status"]) == decision and current["approvedByUserId"] == actor_id:
        return current

    raise HTTPException(409, "Approval already decided or unavailable")


async def verify_approved(
    db: AsyncConnection,
    *,
    actor: dict[str, Any],
    thread_id: str,
    approval_id: str,
    tool_call_id: str,
    action_type: str,
    payload_hash: str,
    idempotency_key: str,
) -> bool:
    """Verify the persisted approval before resuming execution."""

    action_type = enum_value(action_type)
    actor_id = require_doctor_actor(actor, action_type)
    table = approval_table()

    row = (
        await db.execute(
            select(table.c.id).where(
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
                table.c.expiresAt > utcnow(),
            )
        )
    ).first()

    return row is not None
