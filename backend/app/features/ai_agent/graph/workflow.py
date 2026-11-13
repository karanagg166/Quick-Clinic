
from langchain_core.language_models.chat_models import BaseChatModel
from langgraph.graph import StateGraph, START, END

from .state import AgentState
from .nodes import create_agent_node


def build_workflow(model: BaseChatModel):
    workflow = StateGraph(AgentState)

    workflow.add_node("agent", create_agent_node(model))

    workflow.add_edge(START, "agent")
    workflow.add_edge("agent", END)

    return workflow.compile()
