
"""Security policies for Quick-Clinic AI agent actions."""

from enum import Enum
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncConnection

from app.infrastructure.audit import record_audit_event

from .permissions import require_permission


class ActionRiskLevel(str, Enum):
    LOW_AUTONOMOUS = "LOW_AUTONOMOUS"
    MEDIUM_HUMAN_APPROVAL = "MEDIUM_HUMAN_APPROVAL"
    HIGH_CLINICAL_RESTRICTED = "HIGH_CLINICAL_RESTRICTED"


ACTION_RISK_MAP = {
    "CHECK_AVAILABILITY": ActionRiskLevel.LOW_AUTONOMOUS,
    "GET_DOCTOR_INFO": ActionRiskLevel.LOW_AUTONOMOUS,
    "PROPOSE_APPOINTMENT": ActionRiskLevel.MEDIUM_HUMAN_APPROVAL,
    "CANCEL_APPOINTMENT": ActionRiskLevel.MEDIUM_HUMAN_APPROVAL,
    "ACCESS_MEDICAL_DOCUMENTS": ActionRiskLevel.HIGH_CLINICAL_RESTRICTED,
}


ACTION_PERMISSIONS = {
    "CHECK_AVAILABILITY": {
        "PATIENT": "get_available_slots",
        "DOCTOR": "get_available_slots",
    },
    "GET_DOCTOR_INFO": {
        "PATIENT": "get_doctor_profile",
        "DOCTOR": "get_doctor_profile",
    },
    "PROPOSE_APPOINTMENT": {
        "PATIENT": "create_slot_hold",
    },
    "CANCEL_APPOINTMENT": {
        "PATIENT": "cancel_patient_appointment",
        "DOCTOR": "update_doctor_appointment",
    },
    "ACCESS_MEDICAL_DOCUMENTS": {
        "PATIENT": "get_owned_document",
        "DOCTOR": "get_doctor_document",
    },
}


def get_action_risk(action_name: str) -> ActionRiskLevel:
    risk = ACTION_RISK_MAP.get(action_name)

    if risk is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Unknown or unsupported agent action",
        )

    return risk


def assert_agent_authorization(
    action_name: str,
    actor: dict[str, Any],
    target_patient_id: str | None = None,
    target_doctor_id: str | None = None,
) -> None:
    """Authorize an agent action before reaching domain services."""

    risk = get_action_risk(action_name)

    role = actor.get("role") if isinstance(actor, dict) else None

    permission = ACTION_PERMISSIONS.get(
        action_name, {}
    ).get(role)

    if permission is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Action not permitted for this role",
        )

    require_permission(actor, permission)

    # Mutations and clinical access remain disabled until
    # approval handling and resource ownership checks exist.
    if risk != ActionRiskLevel.LOW_AUTONOMOUS:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                "This agent action requires additional "
                "authorization or human approval and is "
                "not enabled yet"
            ),
        )


SAFE_AUDIT_FIELDS = frozenset({
    "doctorId",
    "patientId",
    "appointmentId",
    "slotId",
    "date",
    "count",
})


async def audit_agent_action(
    db: AsyncConnection,
    actor_id: str,
    action_name: str,
    details: dict[str, Any],
) -> None:
    """Record permitted agent metadata without prompt or medical text."""

    safe_details = {
        key: value
        for key, value in details.items()
        if key in SAFE_AUDIT_FIELDS
        and type(value) in (str, int)
        and len(str(value)) <= 128
    }

    safe_details["invoked_by"] = "QUICK_CLINIC_AI_AGENT"

    await record_audit_event(
        db,
        actor_id,
        f"AI_AGENT:{action_name}",
        safe_details,
    )
