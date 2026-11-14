
"""FastAPI routes for the Quick-Clinic AI Agent."""

from functools import lru_cache

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncConnection

from app.core.clock import get_request_clock
from app.core.security import current_user
from app.infrastructure.database import get_db

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
    """Reuse the model without caching user-specific tools."""
    return AIAgentService(provider="google")


@router.post(
    "/chat",
    response_model=ChatResponse,
)
async def chat_with_agent(
    payload: ChatRequest,
    request: Request,
    actor: dict = Depends(current_user),
    db: AsyncConnection = Depends(get_db),
) -> ChatResponse:
    """Run the authenticated Doctor or Patient AI assistant."""

    service = get_agent_service()
    req_clock = get_request_clock(request)

    response = await service.chat(
        message=payload.message,
        actor=actor,
        db=db,
        now_ist=req_clock.now_clinic,
    )

    return ChatResponse(response=response)
