
"""Durable approval repository for the Quick-Clinic Doctor Agent.

Requires the AgentApproval database table and SQLAlchemy mapping.
All operations use the caller's existing database transaction.
"""

import hashlib
import json
from datetime import timedelta
from enum import Enum
from typing import Any

from fastapi import HTTPException
from sqlalchemy import or_, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.ext.asyncio import AsyncConnection

from app.infrastructure.audit import record_audit_event
from app.infrastructure.database import new_id, tables, utcnow
from app.features.ai_agent.security.permissions import require_permission


APPROVAL_TTL_SECONDS = 60


# These mappings authorize proposals only.
# They do NOT authorize execution without human approval.
DOCTOR_ACTION_PERMISSIONS = {
    "APPLY_LEAVE": "upsert_leave",
    "UPDATE_LEAVE": "upsert_leave",
    "CANCEL_LEAVE": "cancel_leave",
    "UPDATE_SCHEDULE": "upsert_schedule",
    "CREATE_SLOT": "create_ad_hoc_slot",
    "UPDATE_SLOT": "set_slot_availability",
    "REMOVE_SLOT": "remove_available_slot",
    "UPDATE_APPOINTMENT": "update_doctor_appointment",
    "CANCEL_APPOINTMENT": "update_doctor_appointment",
    "UPDATE_DOCTOR_PROFILE": "update_doctor_profile",
    "SEND_PATIENT_MESSAGE": "send_rest_message",
}


def _table():
    """Resolve the model only when approval persistence is used."""

    table = tables.get("AgentApproval")

    if table is None:
        raise RuntimeError(
            "AgentApproval schema is not installed. "
            "Apply the database migration and synchronize "
            "backend schema.json first."
        )

    return table


def _value(value: str | Enum) -> str:
    return value.value if isinstance(value, Enum) else value


def _require_doctor(
    actor: dict[str, Any],
    action: str | None = None,
) -> str:
    """Validate authenticated doctor identity and permission."""

    if not isinstance(actor, dict) or actor.get("role") != "DOCTOR":
        raise HTTPException(403, "Doctor authorization required")

    user_id = actor.get("id")

    if (
        not isinstance(user_id, str)
        or not user_id
        or actor.get("isActive") is not True
    ):
        raise HTTPException(403, "Active doctor required")

    if action is not None:
        permission = DOCTOR_ACTION_PERMISSIONS.get(action)

        if permission is None:
            raise HTTPException(
                403, "Unsupported doctor approval action"
            )

        require_permission(actor, permission)

    return user_id


def _check_text(
    value: str,
    field: str,
    maximum: int,
    minimum: int = 1,
) -> str:
    if (
        not isinstance(value, str)
        or not minimum <= len(value) <= maximum
    ):
        raise HTTPException(422, f"Invalid {field}")

    return value


