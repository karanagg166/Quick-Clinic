"""Medical-document RAG query classification, rewrite, and grounded answering."""

import re
from typing import Any

from langchain_core.messages import HumanMessage, SystemMessage
from sqlalchemy.ext.asyncio import AsyncConnection

from app.core.config import get_settings
from app.features.ai_agent.models.providers import get_model
from app.infrastructure.database import new_id, tables, utcnow

from .retrieval import retrieve_authorized_chunks

DEPENDENCY_PATTERN = re.compile(
    r"\b(it|its|that|this|those|these|they|them|the report|the lab|same patient|previous|earlier)\b",
    re.I,
)


def rewrite_query_if_dependent(
    question: str,
    history_messages: list[dict[str, Any]] | None = None,
) -> tuple[str, bool]:
    """Rewrite follow-up questions using recent user context without DB access."""

    if not history_messages or not DEPENDENCY_PATTERN.search(question):
        return question.strip(), False

    prior_user = [
        str(m.get("content", "")).strip()
        for m in reversed(history_messages)
        if str(m.get("role", "")).upper() == "USER" and str(m.get("content", "")).strip()
    ]
    if not prior_user:
        return question.strip(), False

    context_snippet = prior_user[0][:240]
    return f"{question.strip()} (Context from prior question: {context_snippet})", True


def _build_citations(hits: list[dict[str, Any]]) -> list[dict[str, Any]]:
    citations: list[dict[str, Any]] = []
    for idx, hit in enumerate(hits, start=1):
        title = hit.get("documentTitle") or "Medical Document"
        page = hit.get("startPage") or 1
        citations.append(
            {
                "label": f"[{idx}] {title} (p. {page})",
                "type": "document",
                "documentId": hit.get("documentId"),
                "documentVersionId": hit.get("versionId"),
                "chunkStableId": hit.get("chunkStableId"),
                "retrievalHitId": hit.get("retrievalHitId"),
                "pageNumber": page,
                "contentSha256": hit.get("contentSha256"),
                "sourceRefs": hit.get("provenance"),
                "href": f"/doctor/patients/{hit.get('patientId') or ''}",
            }
        )
    return citations


async def answer_medical_question(
    db: AsyncConnection,
    *,
    actor: dict[str, Any],
    patient_id: str,
    question: str,
    turn_id: str | None = None,
    history_messages: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Answer a doctor's question grounded strictly in authorized patient documents."""

    rewritten_query, was_rewritten = rewrite_query_if_dependent(question, history_messages)
    retrieval = await retrieve_authorized_chunks(
        db,
        actor=actor,
        patient_id=patient_id,
        query=rewritten_query,
        turn_id=turn_id,
        top_k=5,
    )
    hits = retrieval["hits"]
    for h in hits:
        h["patientId"] = patient_id

    if not hits:
        return {
            "type": "MEDICAL_RAG_ANSWER",
            "patientId": patient_id,
            "rewrittenQuery": rewritten_query if was_rewritten else None,
            "answer": (
                "No matching extracted evidence was found in this patient's uploaded "
                "medical documents. Ensure the document has finished processing."
            ),
            "citations": [],
            "retrievalRunId": retrieval["retrievalRunId"],
        }

    citations = _build_citations(hits)
    evidence_blocks = []
    for idx, hit in enumerate(hits, start=1):
        evidence_blocks.append(
            f"[{idx}] {hit['documentTitle']} (Page {hit['startPage']}, Kind: {hit['kind']}):\n"
            f"{hit['content']}"
        )

    settings = get_settings()
    answer_text = ""
    if settings.google_api_key or settings.groq_api_key or settings.cohere_api_key:
        provider = (
            "google"
            if settings.google_api_key
            else "groq"
            if settings.groq_api_key
            else "cohere"
        )
        try:
            model = get_model(provider)
            prompt = (
                "Answer the doctor's question using ONLY the numbered medical document "
                "excerpts below. Cite sources inline as [1], [2], etc. Never invent values "
                "or present uncertain chart estimates as verified facts.\n\n"
                + "\n\n".join(evidence_blocks)
            )
            msg = await model.ainvoke([SystemMessage(content=prompt), HumanMessage(content=question)])
            content = getattr(msg, "content", "")
            answer_text = content if isinstance(content, str) else str(content)
        except Exception:
            answer_text = ""

    if not answer_text:
        top_snippets = "\n".join(
            f"- {c['label']}: {hits[i]['content'][:280]}" for i, c in enumerate(citations[:3])
        )
        answer_text = f"Based on the authorized medical documents:\n{top_snippets}"

    return {
        "type": "MEDICAL_RAG_ANSWER",
        "patientId": patient_id,
        "rewrittenQuery": rewritten_query if was_rewritten else None,
        "answer": answer_text,
        "citations": citations,
        "retrievalRunId": retrieval["retrievalRunId"],
    }


async def persist_message_citations(
    db: AsyncConnection,
    *,
    message_id: str,
    citations: list[dict[str, Any]],
) -> None:
    if not citations:
        return
    table = tables["AgentMessageCitation"]
    now = utcnow()
    for c in citations:
        await db.execute(
            table.insert().values(
                id=new_id(),
                messageId=message_id,
                retrievalHitId=c.get("retrievalHitId"),
                label=str(c.get("label", "Source"))[:200],
                chunkStableId=c.get("chunkStableId"),
                documentVersionId=c.get("documentVersionId"),
                pageNumber=c.get("pageNumber"),
                sourceRefs=c.get("sourceRefs"),
                contentSha256=c.get("contentSha256"),
                createdAt=now,
            )
        )
