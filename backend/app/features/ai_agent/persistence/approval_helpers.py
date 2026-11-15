"""Shared validation and hashing helpers for durable agent approvals."""

import hashlib
import json
from enum import Enum
from typing import Any

from fastapi import HTTPException

from app.features.ai_agent.security.permissions import require_permission
from app.infrastructure.database import tables


APPROVAL_TTL_SECONDS = 600
EXECUTION_LEASE_SECONDS = 30

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

PATIENT_ACTION_PERMISSIONS = {
    "UPDATE_PATIENT_ACCOUNT": "update_profile",
    "UPDATE_MEDICAL_PROFILE": "update_patient_profile",
    "CANCEL_PATIENT_APPOINTMENT": "cancel_patient_appointment",
    "PROPOSE_BOOKING": "create_slot_hold",
    "RENAME_DOCUMENT": "rename_patient_document",
    "DELETE_DOCUMENT": "delete_patient_document",
    "SEND_DOCTOR_MESSAGE": "send_rest_message",
    "MARK_NOTIFICATION_READ": "mark_notification_read",
    "SUBMIT_DOCTOR_FEEDBACK": "submit_rating",
}

ROLE_ACTION_PERMISSIONS: dict[str, dict[str, str]] = {
    "DOCTOR": DOCTOR_ACTION_PERMISSIONS,
    "PATIENT": PATIENT_ACTION_PERMISSIONS,
}


def approval_table():
    """Resolve the AgentApproval table when approval persistence is used."""

    table = tables.get("AgentApproval")
    if table is None:
        raise RuntimeError(
            "AgentApproval schema is not installed. "
            "Apply the database migration and synchronize backend schema.json first."
        )
    return table


def enum_value(value: str | Enum) -> str:
    return value.value if isinstance(value, Enum) else value


def require_doctor_actor(
    actor: dict[str, Any],
    action: str | None = None,
) -> str:
    """Validate authenticated doctor or patient identity and approval permission."""

    if not isinstance(actor, dict) or actor.get("role") not in ROLE_ACTION_PERMISSIONS:
        raise HTTPException(403, "Authenticated doctor or patient authorization required")

    role = str(actor["role"])
    user_id = actor.get("id")
    if not isinstance(user_id, str) or not user_id or actor.get("isActive") is not True:
        raise HTTPException(403, "Active account required")

    if action is not None:
        permission = ROLE_ACTION_PERMISSIONS[role].get(action)
        if permission is None:
            raise HTTPException(403, f"Unsupported {role.lower()} approval action")
        require_permission(actor, permission)

    return user_id


def check_text(
    value: str,
    field: str,
    maximum: int,
    minimum: int = 1,
) -> str:
    if not isinstance(value, str) or not minimum <= len(value) <= maximum:
        raise HTTPException(422, f"Invalid {field}")
    return value


def payload_hash(
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
        raise HTTPException(422, "Action parameters must be an object")

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
        raise HTTPException(422, "Action parameters must be JSON serializable") from exc

    if len(encoded) > 8192:
        raise HTTPException(413, "Approval proposal is too large")

    return hashlib.sha256(encoded).hexdigest()
