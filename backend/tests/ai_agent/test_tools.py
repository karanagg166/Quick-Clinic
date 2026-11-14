
"""Isolated tests for the Quick-Clinic Doctor AI Agent."""

from datetime import date, datetime

import pytest
from fastapi import HTTPException
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage, HumanMessage, ToolMessage
from langchain_core.outputs import ChatGeneration, ChatResult
from langchain_core.tools import tool
from pydantic import PrivateAttr

from app.features.ai_agent.graph.workflow import build_workflow
from app.features.ai_agent.tools import doctor as doctor_tools
from app.features.scheduling import doctor_agent_queries as queries


DOCTOR = {
    "id": "doctor-user-1",
    "role": "DOCTOR",
    "isActive": True,
}

PATIENT = {
    "id": "patient-user-1",
    "role": "PATIENT",
    "isActive": True,
}

TEST_DATE = date(2026, 11, 16)


@pytest.mark.unit
@pytest.mark.asyncio
async def test_doctor_tools_only_call_backend_functions(monkeypatch):
    """Tools forward trusted context without accessing SQL directly."""

    db = object()
    calls = []

    async def fake_free_slots(*, db, actor, day):
        calls.append(("free", db, actor, day))
        return {"type": "FREE_SLOTS", "slots": []}

    async def fake_consultations(*, db, actor, day):
        calls.append(("consultations", db, actor, day))
        return {"type": "CONSULTATION_SLOTS", "appointments": []}

    monkeypatch.setattr(
        doctor_tools, "fetch_free_slots", fake_free_slots
    )
    monkeypatch.setattr(
        doctor_tools, "fetch_consultation_slots", fake_consultations
    )

    tools = {
        item.name: item
        for item in doctor_tools.build_doctor_tools(db, DOCTOR)
    }

    assert {
        "get_my_free_slots",
        "get_my_consultation_slots",
        "get_my_profile",
        "get_my_weekly_schedule",
        "get_my_leaves",
        "get_my_statistics",
        "get_my_balance",
        "get_my_earnings_summary",
        "get_my_appointments",
        "get_appointment_details",
        "list_my_patients",
        "get_patient_info",
        "get_patient_appointment_history",
        "list_patient_medical_documents",
        "query_patient_medical_documents",
        "get_conversation_history",
    }.issubset(tools)

    free_result = await tools["get_my_free_slots"].ainvoke({
        "day": "2026-11-16"
    })

    booked_result = await tools[
        "get_my_consultation_slots"
    ].ainvoke({
        "day": "2026-11-16"
    })

    assert free_result["type"] == "FREE_SLOTS"
    assert booked_result["type"] == "CONSULTATION_SLOTS"

    assert calls == [
        ("free", db, DOCTOR, TEST_DATE),
        ("consultations", db, DOCTOR, TEST_DATE),
    ]


@pytest.mark.unit
@pytest.mark.security
@pytest.mark.asyncio
async def test_patient_cannot_access_doctor_slots():
    """Backend authorization rejects patient access."""

    with pytest.raises(HTTPException) as error:
        await queries.get_my_free_slots(
            db=None,
            actor=PATIENT,
            day=TEST_DATE,
        )

    assert error.value.status_code == 403


