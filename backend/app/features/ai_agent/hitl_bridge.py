"""Bridge between LangGraph HITL interrupts, AgentApproval DB, and domain executors."""

import json
from datetime import timezone
from typing import Any

from sqlalchemy.ext.asyncio import AsyncConnection

from app.features.ai_agent.persistence.approvals import (
    claim_execution,
    complete_execution,
    create_or_get_approval,
    verify_approved,
)
from app.features.ai_agent.persistence.telemetry import record_tool_call
from app.features.ai_agent.security.approvals import ApprovalRequest
from app.features.ai_agent.tools.doctor_executor import execute_approved_doctor_action
from app.features.ai_agent.tools.doctor_mutations import MUTATING_TOOL_ACTION_MAP
from app.features.ai_agent.tools.patient_executor import execute_approved_patient_action
from app.features.ai_agent.tools.patient_mutations import PATIENT_MUTATING_TOOL_ACTION_MAP


def _aware_utc(dt):
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _describe_action(action_type: str, args: dict[str, Any]) -> tuple[str, str, str]:
    title_map = {
        "APPLY_LEAVE": "Apply for Leave",
        "UPDATE_LEAVE": "Update Leave",
        "CANCEL_LEAVE": "Cancel Leave",
        "UPDATE_SCHEDULE": "Update Weekly Schedule",
        "CREATE_SLOT": "Create Consultation Slot",
        "UPDATE_SLOT": "Update Slot Availability",
        "REMOVE_SLOT": "Remove Consultation Slot",
        "UPDATE_DOCTOR_PROFILE": "Update Doctor Profile",
        "UPDATE_APPOINTMENT": "Update Appointment Status",
        "CANCEL_APPOINTMENT": "Cancel Appointment",
        "SEND_PATIENT_MESSAGE": "Send Patient Message",
        "UPDATE_PATIENT_ACCOUNT": "Update Profile",
        "UPDATE_MEDICAL_PROFILE": "Update Medical Profile",
        "CANCEL_PATIENT_APPOINTMENT": "Cancel Appointment",
        "PROPOSE_BOOKING": "Hold Slot for Booking",
        "RENAME_DOCUMENT": "Rename Medical Document",
        "DELETE_DOCUMENT": "Delete Medical Document",
        "SEND_DOCTOR_MESSAGE": "Send Message to Doctor",
        "MARK_NOTIFICATION_READ": "Mark Notification Read",
        "SUBMIT_DOCTOR_FEEDBACK": "Submit Doctor Feedback",
    }
    title = title_map.get(action_type, action_type.replace("_", " ").title())
    summary = f"Execute {title} with parameters: {json.dumps(args, default=str)[:350]}"
    reason = str(args.get("reason") or f"User requested {title.lower()}")[:300]
    return title, summary, reason


def _role_action_map(actor: dict[str, Any]) -> dict[str, str]:
    if actor.get("role") == "PATIENT":
        return PATIENT_MUTATING_TOOL_ACTION_MAP
    return MUTATING_TOOL_ACTION_MAP


