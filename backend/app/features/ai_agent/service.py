"""Application service for the Quick-Clinic AI Agent."""

import time
from datetime import datetime
from typing import Any

from fastapi import HTTPException
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from sqlalchemy.ext.asyncio import AsyncConnection

from app.core.clock import now_clinic, to_clinic_time
from app.features.ai_agent.approval_resume import (
    decide_and_resume_approval,
    extract_ai_text,
    format_approval_payload,
    optional_checkpointer,
)
from app.features.ai_agent.graph.workflow import build_workflow
from app.features.ai_agent.hitl_bridge import build_hitl_callbacks
from app.features.ai_agent.models.fallback import get_fallback_model
from app.features.ai_agent.models.providers import get_model
from app.features.ai_agent.persistence.approvals import list_thread_approvals
from app.features.ai_agent.persistence.telemetry import (
    create_memory_snapshot,
    get_latest_valid_memory,
    record_model_call,
)
from app.features.ai_agent.persistence.threads import (
    append_message,
    append_turn,
    complete_turn,
    create_or_get_thread,
    list_thread_messages,
)
from app.features.ai_agent.prompts import (
    DOCTOR_SYSTEM_PROMPT,
    PATIENT_SYSTEM_PROMPT,
    build_system_prompt,
)
from app.features.ai_agent.rag.pipeline import persist_message_citations
from app.features.ai_agent.security.guardrails import validate_user_message
from app.features.ai_agent.service_helpers import (
    build_conversation_summary,
    build_role_tools,
    extract_citations_from_messages,
)

MAX_CONTEXT_MESSAGES = 40
_format_approval_payload = format_approval_payload


