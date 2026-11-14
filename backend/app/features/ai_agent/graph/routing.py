"""Role-aware routing policies and allowlists for the Quick-Clinic LangGraph workflow."""

from langchain_core.messages import AIMessage, HumanMessage, ToolMessage

from app.features.ai_agent.tools.doctor_mutations import MUTATING_TOOL_ACTION_MAP as DOCTOR_MUTATIONS
from app.features.ai_agent.tools.patient_mutations import (
    PATIENT_MUTATING_TOOL_ACTION_MAP as PATIENT_MUTATIONS,
)

from .state import AgentState

MAX_TOOL_CALLS_PER_TURN = 3

READ_ONLY_DOCTOR_TOOLS = frozenset({
    "get_my_consultation_slots",
    "get_my_free_slots",
    "get_my_profile",
    "get_my_weekly_schedule",
    "get_my_leaves",
    "get_my_statistics",
    "get_my_balance",
    "get_my_earnings_summary",
    "get_my_appointments",
    "get_appointment_details",
    "list_my_patients",
    "get_patient_info",
    "get_patient_appointment_history",
    "list_patient_medical_documents",
    "query_patient_medical_documents",
    "get_conversation_history",
})

READ_ONLY_PATIENT_TOOLS = frozenset({
    "get_my_profile",
    "get_my_medical_profile",
    "get_my_health_summary",
    "get_my_notifications",
    "search_doctors",
    "get_doctor_details",
    "get_doctor_available_slots",
    "get_doctor_schedule",
    "get_doctor_ratings",
    "get_my_appointments",
    "get_appointment_details",
    "get_upcoming_appointments",
    "get_past_appointments",
    "list_my_medical_documents",
    "get_my_document_details",
    "get_document_processing_status",
    "search_my_medical_documents",
    "get_my_checkout_status",
    "get_my_payment_status",
    "list_my_doctor_conversations",
    "get_my_messages",
    "get_conversation_history",
})

APPROVAL_DOCTOR_TOOLS = frozenset(DOCTOR_MUTATIONS.keys())
APPROVAL_PATIENT_TOOLS = frozenset(PATIENT_MUTATIONS.keys())


def get_role_tool_policy(role: str | None) -> tuple[frozenset[str], frozenset[str]]:
    """Return (read_only_tools, approval_tools) for the authenticated role; fail closed."""

    if role == "DOCTOR":
        return READ_ONLY_DOCTOR_TOOLS, APPROVAL_DOCTOR_TOOLS
    if role == "PATIENT":
        return READ_ONLY_PATIENT_TOOLS, APPROVAL_PATIENT_TOOLS
    return frozenset(), frozenset()


def tool_calls_used(state: AgentState) -> int:
    """Count executed tools since the last user message."""

    count = 0
    for message in reversed(state["messages"]):
        if isinstance(message, HumanMessage):
            break
        if isinstance(message, ToolMessage):
            count += 1
    return count


async def tool_limit_node(state: AgentState) -> dict:
    """Stop an excessive tool-calling loop."""

    return {
        "messages": [
            AIMessage(
                content=(
                    "I reached the tool execution limit. "
                    "Please make a more specific request."
                )
            )
        ]
    }


async def blocked_tool_node(state: AgentState) -> dict:
    """Reject unknown or unsupported tool requests."""

    return {
        "messages": [
            AIMessage(
                content="This tool request could not be authorized or executed safely."
            )
        ]
    }