@pytest.mark.unit
@pytest.mark.asyncio
async def test_free_slots_use_read_only_backend_query(monkeypatch):
    """The agent must never generate slots as a side effect."""

    calls = []

    async def fake_owned_doctor(db, actor, permission):
        assert actor is DOCTOR
        assert permission == "get_available_slots"
        return "doctor-profile-1"

    async def fake_daily_slots(db, doctor_id, day, generate):
        calls.append((doctor_id, day, generate))
        return [
            {
                "id": "slot-free",
                "status": "AVAILABLE",
                "startTime": datetime(2026, 11, 16, 9),
                "endTime": datetime(2026, 11, 16, 9, 10),
            },
            {
                "id": "slot-booked",
                "status": "BOOKED",
                "startTime": datetime(2026, 11, 16, 10),
                "endTime": datetime(2026, 11, 16, 10, 10),
            },
        ], False

    async def fake_audit(*args, **kwargs):
        return None

    monkeypatch.setattr(
        queries, "_get_owned_doctor_id", fake_owned_doctor
    )
    monkeypatch.setattr(
        queries, "daily_slots", fake_daily_slots
    )
    monkeypatch.setattr(
        queries, "audit_agent_action", fake_audit
    )

    result = await queries.get_my_free_slots(
        db=None,
        actor=DOCTOR,
        day=TEST_DATE,
    )

    assert calls == [
        ("doctor-profile-1", TEST_DATE, False)
    ]

    assert result["total_free"] == 1
    assert result["slots"][0]["slot_id"] == "slot-free"


@pytest.mark.unit
@pytest.mark.asyncio
async def test_consultations_exclude_patient_details(monkeypatch):
    """Return consultation times without patient-identifying data."""

    async def fake_owned_doctor(db, actor, permission):
        assert permission == "doctor_appointments"
        return "doctor-profile-1"

    async def fake_list_appointments(
        db, filters, model, doctor_id
    ):
        assert filters == {
            "date": "2026-11-16",
            "status": "CONFIRMED",
        }
        assert model == "Doctor"
        assert doctor_id == "doctor-profile-1"

        return [{
            "id": "appointment-1",
            "status": "CONFIRMED",
            "appointmentTime": datetime(2026, 11, 16, 9),
            "patientName": "Private Patient",
            "patientString": "private@example.com",
        }]

    async def fake_audit(*args, **kwargs):
        return None

    monkeypatch.setattr(
        queries, "_get_owned_doctor_id", fake_owned_doctor
    )
    monkeypatch.setattr(
        queries, "list_appointments", fake_list_appointments
    )
    monkeypatch.setattr(
        queries, "audit_agent_action", fake_audit
    )

    result = await queries.get_my_consultation_slots(
        db=None,
        actor=DOCTOR,
        day=TEST_DATE,
    )

    assert result["total_confirmed"] == 1
    assert result["appointments"][0]["status"] == "CONFIRMED"
    assert "patientName" not in str(result)
    assert "private@example.com" not in str(result)


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

    def _generate(
        self,
        messages,
        stop=None,
        run_manager=None,
        **kwargs,
    ) -> ChatResult:
        response = self._responses[self._index]
        self._index += 1

        return ChatResult(
            generations=[
                ChatGeneration(message=response)
            ]
        )


@pytest.mark.unit
@pytest.mark.asyncio
async def test_langgraph_executes_tool_and_returns_answer():
    """Verify the complete agent -> tool -> agent loop."""

    executed = []

    @tool
    async def get_my_free_slots(day: str) -> dict:
        """Return the authenticated doctor's free slots."""
        executed.append(day)

        return {
            "date": day,
            "total_free": 2,
        }

    model = ScriptedDoctorModel([
        AIMessage(
            content="",
            tool_calls=[{
                "id": "call-1",
                "name": "get_my_free_slots",
                "args": {"day": "2026-11-16"},
            }],
        ),
        AIMessage(
            content="You have 2 free slots on November 16."
        ),
    ])

    graph = build_workflow(
        model=model,
        tools=[get_my_free_slots],
    )

    result = await graph.ainvoke({
        "messages": [
            HumanMessage(
                content="Show my free slots for November 16."
            )
        ],
        "next_agent": "doctor",
    })

    assert executed == ["2026-11-16"]

    assert any(
        isinstance(message, ToolMessage)
        for message in result["messages"]
    )

    assert (
        result["messages"][-1].content
        == "You have 2 free slots on November 16."
    )


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
        tools = {
            item.name: item
            for item in doctor_tools.build_doctor_tools(db, DOCTOR)
        }
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
