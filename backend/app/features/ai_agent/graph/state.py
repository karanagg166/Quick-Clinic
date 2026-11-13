
from typing import Annotated, Literal

from typing_extensions import TypedDict
from langchain_core.messages import AnyMessage
from langgraph.graph.message import add_messages


class AgentState(TypedDict):
    messages: Annotated[list[AnyMessage], add_messages]
    next_agent: Literal["doctor", "patient", "finish"] | None
