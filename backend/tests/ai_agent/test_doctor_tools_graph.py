"""Graph execution and IST relative date tests for Doctor Agent tools."""

from datetime import date

import pytest
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage, HumanMessage, ToolMessage
from langchain_core.outputs import ChatGeneration, ChatResult
from langchain_core.tools import tool
from pydantic import PrivateAttr

from app.features.ai_agent.graph.workflow import build_workflow
from app.features.ai_agent.tools import doctor as doctor_tools

DOCTOR = {
    "id": "doctor-user-1",
    "role": "DOCTOR",
    "isActive": True,
}


class ScriptedDoctorModel(BaseChatModel):
    """Fake LLM that requests a tool and then answers."""

    _responses: list[AIMessage] = PrivateAttr()
    _index: int = PrivateAttr(default=0)

    def __init__(self, responses: list[AIMessage]):
        super().__init__()
        self._responses = responses

    @property
    def _llm_type(self) -> str:
        return "scripted-doctor-test"

    def bind_tools(self, tools, **kwargs):
        return self

    def _generate(self, messages, stop=None, run_manager=None, **kwargs) -> ChatResult:
        response = self._responses[self._index]
        self._index += 1
        return ChatResult(generations=[ChatGeneration(message=response)])


@pytest.mark.unit
@pytest.mark.asyncio
async def test_langgraph_executes_tool_and_returns_answer():
    """Verify the complete agent -> tool -> agent loop."""

    executed = []

    @tool
    async def get_my_free_slots(day: str) -> dict:
        """Return the authenticated doctor's free slots."""
        executed.append(day)
        return {"date": day, "total_free": 2}

    model = ScriptedDoctorModel(
        [
            AIMessage(
                content="",
                tool_calls=[
                    {
                        "id": "call-1",
                        "name": "get_my_free_slots",
                        "args": {"day": "2026-11-16"},
                    }
                ],
            ),
            AIMessage(content="You have 2 free slots on November 16."),
        ]
    )

    graph = build_workflow(model=model, tools=[get_my_free_slots])

    result = await graph.ainvoke(
        {
            "messages": [HumanMessage(content="Show my free slots for November 16.")],
            "next_agent": "doctor",
        }
    )

    assert executed == ["2026-11-16"]
    assert any(isinstance(message, ToolMessage) for message in result["messages"])
    assert result["messages"][-1].content == "You have 2 free slots on November 16."


@pytest.mark.unit
@pytest.mark.asyncio
async def test_doctor_tools_resolve_relative_dates_in_ist(monkeypatch):
    """Relative expressions ('today', 'tomorrow', 'yesterday') use Asia/Kolkata, not UTC."""
    from app.core.clock import freeze_clock

    db = object()
    recorded_days = []

    async def fake_free_slots(*, db, actor, day):
        recorded_days.append(("free", day))
        return {"date": day.isoformat(), "type": "FREE_SLOTS", "slots": []}

    async def fake_consultations(*, db, actor, day):
        recorded_days.append(("consultations", day))
        return {"date": day.isoformat(), "type": "CONSULTATION_SLOTS", "appointments": []}

    monkeypatch.setattr(doctor_tools, "fetch_free_slots", fake_free_slots)
    monkeypatch.setattr(doctor_tools, "fetch_consultation_slots", fake_consultations)

    # 2026-11-14T18:30:00Z is already 2026-11-15 00:00:00+05:30 in Asia/Kolkata
    with freeze_clock("2026-11-14T18:30:00Z"):
        tools = {item.name: item for item in doctor_tools.build_doctor_tools(db, DOCTOR)}
        res_today = await tools["get_my_free_slots"].ainvoke({"day": "today"})
        res_tomorrow = await tools["get_my_free_slots"].ainvoke({"day": "tomorrow"})
        res_yesterday = await tools["get_my_consultation_slots"].ainvoke({"day": "yesterday"})

    assert res_today["date"] == "2026-11-15"
    assert res_tomorrow["date"] == "2026-11-16"
    assert res_yesterday["date"] == "2026-11-14"
    assert recorded_days == [
        ("free", date(2026, 11, 15)),
        ("free", date(2026, 11, 16)),
        ("consultations", date(2026, 11, 14)),
    ]
