
"""LangGraph nodes for AI reasoning and tool execution."""

from collections.abc import Sequence

from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.tools import BaseTool
from langgraph.prebuilt import ToolNode

from .state import AgentState


def create_agent_node(
    model: BaseChatModel,
    tools: Sequence[BaseTool] = (),
):
    """Create an LLM node with optional tool calling."""

    registered_tools = list(tools)

    model_with_tools = (
        model.bind_tools(registered_tools)
        if registered_tools
        else model
    )

    async def agent_node(state: AgentState):
        response = await model_with_tools.ainvoke(
            state["messages"]
        )

        # Our tools share a request-scoped DB connection.
        # Do not permit parallel tool calls.
        if len(response.tool_calls) > 1:
            raise ValueError(
                "Multiple simultaneous tool calls are not supported"
            )

        return {
            "messages": [response]
        }

    return agent_node


def create_tool_node(
    tools: Sequence[BaseTool],
) -> ToolNode:
    """Create the LangGraph tool executor."""

    registered_tools = list(tools)

    if not registered_tools:
        raise ValueError(
            "At least one tool must be registered"
        )

    return ToolNode(registered_tools)