def _payload_hash(
    *,
    actor_id: str,
    thread_id: str,
    tool_call_id: str,
    action_type: str,
    risk_level: str,
    parameters: dict[str, Any],
    title: str,
    summary: str,
    reason: str,
    idempotency_key: str,
) -> str:
    """Hash the exact validated proposal and its context."""

    if not isinstance(parameters, dict):
        raise HTTPException(
            422, "Action parameters must be an object"
        )

    payload = {
        "actor_id": actor_id,
        "thread_id": thread_id,
        "tool_call_id": tool_call_id,
        "action_type": action_type,
        "risk_level": risk_level,
        "parameters": parameters,
        "title": title,
        "summary": summary,
        "reason": reason,
        "idempotency_key": idempotency_key,
    }

    try:
        encoded = json.dumps(
            payload,
            sort_keys=True,
            separators=(",", ":"),
            ensure_ascii=False,
            allow_nan=False,
        ).encode("utf-8")
    except (TypeError, ValueError) as exc:
        raise HTTPException(
            422, "Action parameters must be JSON serializable"
        ) from exc

    if len(encoded) > 8192:
        raise HTTPException(
            413, "Approval proposal is too large"
        )

    return hashlib.sha256(encoded).hexdigest()


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

    action_type = _value(action_type)
    risk_level = _value(risk_level)

    actor_id = _require_doctor(actor, action_type)

    if risk_level != "MEDIUM_HUMAN_APPROVAL":
        raise HTTPException(
            403, "Unsupported approval risk level"
        )

    thread_id = _check_text(thread_id, "thread ID", 128)
    tool_call_id = _check_text(
        tool_call_id, "tool call ID", 128
    )
    idempotency_key = _check_text(
        idempotency_key, "idempotency key", 128, 16
    )
    title = _check_text(title, "title", 120)
    summary = _check_text(summary, "summary", 600)
    reason = _check_text(reason, "reason", 300)

    digest = _payload_hash(
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

    table = _table()
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
        "expiresAt": now + timedelta(
            seconds=APPROVAL_TTL_SECONDS
        ),
    }

    if db.dialect.name == "postgresql":
        stmt = (
            pg_insert(table)
            .values(**values)
            .on_conflict_do_nothing()
        )
    elif db.dialect.name == "sqlite":
        stmt = (
            sqlite_insert(table)
            .values(**values)
            .on_conflict_do_nothing()
        )
    else:
        raise RuntimeError(
            "Unsupported approval database dialect"
        )

    result = await db.execute(stmt)

    rows = (
        await db.execute(
            select(table).where(
                or_(
                    (
                        (table.c.threadId == thread_id)
                        & (table.c.toolCallId == tool_call_id)
                    ),
                    table.c.idempotencyKey == idempotency_key,
                )
            ).limit(2)
        )
    ).mappings().all()

    if len(rows) != 1:
        raise HTTPException(
            409, "Conflicting approval proposal"
        )

    approval = dict(rows[0])

    if (
        approval["requestedByUserId"] != actor_id
        or approval["threadId"] != thread_id
        or approval["toolCallId"] != tool_call_id
        or approval["payloadHash"] != digest
        or approval["idempotencyKey"] != idempotency_key
    ):
        raise HTTPException(
            409, "Approval proposal does not match the original"
        )

    if result.rowcount:
        await record_audit_event(
            db,
            actor_id,
            "AI_AGENT:APPROVAL_PROPOSED",
            {
                "approvalId": approval["id"],
                "action": action_type,
            },
        )

    return approval


async def get_approval(
    db: AsyncConnection,
    *,
    actor: dict[str, Any],
    thread_id: str,
    approval_id: str,
) -> dict[str, Any]:
    """Return only an approval belonging to this doctor."""

    actor_id = _require_doctor(actor)
    table = _table()

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
        raise HTTPException(
            404, "Approval not found"
        )

    return dict(row)


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

    actor_id = _require_doctor(actor)
    decision = _value(decision)

    if decision not in {"APPROVED", "REJECTED"}:
        raise HTTPException(422, "Invalid approval decision")

    if decision_reason is not None:
        _check_text(
            decision_reason, "decision reason", 300, 0
        )

    current = await get_approval(
        db,
        actor=actor,
        thread_id=thread_id,
        approval_id=approval_id,
    )

    _require_doctor(actor, _value(current["actionType"]))

    table = _table()
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
            {
                "approvalId": approval_id,
                "decision": decision,
            },
        )

        return dict(row)

    current = await get_approval(
        db,
        actor=actor,
        thread_id=thread_id,
        approval_id=approval_id,
    )

    if (
        current["expiresAt"] <= now
        and _value(current["executionStatus"]) == "NOT_STARTED"
    ):
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

    if (
        _value(current["status"]) == decision
        and current["approvedByUserId"] == actor_id
    ):
        return current

    raise HTTPException(
        409, "Approval already decided or unavailable"
    )


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

    action_type = _value(action_type)
    actor_id = _require_doctor(actor, action_type)

    table = _table()

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

    The domain service must use its own idempotency controls.

    The caller must execute using the persisted parameters
    returned here, never newly generated LLM arguments.
    """

    action_type = _value(action_type)
    actor_id = _require_doctor(actor, action_type)

    table = _table()
    now = utcnow()

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
            )
            .returning(table)
        )
    ).mappings().first()

    if row is None:
        raise HTTPException(
            409,
            "Approval unavailable or execution already claimed",
        )

    return dict(row)


async def complete_execution(
    db: AsyncConnection,
    *,
    actor: dict[str, Any],
    thread_id: str,
    approval_id: str,
    success: bool,
    result_code: str,
) -> dict[str, Any]:
    """Record a minimal outcome without private patient data."""

    actor_id = _require_doctor(actor)
    result_code = _check_text(
        result_code, "execution result code", 64
    )

    table = _table()
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
                executionStatus=(
                    "COMPLETED" if success else "FAILED"
                ),
                completedAt=now,
                executionResult={"code": result_code},
            )
            .returning(table)
        )
    ).mappings().first()

    if row is None:
        raise HTTPException(
            409, "Execution state cannot be completed"
        )

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
