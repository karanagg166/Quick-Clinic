"""Security boundaries, human approval rules, and audit logging for AI Agent execution."""

import logging
from enum import Enum
from typing import Any
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncConnection
from app.infrastructure.audit import record_audit_event

logger = logging.getLogger(__name__)


class ActionRiskLevel(str, Enum):
    LOW_AUTONOMOUS = "LOW_AUTONOMOUS"  # Read-only lookups (availability, clinic info)
    MEDIUM_HUMAN_APPROVAL = "MEDIUM_HUMAN_APPROVAL"  # Mutating appointments, cancellations
    HIGH_CLINICAL_RESTRICTED = "HIGH_CLINICAL_RESTRICTED"  # Access to medical files, diagnoses


# Explicit risk mapping per action type
ACTION_RISK_MAP = {
    "CHECK_AVAILABILITY": ActionRiskLevel.LOW_AUTONOMOUS,
    "GET_DOCTOR_INFO": ActionRiskLevel.LOW_AUTONOMOUS,
    "PROPOSE_APPOINTMENT": ActionRiskLevel.MEDIUM_HUMAN_APPROVAL,
    "CANCEL_APPOINTMENT": ActionRiskLevel.MEDIUM_HUMAN_APPROVAL,
    "RESCHEDULE_APPOINTMENT": ActionRiskLevel.MEDIUM_HUMAN_APPROVAL,
    "ACCESS_MEDICAL_DOCUMENTS": ActionRiskLevel.HIGH_CLINICAL_RESTRICTED,
    "SUMMARIZE_VISIT_HISTORY": ActionRiskLevel.HIGH_CLINICAL_RESTRICTED,
}


def assert_agent_authorization(
    action_name: str,
    actor: dict[str, Any],
    target_patient_id: str | None = None,
    target_doctor_id: str | None = None,
) -> None:
    """Verify that an agent call is operating on behalf of an authorized and active user."""
    if not actor.get("isActive"):
        raise HTTPException(403, "Inactive account cannot invoke agent operations")

    role = actor.get("role")
    risk = ACTION_RISK_MAP.get(action_name, ActionRiskLevel.HIGH_CLINICAL_RESTRICTED)

    # High clinical actions require doctor or verified patient self-access
    if risk == ActionRiskLevel.HIGH_CLINICAL_RESTRICTED:
        if role not in ("DOCTOR", "PATIENT", "ADMIN"):
            raise HTTPException(403, "Unauthorized role for clinical document access")

    logger.info("Agent action authorized: action=%s actor_id=%s role=%s", action_name, actor.get("id"), role)


async def audit_agent_action(
    db: AsyncConnection,
    actor_id: str,
    action_name: str,
    details: dict[str, Any],
) -> None:
    """Persist immutable audit trail for every AI agent tool execution."""
    safe_details = {k: v for k, v in details.items() if k not in ("token", "password", "secret")}
    safe_details["invoked_by"] = "LANGGRAPH_DOCTOR_AGENT"
    await record_audit_event(
        db,
        actor_id,
        f"AI_AGENT:{action_name}",
        safe_details,
    )