def build_hitl_callbacks(
    db: AsyncConnection,
    *,
    actor: dict[str, Any],
    thread_id: str,
    turn_id: str,
):
    """Build request-scoped factory, verifier, and executor bound to db & actor."""

    action_map = _role_action_map(actor)

    async def approval_request_factory(call: dict[str, Any]) -> ApprovalRequest:
        tool_name = str(call.get("name") or "")
        tool_call_id = str(call.get("id") or "")
        args = dict(call.get("args") or {})
        action_type = action_map.get(tool_name)
        if action_type is None:
            raise PermissionError(f"Unsupported mutating tool: {tool_name}")

        title, summary, reason = _describe_action(action_type, args)
        idempotency_key = f"hitl_{thread_id}_{tool_call_id}"[:128]
        if len(idempotency_key) < 16:
            idempotency_key = f"{idempotency_key}_approval_req"[:128]

        record = await create_or_get_approval(
            db,
            actor=actor,
            thread_id=thread_id,
            tool_call_id=tool_call_id,
            action_type=action_type,
            risk_level="MEDIUM_HUMAN_APPROVAL",
            parameters=args,
            title=title,
            summary=summary,
            reason=reason,
            idempotency_key=idempotency_key,
        )
        await record_tool_call(
            db,
            thread_id=thread_id,
            turn_id=turn_id,
            tool_call_id=tool_call_id,
            tool_name=tool_name,
            input_json=args,
            status="AWAITING_APPROVAL",
            action_type=action_type,
            risk_level="MEDIUM_HUMAN_APPROVAL",
            approval_id=record["id"],
        )
        return ApprovalRequest(
            approval_id=record["id"],
            action=tool_name,
            summary=record["summary"],
            payload_hash=record["payloadHash"],
            expires_at=_aware_utc(record["expiresAt"]),
        )

    async def approval_verifier(request: ApprovalRequest) -> bool:
        action_type = action_map.get(request.action, "")
        tool_call_id = ""
        # Look up exact tool_call_id from the persisted approval
        from app.features.ai_agent.persistence.approvals import get_approval

        record = await get_approval(
            db,
            actor=actor,
            thread_id=thread_id,
            approval_id=request.approval_id,
        )
        tool_call_id = record["toolCallId"]
        return await verify_approved(
            db,
            actor=actor,
            thread_id=thread_id,
            approval_id=request.approval_id,
            tool_call_id=tool_call_id,
            action_type=action_type,
            payload_hash=request.payload_hash,
            idempotency_key=record["idempotencyKey"],
        )

    async def approved_tool_executor(call: dict[str, Any]) -> dict[str, Any]:
        tool_name = str(call.get("name") or "")
        tool_call_id = str(call.get("id") or "")
        action_type = action_map[tool_name]
        from app.features.ai_agent.persistence.approvals import list_thread_approvals

        approvals = await list_thread_approvals(db, actor=actor, thread_id=thread_id)
        match = next((a for a in approvals if a["toolCallId"] == tool_call_id), None)
        if match is None:
            raise PermissionError("Persisted approval not found for tool call")

        claimed = await claim_execution(
            db,
            actor=actor,
            thread_id=thread_id,
            approval_id=match["id"],
            tool_call_id=tool_call_id,
            action_type=action_type,
            payload_hash=match["payloadHash"],
            idempotency_key=match["idempotencyKey"],
        )
        try:
            executor_fn = (
                execute_approved_patient_action
                if actor.get("role") == "PATIENT"
                else execute_approved_doctor_action
            )
            code, payload = await executor_fn(
                db,
                actor=actor,
                action_type=action_type,
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
            await record_tool_call(
                db,
                thread_id=thread_id,
                turn_id=turn_id,
                tool_call_id=tool_call_id,
                tool_name=tool_name,
                input_json=dict(claimed["parameters"]),
                status="COMPLETED",
                action_type=action_type,
                risk_level="MEDIUM_HUMAN_APPROVAL",
                approval_id=claimed["id"],
                result_json=payload,
            )
            return {"status": "COMPLETED", "code": code, **payload}
        except Exception as exc:
            await complete_execution(
                db,
                actor=actor,
                thread_id=thread_id,
                approval_id=claimed["id"],
                success=False,
                result_code="EXECUTION_FAILED",
                error_code=type(exc).__name__,
            )
            await record_tool_call(
                db,
                thread_id=thread_id,
                turn_id=turn_id,
                tool_call_id=tool_call_id,
                tool_name=tool_name,
                input_json=dict(claimed["parameters"]),
                status="FAILED",
                action_type=action_type,
                risk_level="MEDIUM_HUMAN_APPROVAL",
                approval_id=claimed["id"],
                error_code=type(exc).__name__,
            )
            raise

    return approval_request_factory, approval_verifier, approved_tool_executor