class AIAgentService:
    """Execute authenticated, durable AI conversations."""

    def __init__(self, provider: str = "google"):
        self.provider = provider
        ordered = [provider, "groq", "cohere"]
        self.model = get_fallback_model(ordered, model_factory=get_model)

    def _validate_actor(self, actor: dict[str, Any]) -> str:
        if (
            not isinstance(actor, dict)
            or actor.get("isActive") is not True
            or actor.get("role") not in {"DOCTOR", "PATIENT"}
            or not actor.get("id")
        ):
            raise HTTPException(status_code=403, detail="AI assistant access denied")
        return str(actor["role"])

    async def chat(
        self,
        message: str,
        actor: dict[str, Any],
        db: AsyncConnection | None = None,
        now_ist: datetime | None = None,
    ) -> str:
        """Stateless-compatible chat entrypoint used by legacy callers/tests."""

        role = self._validate_actor(actor)
        message = validate_user_message(message)
        current_ist = to_clinic_time(now_ist) if now_ist is not None else now_clinic()

        if role == "DOCTOR" and db is None:
            raise RuntimeError("Database connection required for Doctor Agent")
        tools = (
            build_role_tools(role=role, db=db, actor=actor, reference_date=current_ist.date())
            if db is not None
            else []
        )
        system_prompt = build_system_prompt(
            DOCTOR_SYSTEM_PROMPT if role == "DOCTOR" else PATIENT_SYSTEM_PROMPT,
            current_ist,
        )

        graph = build_workflow(model=self.model, tools=tools, role=role)
        result = await graph.ainvoke(
            {
                "messages": [SystemMessage(content=system_prompt), HumanMessage(content=message)],
                "next_agent": "doctor" if role == "DOCTOR" else "patient",
            },
            config={"recursion_limit": 16},
        )
        response = result["messages"][-1]
        if not isinstance(response, AIMessage) or response.tool_calls:
            raise RuntimeError("Invalid AI response")
        answer = extract_ai_text(response)
        if not answer:
            raise RuntimeError("AI model returned an empty response")
        return answer

    async def chat_turn(
        self,
        *,
        message: str,
        actor: dict[str, Any],
        db: AsyncConnection,
        thread_id: str | None = None,
        now_ist: datetime | None = None,
        checkpointer: Any = None,
    ) -> dict[str, Any]:
        """Run a persisted, checkpoint-aware Doctor Agent turn."""

        role = self._validate_actor(actor)
        message = validate_user_message(message)
        current_ist = to_clinic_time(now_ist) if now_ist is not None else now_clinic()

        thread = await create_or_get_thread(db, actor=actor, thread_id=thread_id)
        tid = thread["id"]
        history = await list_thread_messages(db, thread_id=tid, limit=MAX_CONTEXT_MESSAGES)
        memory = await get_latest_valid_memory(
            db, thread_id=tid, permission_revision=thread["permissionRevision"]
        )

        turn = await append_turn(db, thread_id=tid, original_query=message)
        user_msg_row = await append_message(db, thread_id=tid, turn_id=turn["id"], role="USER", content=message)

        sys_msg = SystemMessage(
            id="qc_system_prompt",
            content=build_system_prompt(
                DOCTOR_SYSTEM_PROMPT if role == "DOCTOR" else PATIENT_SYSTEM_PROMPT,
                current_ist,
            ),
        )
        new_user_msg = HumanMessage(id=f"qc_msg_{user_msg_row['id']}", content=message)

        started = time.monotonic()
        async with optional_checkpointer() as cp_from_env:
            active_cp = checkpointer or cp_from_env
            enable_hitl = active_cp is not None
            tools = build_role_tools(
                role=role,
                db=db,
                actor=actor,
                reference_date=current_ist.date(),
                thread_id=tid,
                turn_id=turn["id"],
                include_mutations=enable_hitl,
            )
            if enable_hitl:
                factory, verifier, executor = build_hitl_callbacks(
                    db, actor=actor, thread_id=tid, turn_id=turn["id"]
                )
                graph = build_workflow(
                    model=self.model,
                    tools=tools,
                    role=role,
                    checkpointer=active_cp,
                    approval_request_factory=factory,
                    approval_verifier=verifier,
                    approved_tool_executor=executor,
                )
            else:
                graph = build_workflow(model=self.model, tools=tools, role=role, checkpointer=active_cp)

            config: dict[str, Any] = {"recursion_limit": 16}
            has_existing_cp_messages = False
            if active_cp is not None:
                config["configurable"] = {"thread_id": tid}
                try:
                    existing_state = await graph.aget_state(config)
                    existing_msgs = (existing_state.values or {}).get("messages") if existing_state else None
                    has_existing_cp_messages = bool(existing_msgs)
                except Exception:
                    has_existing_cp_messages = False

            if has_existing_cp_messages:
                lc_messages: list[Any] = [sys_msg]
                if memory:
                    lc_messages.append(
                        SystemMessage(id="qc_memory_summary", content=f"Conversation summary:\n{memory['summary']}")
                    )
                lc_messages.append(new_user_msg)
            else:
                lc_messages = [sys_msg]
                if memory:
                    lc_messages.append(
                        SystemMessage(id="qc_memory_summary", content=f"Conversation summary:\n{memory['summary']}")
                    )
                for item in history[-MAX_CONTEXT_MESSAGES:]:
                    if item["role"] == "USER":
                        lc_messages.append(HumanMessage(id=f"qc_msg_{item['id']}", content=item["content"]))
                    elif item["role"] == "ASSISTANT":
                        lc_messages.append(AIMessage(id=f"qc_msg_{item['id']}", content=item["content"]))
                lc_messages.append(new_user_msg)

            result = await graph.ainvoke(
                {"messages": lc_messages, "next_agent": "doctor" if role == "DOCTOR" else "patient"},
                config=config,
            )

        await record_model_call(
            db,
            thread_id=tid,
            turn_id=turn["id"],
            purpose="answer",
            provider=self.provider,
            model=str(getattr(self.model, "model", "gemini")),
            latency_ms=int((time.monotonic() - started) * 1000),
        )

        interrupts = result.get("__interrupt__") if isinstance(result, dict) else None
        if interrupts:
            approvals = await list_thread_approvals(db, actor=actor, thread_id=tid)
            pending = next((a for a in reversed(approvals) if a["status"] == "PENDING"), None)
            approval_payload = format_approval_payload(pending) if pending else None
            assistant_text = pending["summary"] if pending else "Human approval is required to continue."
            msg_row = await append_message(
                db,
                thread_id=tid,
                turn_id=turn["id"],
                role="ASSISTANT",
                content=assistant_text,
                metadata={"approvalId": pending["id"] if pending else None},
            )
            return {
                "threadId": tid,
                "message": {
                    "id": msg_row["id"],
                    "role": "assistant",
                    "content": assistant_text,
                    "createdAt": msg_row["createdAt"].isoformat(),
                    "status": "sent",
                    "approvalRequest": approval_payload,
                },
                "approvalRequest": approval_payload,
                "mode": "live",
            }

        response = result["messages"][-1]
        answer = extract_ai_text(response) if isinstance(response, AIMessage) else str(response)
        citations = extract_citations_from_messages(result.get("messages", []))
        msg_row = await append_message(
            db,
            thread_id=tid,
            turn_id=turn["id"],
            role="ASSISTANT",
            content=answer,
            metadata={"citations": citations} if citations else None,
        )
        await persist_message_citations(db, message_id=msg_row["id"], citations=citations)
        await complete_turn(db, turn_id=turn["id"], status="COMPLETED", response_text=answer)

        if len(history) + 2 >= 30 and (len(history) + 2) % 10 == 0:
            covered = [m["id"] for m in history[-20:]] + [msg_row["id"]]
            await create_memory_snapshot(
                db,
                thread_id=tid,
                summary=build_conversation_summary(history, message, answer, citations),
                covered_message_ids=covered,
                source_chunk_ids=[c["chunkStableId"] for c in citations if c.get("chunkStableId")],
                permission_revision=thread["permissionRevision"],
                latest_message_id=msg_row["id"],
            )

        return {
            "threadId": tid,
            "message": {
                "id": msg_row["id"],
                "role": "assistant",
                "content": answer,
                "createdAt": msg_row["createdAt"].isoformat(),
                "status": "sent",
                "citations": citations,
            },
            "citations": citations,
            "mode": "live",
        }

    async def decide_and_resume(
        self,
        *,
        db: AsyncConnection,
        actor: dict[str, Any],
        thread_id: str,
        approval_id: str,
        decision: str,
        decision_reason: str | None = None,
        checkpointer: Any = None,
    ) -> dict[str, Any]:
        self._validate_actor(actor)
        return await decide_and_resume_approval(
            model=self.model,
            db=db,
            actor=actor,
            thread_id=thread_id,
            approval_id=approval_id,
            decision=decision,
            decision_reason=decision_reason,
            checkpointer=checkpointer,
        )
