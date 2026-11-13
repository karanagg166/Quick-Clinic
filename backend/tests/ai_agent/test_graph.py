
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


@pytest.mark.unit
@pytest.mark.asyncio
async def test_chat_endpoint_returns_ai_response(monkeypatch):
    """Exercise FastAPI and LangGraph without a real API call."""

    fake_model = FakeListChatModel(
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
