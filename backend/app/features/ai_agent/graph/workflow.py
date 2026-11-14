"""Checkpoint-aware LangGraph workflow for Quick-Clinic."""

from collections.abc import Awaitable, Callable, Sequence
from typing import Any, Literal

from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage, ToolMessage
from langchain_core.tools import BaseTool
from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.graph import END, START, StateGraph

from app.features.ai_agent.security.approvals import (
    ApprovalManager,
    ApprovalRequest,
    ApprovalVerifier,
)

from .nodes import create_agent_node, create_tool_node
from .routing import (
    MAX_TOOL_CALLS_PER_TURN,
    READ_ONLY_DOCTOR_TOOLS,
    blocked_tool_node,
    tool_calls_used,
    tool_limit_node,
)
from .state import AgentState

ApprovalRequestFactory = Callable[[dict[str, Any]], Awaitable[ApprovalRequest]]
ApprovedToolExecutor = Callable[[dict[str, Any]], Awaitable[Any]]


def build_workflow(
    model: BaseChatModel,
    tools: Sequence[BaseTool] | None = None,
    *,
    checkpointer: BaseCheckpointSaver | None = None,
    approval_request_factory: ApprovalRequestFactory | None = None,
    approval_verifier: ApprovalVerifier | None = None,
    approved_tool_executor: ApprovedToolExecutor | None = None,
):
    """Build an authenticated, request-scoped agent graph."""

    registered_tools = list(tools or [])
    names = [item.name for item in registered_tools]
    if len(names) != len(set(names)):
        raise ValueError("Duplicate agent tool names")

    registered_names = set(names)
    approval_required = registered_names - READ_ONLY_DOCTOR_TOOLS

    if approval_required:
        if checkpointer is None or approval_request_factory is None or approval_verifier is None:
            raise RuntimeError(
                "Approval-required tools need persistent checkpoints and "
                "database-backed approval verification before registration."
            )

    workflow = StateGraph(AgentState)
    workflow.add_node("agent", create_agent_node(model, registered_tools))
    workflow.add_edge(START, "agent")

    if not registered_tools:
        workflow.add_edge("agent", END)
        return workflow.compile(checkpointer=checkpointer)

    workflow.add_node("tools", create_tool_node(registered_tools))
    workflow.add_node("tool_limit", tool_limit_node)
    workflow.add_node("blocked_tool", blocked_tool_node)

    def route_after_agent(
        state: AgentState,
    ) -> Literal["tools", "approval", "limit", "blocked", "end"]:
        last = state["messages"][-1]
        if not isinstance(last, AIMessage) or not last.tool_calls:
            return "end"
        if len(last.tool_calls) != 1:
            return "blocked"
        if tool_calls_used(state) >= MAX_TOOL_CALLS_PER_TURN:
            return "limit"
        name = last.tool_calls[0].get("name")
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

        async def approval_node(state: AgentState) -> dict:
            last = state["messages"][-1]
            if not isinstance(last, AIMessage) or len(last.tool_calls) != 1:
                raise RuntimeError("Invalid approval tool call")
            call = last.tool_calls[0]
            if call["name"] not in approval_required:
                raise PermissionError("Tool is not approval-gated")
            request = await approval_request_factory(call)
            if request.action != call["name"]:
                raise PermissionError("Approval action mismatch")
            await ApprovalManager.require_approval(request=request, verify=approval_verifier)
            return {}

        workflow.add_node("approval", approval_node)
        if approved_tool_executor is not None:

            async def approved_tool_node(state: AgentState) -> dict:
                call = state["messages"][-1].tool_calls[0]
                result = await approved_tool_executor(call)
                return {
                    "messages": [
                        ToolMessage(
                            content=str(result),
                            tool_call_id=str(call.get("id") or ""),
                            name=str(call.get("name") or ""),
                        )
                    ]
                }

            workflow.add_node("approved_tool", approved_tool_node)
            workflow.add_edge("approval", "approved_tool")
            workflow.add_edge("approved_tool", "agent")
        else:
            workflow.add_edge("approval", "tools")
        routes["approval"] = "approval"

    workflow.add_conditional_edges("agent", route_after_agent, routes)
    workflow.add_edge("tools", "agent")
    workflow.add_edge("tool_limit", END)
    workflow.add_edge("blocked_tool", END)
    return workflow.compile(checkpointer=checkpointer)
