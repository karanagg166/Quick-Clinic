
"""Application service for the Quick-Clinic AI Agent."""

from typing import Any

from fastapi import HTTPException
from langchain_core.messages import (
    AIMessage,
    HumanMessage,
    SystemMessage,
)

from .graph.workflow import build_workflow
from .models.providers import get_model
from .security.guardrails import validate_user_message


SYSTEM_PROMPT = """
You are Quick-Clinic's AI assistant.

You help authenticated doctors and patients.

Rules:
- Give clear, concise and helpful responses.
- You do not have access to appointments, tools or medical records yet.
- Never invent patient details or appointment information.
- Never claim to have booked, cancelled or modified anything.
- Do not provide diagnoses or prescriptions.
- Explain clearly when a capability is not available.
"""


class AIAgentService:

    def __init__(self, provider: str = "google"):
        model = get_model(provider)
        self.graph = build_workflow(model)

    async def chat(
        self,
        message: str,
        actor: dict[str, Any],
    ) -> str:

        if (
            not isinstance(actor, dict)
            or actor.get("isActive") is not True
            or actor.get("role") not in {"DOCTOR", "PATIENT"}
        ):
            raise HTTPException(
                status_code=403,
                detail="AI assistant access denied",
            )

        message = validate_user_message(message)

        messages = [
            SystemMessage(
                content=(
                    SYSTEM_PROMPT
                    + f"\nAuthenticated user role: {actor['role']}"
                )
            ),
            HumanMessage(content=message),
        ]

        result = await self.graph.ainvoke({
            "messages": messages,
        })

        response = result["messages"][-1]

        if not isinstance(response, AIMessage):
            raise RuntimeError("Invalid AI model response")

        answer = response.text.strip()

        if not answer:
            raise RuntimeError("AI model returned an empty response")

        return answer
