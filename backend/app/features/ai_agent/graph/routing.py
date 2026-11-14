"""Routing helpers and allowlists for the Quick-Clinic LangGraph workflow."""

from langchain_core.messages import AIMessage, HumanMessage, ToolMessage

from .state import AgentState

MAX_TOOL_CALLS_PER_TURN = 3

# Explicit allowlist: only audited read-only tools may execute without human approval.
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
