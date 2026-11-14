
"""Tests for the initial Quick-Clinic AI chat workflow."""

import importlib

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from langchain_core.language_models.fake_chat_models import (
    FakeListChatModel,
)

from app.core.security import current_user


service_module = importlib.import_module(
    "app.features.ai_agent.service"
)

router_module = importlib.import_module(
    "app.features.ai_agent.router"
)


class _ToolAwareFakeModel(FakeListChatModel):
    def bind_tools(self, tools, **kwargs):
        return self


@pytest.mark.unit
@pytest.mark.asyncio
async def test_chat_endpoint_returns_ai_response(monkeypatch):
    """Exercise FastAPI and LangGraph without a real API call."""

    fake_model = _ToolAwareFakeModel(
        responses=["Hello! I am your Quick-Clinic assistant."]
    )

    monkeypatch.setattr(
        service_module,
        "get_model",
        lambda provider="google": fake_model,
    )

    service = service_module.AIAgentService()

    monkeypatch.setattr(
        router_module,
        "get_agent_service",
        lambda: service,
    )

    app = FastAPI()
    app.include_router(router_module.router)

    app.dependency_overrides[current_user] = lambda: {
        "id": "test-patient",
        "role": "PATIENT",
        "isActive": True,
    }

    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        response = await client.post(
            "/api/ai-agent/chat",
            json={"message": "Hello"},
        )

    assert response.status_code == 200
    assert response.json() == {
        "response": "Hello! I am your Quick-Clinic assistant."
    }


@pytest.mark.unit
@pytest.mark.asyncio
async def test_inactive_user_is_rejected(monkeypatch):
    fake_model = FakeListChatModel(
        responses=["This should not be returned."]
    )

    monkeypatch.setattr(
        service_module,
        "get_model",
        lambda provider="google": fake_model,
    )

    service = service_module.AIAgentService()

    from fastapi import HTTPException

    with pytest.raises(HTTPException) as exc:
        await service.chat(
            message="Hello",
            actor={
                "id": "test-user",
                "role": "PATIENT",
                "isActive": False,
            },
        )

    assert exc.value.status_code == 403


@pytest.mark.unit
@pytest.mark.asyncio
async def test_doctor_agent_chat_receives_dynamic_ist_prompt_and_resolves_today(monkeypatch):
    """End-to-end Doctor Agent chat receives current IST prompt and resolves 'today' accurately."""
    from datetime import date
    from langchain_core.language_models.chat_models import BaseChatModel
    from langchain_core.messages import AIMessage, SystemMessage
    from langchain_core.outputs import ChatGeneration, ChatResult
    from pydantic import PrivateAttr

    from app.core.clock import freeze_clock
    from app.features.ai_agent.tools import doctor as doctor_tools

    captured_system_prompts: list[str] = []
    queried_days: list[date] = []

    class CapturingDoctorModel(BaseChatModel):
        _responses: list[AIMessage] = PrivateAttr()
        _index: int = PrivateAttr(default=0)

        def __init__(self, responses: list[AIMessage]):
            super().__init__()
            self._responses = responses

        @property
        def _llm_type(self) -> str:
            return "capturing-doctor-model"

        def bind_tools(self, tools, **kwargs):
            return self

        def _generate(self, messages, stop=None, run_manager=None, **kwargs) -> ChatResult:
            for msg in messages:
                if isinstance(msg, SystemMessage):
                    captured_system_prompts.append(msg.content)
            response = self._responses[self._index]
            self._index += 1
            return ChatResult(generations=[ChatGeneration(message=response)])

    async def fake_fetch_free_slots(*, db, actor, day):
        queried_days.append(day)
        return {
            "date": day.isoformat(),
            "timezone": "Asia/Kolkata",
            "type": "FREE_SLOTS",
            "total_free": 1,
            "materialized_slot_count": 1,
            "slots": [
                {
                    "slot_id": "slot-1",
                    "start_time": f"{day.isoformat()}T09:00:00+05:30",
                    "end_time": f"{day.isoformat()}T09:10:00+05:30",
                }
            ],
        }

    monkeypatch.setattr(doctor_tools, "fetch_free_slots", fake_fetch_free_slots)

    fake_model = CapturingDoctorModel([
        AIMessage(
            content="",
            tool_calls=[{
                "id": "call-today",
                "name": "get_my_free_slots",
                "args": {"day": "today"},
            }],
        ),
        AIMessage(content="You have 1 free slot today (2026-11-15) at 09:00 IST."),
    ])

    monkeypatch.setattr(service_module, "get_model", lambda provider="google": fake_model)
    service = service_module.AIAgentService()

    # Freeze clock at 2026-11-14T18:30:00Z -> 2026-11-15T00:00:00+05:30 (Sunday in IST)
    with freeze_clock("2026-11-14T18:30:00Z"):
        answer = await service.chat(
            message="Give me my free slots for today",
            actor={"id": "doc-user-1", "role": "DOCTOR", "isActive": True},
            db=object(),
        )

    assert "2026-11-15" in answer
    assert queried_days == [date(2026, 11, 15)]
    assert captured_system_prompts
    prompt_text = captured_system_prompts[0]
    assert "Authoritative clinic timezone: Asia/Kolkata" in prompt_text
    assert "Current clinic datetime: 2026-11-15T00:00:00+05:30" in prompt_text
    assert "Current clinic date: 2026-11-15" in prompt_text
    assert "Current clinic weekday: Sunday" in prompt_text
    assert "2025-01-05" not in prompt_text
