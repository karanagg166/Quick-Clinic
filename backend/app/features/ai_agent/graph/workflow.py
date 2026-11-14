
"""LangGraph workflow for Quick-Clinic AI agents."""

from collections.abc import Sequence
from typing import Literal

from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import (
    AIMessage,
    HumanMessage,
    ToolMessage,
)
from langchain_core.tools import BaseTool

from langgraph.graph import StateGraph, START, END

from .state import AgentState
from .nodes import create_agent_node, create_tool_node


MAX_TOOL_CALLS_PER_TURN = 3


def _tool_calls_used(state: AgentState) -> int:
    """Count executed tools since the latest user message."""

    count = 0

    for message in reversed(state["messages"]):
        if isinstance(message, HumanMessage):
            break

        if isinstance(message, ToolMessage):
            count += 1

    return count


def _route_after_agent(
    state: AgentState,
) -> Literal["tools", "limit", "end"]:
    """Determine the next step after the LLM responds."""

    last_message = state["messages"][-1]

    if not isinstance(last_message, AIMessage):
        return "end"

    if not last_message.tool_calls:
        return "end"

    if _tool_calls_used(state) >= MAX_TOOL_CALLS_PER_TURN:
        return "limit"

    return "tools"


async def _tool_limit_node(
    state: AgentState,
) -> dict:
    """Return a safe response when the tool limit is reached."""

    return {
        "messages": [
            AIMessage(
                content=(
                    "I stopped because this request exceeded "
                    "the allowed number of tool calls. "
                    "Please try a more specific request."
                )
            )
        ]
    }


def build_workflow(
    model: BaseChatModel,
    tools: Sequence[BaseTool] | None = None,
):
    """Build a single-agent workflow with optional tools."""

    registered_tools = list(tools or [])

    workflow = StateGraph(AgentState)

    workflow.add_node(
        "agent",
        create_agent_node(model, registered_tools),
    )

    workflow.add_edge(START, "agent")

    # Preserve basic chat when no tools are registered.
    if not registered_tools:
        workflow.add_edge("agent", END)
        return workflow.compile()

    workflow.add_node(
        "tools",
        create_tool_node(registered_tools),
    )

    workflow.add_node(
        "tool_limit",
        _tool_limit_node,
    )

    workflow.add_conditional_edges(
        "agent",
        _route_after_agent,
        {
            "tools": "tools",
            "limit": "tool_limit",
            "end": END,
        },
    )

    workflow.add_edge("tools", "agent")
    workflow.add_edge("tool_limit", END)

    return workflow.compile()
