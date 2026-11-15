"""Approval decision and LangGraph resume orchestration."""

from contextlib import AsyncExitStack, asynccontextmanager
from datetime import UTC, datetime
from typing import Any

from langchain_core.messages import AIMessage
from langgraph.types import Command
from sqlalchemy.ext.asyncio import AsyncConnection

from app.core.clock import now_clinic
from app.features.ai_agent.graph.workflow import build_workflow
from app.features.ai_agent.hitl_bridge import build_hitl_callbacks
from app.features.ai_agent.persistence.approvals import (
    claim_execution,
    complete_execution,
    decide_approval,
    get_approval,
)
from app.features.ai_agent.persistence.checkpoints import get_checkpoint
from app.features.ai_agent.persistence.config import LangGraphPersistenceConfig
from app.features.ai_agent.persistence.threads import append_message, append_turn, complete_turn
from app.features.ai_agent.tools.doctor import build_doctor_tools
from app.features.ai_agent.tools.doctor_executor import execute_approved_doctor_action
from app.features.ai_agent.tools.patient import build_patient_tools
from app.features.ai_agent.tools.patient_executor import execute_approved_patient_action


@asynccontextmanager
async def optional_checkpointer():
    conn_str = LangGraphPersistenceConfig.get_connection_string()
    async with AsyncExitStack() as stack:
        cp = None
        if conn_str.startswith(("postgresql://", "postgres://", "postgresql+asyncpg://", "postgresql+psycopg://")):
            try:
                cp = await stack.enter_async_context(get_checkpoint())
            except Exception:
                cp = None
        yield cp


def _utc_iso(value: datetime | str | None) -> str | None:
    """Serialize UTC database timestamps with an explicit timezone offset.

    Prisma stores UTC instants in timezone-naive PostgreSQL DateTime columns.
    A bare ISO string is interpreted in the browser's local timezone, causing
    approval cards to appear immediately expired outside UTC.
    """
    if value is None:
        return None
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00")) if isinstance(value, str) else value
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC).isoformat()


def format_approval_payload(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "approvalId": row["id"],
        "actionType": row["actionType"],
        "riskLevel": row["riskLevel"],
        "status": row["status"],
        "executionStatus": row["executionStatus"],
        "title": row["title"],
        "summary": row["summary"],
        "reason": row["reason"],
        "parameters": row["parameters"],
        "idempotencyKey": row["idempotencyKey"],
        "expiresAt": _utc_iso(row["expiresAt"]),
        "decidedAt": _utc_iso(row.get("decidedAt")),
        "decisionReason": row.get("decisionReason"),
        "decidedByUserId": row.get("approvedByUserId"),
    }


def extract_ai_text(msg: AIMessage) -> str:
    content = getattr(msg, "content", "")
    if isinstance(content, str):
        return content.strip()
    if isinstance(content, list):
        parts = [p.get("text", "") if isinstance(p, dict) else str(p) for p in content]
        return "\n".join(p for p in parts if p).strip()
    return str(content).strip()


async def decide_and_resume_approval(
    *,
    model: Any,
    db: AsyncConnection,
    actor: dict[str, Any],
    thread_id: str,
    approval_id: str,
    decision: str,
    decision_reason: str | None = None,
    checkpointer: Any = None,
) -> dict[str, Any]:
    """Persist approval decision and resume interrupted execution when approved."""

    updated = await decide_approval(
        db,
        actor=actor,
        thread_id=thread_id,
        approval_id=approval_id,
        decision=decision,
        decision_reason=decision_reason,
    )
    approval_payload = format_approval_payload(updated)
    if decision == "REJECTED":
        msg_row = await append_message(
            db,
            thread_id=thread_id,
            turn_id=None,
            role="ASSISTANT",
            content=f"Action '{updated['title']}' was rejected.",
        )
        return {
            "threadId": thread_id,
            "approval": approval_payload,
            "resumedMessage": {
                "id": msg_row["id"],
                "role": "assistant",
                "content": msg_row["content"],
                "createdAt": msg_row["createdAt"].isoformat(),
                "status": "sent",
            },
        }

    role = str(actor.get("role") or "DOCTOR")
    resumed_text = ""
    async with optional_checkpointer() as cp_from_env:
        active_cp = checkpointer or cp_from_env
        if active_cp is not None:
            turn = await append_turn(db, thread_id=thread_id, original_query=f"RESUME:{approval_id}")
            ref_date = now_clinic().date()
            tools = (
                build_patient_tools(
                    db=db, actor=actor, reference_date=ref_date, thread_id=thread_id, turn_id=turn["id"], include_mutations=True
                )
                if role == "PATIENT"
                else build_doctor_tools(
                    db=db, actor=actor, reference_date=ref_date, thread_id=thread_id, turn_id=turn["id"], include_mutations=True
                )
            )
            factory, verifier, executor = build_hitl_callbacks(
                db, actor=actor, thread_id=thread_id, turn_id=turn["id"]
            )
            graph = build_workflow(
                model=model,
                tools=tools,
                role=role,
                checkpointer=active_cp,
                approval_request_factory=factory,
                approval_verifier=verifier,
                approved_tool_executor=executor,
            )
            result = await graph.ainvoke(
                Command(resume={"approval_id": approval_id, "decision": "APPROVED"}),
                config={"recursion_limit": 16, "configurable": {"thread_id": thread_id}},
            )
            last = result["messages"][-1]
            resumed_text = extract_ai_text(last) if isinstance(last, AIMessage) else str(last)
            await complete_turn(db, turn_id=turn["id"], status="COMPLETED", response_text=resumed_text)
        else:
            claimed = await claim_execution(
                db,
                actor=actor,
                thread_id=thread_id,
                approval_id=updated["id"],
                tool_call_id=updated["toolCallId"],
                action_type=updated["actionType"],
                payload_hash=updated["payloadHash"],
                idempotency_key=updated["idempotencyKey"],
            )
            executor_fn = (
                execute_approved_patient_action
                if role == "PATIENT"
                else execute_approved_doctor_action
            )
            code, _ = await executor_fn(
                db,
                actor=actor,
                action_type=claimed["actionType"],
                parameters=dict(claimed["parameters"]),
                approval_id=claimed["id"],
            )
            await complete_execution(
                db,
                actor=actor,
                thread_id=thread_id,
                approval_id=claimed["id"],
                success=True,
                result_code=code,
            )
            resumed_text = f"Approved and executed: {updated['title']} ({code})."

    final_approval = await get_approval(db, actor=actor, thread_id=thread_id, approval_id=approval_id)
    msg_row = await append_message(
        db,
        thread_id=thread_id,
        turn_id=None,
        role="ASSISTANT",
        content=resumed_text,
    )
    return {
        "threadId": thread_id,
        "approval": format_approval_payload(final_approval),
        "resumedMessage": {
            "id": msg_row["id"],
            "role": "assistant",
            "content": resumed_text,
            "createdAt": msg_row["createdAt"].isoformat(),
            "status": "sent",
        },
    }
