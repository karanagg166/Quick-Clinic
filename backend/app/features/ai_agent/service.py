
"""Application service for the Quick-Clinic AI Agent."""

from datetime import datetime
from typing import Any

from fastapi import HTTPException
from langchain_core.messages import (
    AIMessage,
    HumanMessage,
    SystemMessage,
)
from sqlalchemy.ext.asyncio import AsyncConnection

from app.core.clock import now_clinic, to_clinic_time
from app.core.config import get_settings

from .graph.workflow import build_workflow
from .models.providers import get_model
from .security.guardrails import validate_user_message
from .tools.doctor import build_doctor_tools


DOCTOR_SYSTEM_PROMPT = """
You are Quick-Clinic's Doctor AI Assistant.

You assist authenticated doctors.

Available capabilities:
- Check the doctor's confirmed patient consultation slots.
- Check the doctor's unbooked, available slots.

Rules:
- Use the appropriate tool when the doctor asks about slots.
- Never invent appointment or availability information.
- Free slots are unbooked and still open for patient booking.
- Consultation slots represent confirmed patient appointments.
- Only use information returned by authorized tools.
- Never claim to have modified appointments or schedules.
- You cannot book, cancel, or change appointments yet.
- Do not provide medical diagnoses or prescriptions.
- If the tool cannot provide the requested information,
  explain that clearly.
- Keep answers concise and helpful.
"""


PATIENT_SYSTEM_PROMPT = """
You are Quick-Clinic's Patient AI Assistant.

You currently provide general conversation only.

You do not have access to tools, appointments,
medical documents, or patient records.

Never invent patient information or claim
to have performed an action.

Do not provide medical diagnoses or prescriptions.
"""


def build_system_prompt(base_prompt: str, now_ist: datetime | None = None) -> str:
    """Attach fresh authoritative clinic clock context for a single request."""
    current_ist = to_clinic_time(now_ist) if now_ist is not None else now_clinic()
    tz_name = get_settings().clinic_timezone
    clock_context = (
        f"Authoritative clinic timezone: {tz_name}\n"
        f"Current clinic datetime: {current_ist.isoformat()}\n"
        f"Current clinic date: {current_ist.date().isoformat()}\n"
        f"Current clinic weekday: {current_ist.strftime('%A')}\n\n"
        "Relative calendar expressions such as today, tomorrow,\n"
        "yesterday, next Monday, this week and this month are\n"
        "interpreted in the clinic timezone.\n\n"
        "Never invent the current date.\n"
        "Never use a model training cutoff or model-generated\n"
        "date as the current clock."
    )
    return f"{base_prompt.strip()}\n\n{clock_context}"


class AIAgentService:
    """Run authenticated AI conversations."""

    def __init__(self, provider: str = "google"):
        # The model can be reused across requests.
        self.model = get_model(provider)

    async def chat(
        self,
        message: str,
        actor: dict[str, Any],
        db: AsyncConnection | None = None,
        now_ist: datetime | None = None,
    ) -> str:
        """Run a single-turn conversation."""

        if (
            not isinstance(actor, dict)
            or actor.get("isActive") is not True
            or actor.get("role") not in {"DOCTOR", "PATIENT"}
            or not actor.get("id")
        ):
            raise HTTPException(
                status_code=403,
                detail="AI assistant access denied",
            )

        message = validate_user_message(message)

        role = actor["role"]
        current_ist = to_clinic_time(now_ist) if now_ist is not None else now_clinic()

        if role == "DOCTOR":
            if db is None:
                raise RuntimeError("Database connection is required for doctor tools")
            # Tools capture this request's authenticated
            # user, database connection, and clinic reference date.
            tools = build_doctor_tools(
                db=db,
                actor=actor,
                reference_date=current_ist.date(),
            )

            system_prompt = build_system_prompt(DOCTOR_SYSTEM_PROMPT, current_ist)

        else:
            # Patient tools will be added later.
            tools = []
            system_prompt = build_system_prompt(PATIENT_SYSTEM_PROMPT, current_ist)

        # Build the tool-enabled graph per request.
        # Never cache graphs containing user-bound tools.
        graph = build_workflow(
            model=self.model,
            tools=tools,
        )

        messages = [
            SystemMessage(content=system_prompt),
            HumanMessage(content=message),
        ]

        result = await graph.ainvoke(
            {
                "messages": messages,
                "next_agent": (
                    "doctor"
                    if role == "DOCTOR"
                    else "finish"
                ),
            },
            config={
                "recursion_limit": 16,
            },
        )

        response = result["messages"][-1]

        if not isinstance(response, AIMessage):
            raise RuntimeError(
                "Invalid AI model response"
            )

        if response.tool_calls:
            raise RuntimeError(
                "AI tool execution did not finish"
            )

        answer = response.text.strip()

        if not answer:
            raise RuntimeError(
                "AI model returned an empty response"
            )

        return answer
