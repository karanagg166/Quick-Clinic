
from langchain_core.language_models.chat_models import BaseChatModel

from .state import AgentState


def create_agent_node(model: BaseChatModel):

    async def agent_node(state: AgentState):
        response = await model.ainvoke(state["messages"])

        return {
            "messages": [response]
        }

    return agent_node
