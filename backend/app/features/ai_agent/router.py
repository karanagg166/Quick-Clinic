
"""FastAPI routes for the Quick-Clinic AI Agent."""

from functools import lru_cache

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from app.core.security import current_user

from .service import AIAgentService


router = APIRouter(
    prefix="/api/ai-agent",
    tags=["AI Agent"],
)


class ChatRequest(BaseModel):
    message: str = Field(
        min_length=1,
        max_length=6000,
    )


class ChatResponse(BaseModel):
    response: str


@lru_cache(maxsize=1)
def get_agent_service() -> AIAgentService:
    return AIAgentService(provider="google")


@router.post(
    "/chat",
    response_model=ChatResponse,
)
async def chat_with_agent(
    payload: ChatRequest,
    actor: dict = Depends(current_user),
) -> ChatResponse:
    service = get_agent_service()

    response = await service.chat(
        message=payload.message,
        actor=actor,
    )

    return ChatResponse(response=response)
