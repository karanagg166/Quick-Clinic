
"""Checkpoint-aware LangGraph workflow for Quick-Clinic."""

from collections.abc import Awaitable, Callable, Sequence
from typing import Any, Literal

from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import (
    AIMessage,
    HumanMessage,
    ToolMessage,
)
from langchain_core.tools import BaseTool
from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.graph import StateGraph, START, END

from app.features.ai_agent.security.approvals import (
    ApprovalManager,
    ApprovalRequest,
    ApprovalVerifier,
)

from .state import AgentState
from .nodes import create_agent_node, create_tool_node


MAX_TOOL_CALLS_PER_TURN = 3


# Explicit allowlist: only audited read-only tools
# may execute without human approval.
READ_ONLY_DOCTOR_TOOLS = frozenset({
    "get_my_consultation_slots",
    "get_my_free_slots",
    "get_my_profile",
    "get_my_weekly_schedule",
    "get_my_leaves",
    "get_my_statistics",
    "get_my_balance",
    "get_my_earnings_summary",
})


# Must create or retrieve a stable, persisted approval.
# Repeated calls for the same tool_call_id must return
# the same approval record and expiration timestamp.
ApprovalRequestFactory = Callable[
    [dict[str, Any]],
    Awaitable[ApprovalRequest],
]


def _tool_calls_used(state: AgentState) -> int:
    """Count executed tools since the last user message."""

    count = 0

    for message in reversed(state["messages"]):
        if isinstance(message, HumanMessage):
            break

        if isinstance(message, ToolMessage):
            count += 1

    return count


async def _tool_limit_node(
    state: AgentState,
) -> dict:
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


async def _blocked_tool_node(
    state: AgentState,
) -> dict:
    """Reject unknown or unsupported tool requests."""

    return {
        "messages": [
            AIMessage(
                content=(
                    "This tool request could not be "
                    "authorized or executed safely."
                )
            )
        ]
    }


def build_workflow(
    model: BaseChatModel,
    tools: Sequence[BaseTool] | None = None,
    *,
    checkpointer: BaseCheckpointSaver | None = None,
    approval_request_factory: (
        ApprovalRequestFactory | None
    ) = None,
    approval_verifier: ApprovalVerifier | None = None,
):
    """Build an authenticated, request-scoped agent graph.

    Read-only tools can run autonomously.

    Other tools require:
    - A persistent checkpointer
    - A database-backed approval request factory
    - An authenticated approval verifier
    - Idempotent authorization inside the domain executor
    """

    registered_tools = list(tools or [])

    names = [item.name for item in registered_tools]

    if len(names) != len(set(names)):
        raise ValueError("Duplicate agent tool names")

    registered_names = set(names)

    approval_required = (
        registered_names - READ_ONLY_DOCTOR_TOOLS
    )

    # Fail closed: unknown or mutating tools cannot
    # accidentally execute through the normal ToolNode.
    if approval_required:
        if (
            checkpointer is None
            or approval_request_factory is None
            or approval_verifier is None
        ):
            raise RuntimeError(
                "Approval-required tools need persistent "
                "checkpoints and database-backed approval "
                "verification before registration."
            )

    workflow = StateGraph(AgentState)

    workflow.add_node(
        "agent",
        create_agent_node(model, registered_tools),
    )

    workflow.add_edge(START, "agent")

    if not registered_tools:
        workflow.add_edge("agent", END)
        return workflow.compile(
            checkpointer=checkpointer,
        )

    workflow.add_node(
        "tools",
        create_tool_node(registered_tools),
    )

    workflow.add_node(
        "tool_limit",
        _tool_limit_node,
    )

    workflow.add_node(
        "blocked_tool",
        _blocked_tool_node,
    )

    def route_after_agent(
        state: AgentState,
    ) -> Literal[
        "tools",
        "approval",
        "limit",
        "blocked",
        "end",
    ]:
        """Route only explicitly registered tool calls."""

        last = state["messages"][-1]

        if not isinstance(last, AIMessage):
            return "end"

        if not last.tool_calls:
            return "end"

        if len(last.tool_calls) != 1:
            return "blocked"

        if _tool_calls_used(state) >= MAX_TOOL_CALLS_PER_TURN:
            return "limit"

        call = last.tool_calls[0]
        name = call.get("name")

        if name not in registered_names:
            return "blocked"

        if name in approval_required:
            return "approval"

        return "tools"

    routes = {
        "tools": "tools",
        "limit": "tool_limit",
        "blocked": "blocked_tool",
        "end": END,
    }

    if approval_required:

        async def approval_node(
            state: AgentState,
        ) -> dict:
            """Interrupt before invoking a sensitive tool."""

            last = state["messages"][-1]

            if (
                not isinstance(last, AIMessage)
                or len(last.tool_calls) != 1
            ):
                raise RuntimeError(
                    "Invalid approval tool call"
                )

            call = last.tool_calls[0]

            if call["name"] not in approval_required:
                raise PermissionError(
                    "Tool is not approval-gated"
                )

            # The factory must retrieve a durable,
            # idempotent proposal bound to this tool call,
            # the authenticated doctor and thread.
            request = await approval_request_factory(
                call
            )

            if request.action != call["name"]:
                raise PermissionError(
                    "Approval action mismatch"
                )

            # LangGraph pauses here.
            #
            # On resume, ApprovalManager verifies the
            # database record, exact proposed action,
            # approval expiry and authenticated approver.
            await ApprovalManager.require_approval(
                request=request,
                verify=approval_verifier,
            )

            return {}

        workflow.add_node(
            "approval",
            approval_node,
        )

        workflow.add_edge(
            "approval",
            "tools",
        )

        routes["approval"] = "approval"

    workflow.add_conditional_edges(
        "agent",
        route_after_agent,
        routes,
    )

    workflow.add_edge("tools", "agent")
    workflow.add_edge("tool_limit", END)
    workflow.add_edge("blocked_tool", END)

    return workflow.compile(
        checkpointer=checkpointer,
    )
