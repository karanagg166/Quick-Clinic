"""LangGraph nodes for AI reasoning and sequential, error-safe tool execution."""

from collections.abc import Sequence
import json
from typing import Any

from fastapi import HTTPException
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage, ToolMessage
from langchain_core.tools import BaseTool

from app.features.ai_agent.tools.doctor_mutations import MUTATING_TOOL_ACTION_MAP as DOCTOR_MUTATIONS
from app.features.ai_agent.tools.patient_mutations import PATIENT_MUTATING_TOOL_ACTION_MAP as PATIENT_MUTATIONS

from .routing import MAX_TOOL_CALLS_PER_TURN
from .state import AgentState

_ALL_MUTATIONS = frozenset(DOCTOR_MUTATIONS.keys()) | frozenset(PATIENT_MUTATIONS.keys())


def create_agent_node(
    model: BaseChatModel | Any,
    tools: Sequence[BaseTool] = (),
):
    """Create an LLM node with optional tool calling."""

    registered_tools = list(tools)
    model_with_tools = model.bind_tools(registered_tools) if registered_tools else model

    async def agent_node(state: AgentState):
        response = await model_with_tools.ainvoke(state["messages"])

        if isinstance(response, AIMessage) and getattr(response, "tool_calls", None):
            calls = list(response.tool_calls)
            if len(calls) > 1:
                # Our tools share a request-scoped DB connection; never run concurrent mutations
                # or exceed the per-turn tool cap. If any call is mutating, keep only the first
                # so LangGraph pauses cleanly on one approval with matching tool_call_id.
                if any(c.get("name") in _ALL_MUTATIONS for c in calls):
                    response = response.model_copy(update={"tool_calls": [calls[0]]})
                elif len(calls) > MAX_TOOL_CALLS_PER_TURN:
                    response = response.model_copy(update={"tool_calls": calls[:MAX_TOOL_CALLS_PER_TURN]})

        return {"messages": [response]}

    return agent_node


def create_tool_node(tools: Sequence[BaseTool]):
    """Create a sequential tool executor safe for a single shared AsyncConnection."""

    registered_tools = list(tools)
    if not registered_tools:
        raise ValueError("At least one tool must be registered")
    tools_by_name = {t.name: t for t in registered_tools}

    async def sequential_tool_node(state: AgentState) -> dict[str, Any]:
        last = state["messages"][-1]
        tool_calls = getattr(last, "tool_calls", None) or []
        results: list[ToolMessage] = []
        for call in tool_calls:
            name = str(call.get("name") or "")
            call_id = str(call.get("id") or "")
            args = dict(call.get("args") or {})
            target = tools_by_name.get(name)
            if target is None:
                results.append(
                    ToolMessage(
                        content=f"Tool '{name}' is not available.",
                        tool_call_id=call_id,
                        name=name,
                        status="error",
                    )
                )
                continue
            try:
                output = await target.ainvoke(args)
                if isinstance(output, str):
                    content = output
                else:
                    try:
                        content = json.dumps(output, default=str)
                    except (TypeError, ValueError):
                        content = str(output)
                results.append(
                    ToolMessage(
                        content=content,
                        tool_call_id=call_id,
                        name=name,
                    )
                )
            except HTTPException as exc:
                results.append(
                    ToolMessage(
                        content=f"Tool error (HTTP {exc.status_code}): {exc.detail}",
                        tool_call_id=call_id,
                        name=name,
                        status="error",
                    )
                )
            except Exception as exc:
                results.append(
                    ToolMessage(
                        content=f"Tool execution error ({type(exc).__name__}): {exc}",
                        tool_call_id=call_id,
                        name=name,
                        status="error",
                    )
                )
        return {"messages": results}

    return sequential_tool_node
