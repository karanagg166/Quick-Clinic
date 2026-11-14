"""Helper functions for AIAgentService role tool assembly, citations, and summaries."""

import json
from datetime import date
from typing import Any

from langchain_core.messages import ToolMessage
from sqlalchemy.ext.asyncio import AsyncConnection

from app.features.ai_agent.tools.doctor import build_doctor_tools
from app.features.ai_agent.tools.patient import build_patient_tools

_RAG_TOOL_NAMES = frozenset({"query_patient_medical_documents", "search_my_medical_documents"})


def build_role_tools(
    *,
    role: str,
    db: AsyncConnection,
    actor: dict[str, Any],
    reference_date: date,
    thread_id: str | None = None,
    turn_id: str | None = None,
    include_mutations: bool = False,
) -> list[Any]:
    if role == "DOCTOR":
        return build_doctor_tools(
            db=db,
            actor=actor,
            reference_date=reference_date,
            thread_id=thread_id,
            turn_id=turn_id,
            include_mutations=include_mutations,
        )
    return build_patient_tools(
        db=db,
        actor=actor,
        reference_date=reference_date,
        thread_id=thread_id,
        turn_id=turn_id,
        include_mutations=include_mutations,
    )


def extract_citations_from_messages(messages: list[Any]) -> list[dict[str, Any]]:
    citations: list[dict[str, Any]] = []
    for m in messages:
        if isinstance(m, ToolMessage) and getattr(m, "name", "") in _RAG_TOOL_NAMES:
            try:
                payload = json.loads(m.content) if isinstance(m.content, str) else m.content
                if isinstance(payload, dict) and isinstance(payload.get("citations"), list):
                    citations.extend(payload["citations"])
            except Exception:
                pass
    return citations


def build_conversation_summary(
    history: list[dict[str, Any]],
    latest_user: str,
    latest_assistant: str,
    citations: list[dict[str, Any]],
) -> str:
    user_topics = [
        m["content"].strip().replace("\n", " ")[:90]
        for m in history[-10:]
        if m.get("role") == "USER" and m.get("content")
    ]
    user_topics.append(latest_user.strip().replace("\n", " ")[:90])
    cited_docs = sorted({str(c.get("documentId") or c.get("label") or "") for c in citations if c})
    doc_note = f" Cited sources: {', '.join(cited_docs[:4])}." if cited_docs else ""
    return (
        f"Discussed topics ({len(user_topics)} turns): "
        + " | ".join(user_topics[-4:])
        + f". Latest outcome: {latest_assistant.strip().replace(chr(10), ' ')[:140]}.{doc_note}"
    )[:900]
