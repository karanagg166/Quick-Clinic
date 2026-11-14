"""FastAPI routes for the Quick-Clinic AI Agent."""

from functools import lru_cache
from typing import Any, Literal

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncConnection

from app.core.clock import get_request_clock
from app.core.security import current_user
from app.features.ai_agent.persistence.approvals import list_thread_approvals
from app.features.ai_agent.persistence.threads import (
    archive_owned_thread,
    get_owned_thread,
    list_owned_threads,
    list_thread_messages,
)
from app.infrastructure.database import get_db

from .service import AIAgentService, _format_approval_payload

router = APIRouter(prefix="/api/ai-agent", tags=["AI Agent"])


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=6000)
    threadId: str | None = Field(default=None, max_length=128)
    idempotencyKey: str | None = Field(default=None, max_length=128)


class ChatResponse(BaseModel):
    response: str
    threadId: str | None = None
    message: dict[str, Any] | None = None
    approvalRequest: dict[str, Any] | None = None
    citations: list[dict[str, Any]] | None = None
    mode: str = "live"


class ApprovalDecisionRequest(BaseModel):
    threadId: str = Field(min_length=1, max_length=128)
    decision: Literal["APPROVED", "REJECTED"]
    decisionReason: str | None = Field(default=None, max_length=300)
    idempotencyKey: str | None = Field(default=None, max_length=128)


@lru_cache(maxsize=1)
def get_agent_service() -> AIAgentService:
    """Reuse the model without caching user-specific tools."""
    return AIAgentService(provider="google")


@router.post("/chat", response_model=ChatResponse)
async def chat_with_agent(
    payload: ChatRequest,
    request: Request,
    actor: dict = Depends(current_user),
    db: AsyncConnection = Depends(get_db),
) -> ChatResponse:
    """Run the authenticated Doctor or Patient AI assistant."""

    service = get_agent_service()
    req_clock = get_request_clock(request)

    if payload.threadId is None:
        response = await service.chat(
            message=payload.message,
            actor=actor,
            db=db,
            now_ist=req_clock.now_clinic,
        )
        return JSONResponse({"response": response})

    result = await service.chat_turn(
        message=payload.message,
        actor=actor,
        db=db,
        thread_id=payload.threadId,
        now_ist=req_clock.now_clinic,
    )
    msg = result["message"]
    return ChatResponse(
        response=msg["content"],
        threadId=result["threadId"],
        message=msg,
        approvalRequest=result.get("approvalRequest"),
        citations=result.get("citations"),
        mode=result.get("mode", "live"),
    )


@router.get("/threads")
async def list_threads(
    actor: dict = Depends(current_user),
    db: AsyncConnection = Depends(get_db),
) -> dict[str, Any]:
    rows = await list_owned_threads(db, actor=actor)
    role = actor.get("role", "DOCTOR")
    threads = []
    for row in rows:
        msgs = await list_thread_messages(db, thread_id=row["id"], limit=50)
        approvals = await list_thread_approvals(db, actor=actor, thread_id=row["id"])
        approval_by_id = {a["id"]: _format_approval_payload(a) for a in approvals}
        formatted_msgs = []
        for m in msgs:
            meta = m.get("messageMetadata") or {}
            aid = meta.get("approvalId") if isinstance(meta, dict) else None
            formatted_msgs.append(
                {
                    "id": m["id"],
                    "role": m["role"].lower(),
                    "content": m["content"],
                    "createdAt": m["createdAt"].isoformat(),
                    "status": "sent",
                    "citations": meta.get("citations") if isinstance(meta, dict) else None,
                    "approvalRequest": approval_by_id.get(aid) if aid else None,
                }
            )
        threads.append(
            {
                "threadId": row["id"],
                "title": row["title"],
                "role": role,
                "createdAt": row["createdAt"].isoformat(),
                "updatedAt": row["updatedAt"].isoformat(),
                "messages": formatted_msgs,
            }
        )
    return {"threads": threads, "mode": "live"}


@router.get("/threads/{thread_id}")
async def get_thread(
    thread_id: str,
    actor: dict = Depends(current_user),
    db: AsyncConnection = Depends(get_db),
) -> dict[str, Any]:
    row = await get_owned_thread(db, actor=actor, thread_id=thread_id)
    msgs = await list_thread_messages(db, thread_id=thread_id, limit=100)
    return {
        "threadId": row["id"],
        "title": row["title"],
        "role": actor.get("role", "DOCTOR"),
        "createdAt": row["createdAt"].isoformat(),
        "updatedAt": row["updatedAt"].isoformat(),
        "messages": [
            {
                "id": m["id"],
                "role": m["role"].lower(),
                "content": m["content"],
                "createdAt": m["createdAt"].isoformat(),
                "status": "sent",
                "citations": (m.get("messageMetadata") or {}).get("citations"),
            }
            for m in msgs
        ],
    }


@router.delete("/threads/{thread_id}")
async def delete_thread(
    thread_id: str,
    actor: dict = Depends(current_user),
    db: AsyncConnection = Depends(get_db),
) -> dict[str, bool]:
    await archive_owned_thread(db, actor=actor, thread_id=thread_id)
    return {"success": True}


@router.post("/approvals/{approval_id}/decision")
async def decide_agent_approval(
    approval_id: str,
    payload: ApprovalDecisionRequest,
    actor: dict = Depends(current_user),
    db: AsyncConnection = Depends(get_db),
) -> dict[str, Any]:
    service = get_agent_service()
    return await service.decide_and_resume(
        db=db,
        actor=actor,
        thread_id=payload.threadId,
        approval_id=approval_id,
        decision=payload.decision,
        decision_reason=payload.decisionReason,
    )
