
"""Role-based permissions for Quick-Clinic AI agents.

Permissions are based on existing Quick-Clinic backend capabilities.

These checks are the first authorization layer. Resource ownership,
doctor-patient relationships, and human approvals must also be
verified before executing any action.
"""

from typing import Any

from fastapi import HTTPException, status


SHARED_PERMISSIONS = frozenset({
    # Doctor discovery
    "search_doctors",
    "get_doctor_profile",
    "get_schedule",
    "get_available_slots",
    "rating_summary",
    "list_comments",

    # Own account
    "get_profile",
    "update_profile",

    # Own notifications
    "list_notifications",
    "mark_notification_read",
    "delete_notification",

    # Authorized doctor-patient conversations
    "list_relations",
    "list_messages",
    "send_rest_message",
})


PATIENT_PERMISSIONS = SHARED_PERMISSIONS | frozenset({
    # Patient profile
    "get_patient_profile",
    "update_patient_profile",
    "get_patient_stats",

    # Appointments
    "patient_appointments",
    "get_patient_appointment",
    "create_slot_hold",
    "cancel_slot_hold",
    "confirm_appointment",
    "cancel_patient_appointment",

    # Payments: status only
    "get_checkout_status",
    "get_payment_status",

    # Own medical documents
    "list_patient_documents",
    "get_owned_document",
    "upload_patient_document",
    "rename_patient_document",
    "delete_patient_document",
    "download_patient_file",

    # Doctor reviews
    "submit_rating",
    "create_comment",
})


DOCTOR_PERMISSIONS = SHARED_PERMISSIONS | frozenset({
    # Doctor profile
    "update_doctor_profile",

    # Scheduling
    "get_schedule_overview",
    "upsert_schedule",
    "create_ad_hoc_slot",
    "set_slot_availability",
    "remove_available_slot",

    # Leave management
    "list_leaves",
    "upsert_leave",
    "cancel_leave",

    # Appointments
    "doctor_appointments",
    "get_doctor_appointment",
    "update_doctor_appointment",

    # Authorized patients
    "list_patients",
    "get_patient_profile",

    # Authorized medical documents
    "list_doctor_documents",
    "get_doctor_document",

    # Doctor finances: read-only
    "get_balance",
    "list_earnings",
    "get_doctor_statistics",
    "list_withdrawals",
})


ROLE_PERMISSIONS: dict[str, frozenset[str]] = {
    "PATIENT": PATIENT_PERMISSIONS,
    "DOCTOR": DOCTOR_PERMISSIONS,
}


def check_permission(role: str, action: str) -> bool:
    """Check whether a role is allowed to request an action."""

    if not isinstance(role, str) or not isinstance(action, str):
        return False

    return action in ROLE_PERMISSIONS.get(role, frozenset())


def require_permission(
    actor: dict[str, Any],
    action: str,
) -> None:
    """Reject inactive or unauthorized users.

    The actor must come from FastAPI's authenticated current_user
    dependency, never from LLM output or client-supplied agent state.

    This function does not replace resource-level authorization
    or human approval checks.
    """

    if not isinstance(actor, dict):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required",
        )

    user_id = actor.get("id")
    role = actor.get("role")

    if (
        not isinstance(user_id, str)
        or not user_id
        or actor.get("isActive") is not True
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid or inactive account",
        )

    if not check_permission(role, action):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Agent action not permitted",
        )


def get_allowed_actions(role: str) -> frozenset[str]:
    """Return the actions available to a particular role."""

    if not isinstance(role, str):
        return frozenset()

    return ROLE_PERMISSIONS.get(role, frozenset())
