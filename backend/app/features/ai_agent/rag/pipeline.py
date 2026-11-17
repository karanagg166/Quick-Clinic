"""Shared medical-document RAG pipeline for Doctor and Patient AI agents."""

from typing import Any

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from search_sphere_rag import ConversationTurn, classify_query_intent, rewrite_query
from sqlalchemy.ext.asyncio import AsyncConnection

from app.core.config import get_settings
from app.features.ai_agent.models.providers import get_model
from app.infrastructure.database import new_id, tables, utcnow

from .retrieval import retrieve_authorized_chunks


def _extract_ai_text(msg: Any) -> str:
    content = getattr(msg, "content", "")
    if isinstance(content, str):
        return content.strip()
    if isinstance(content, list):
        parts = [p.get("text", "") if isinstance(p, dict) else str(p) for p in content]
        return "\n".join(p for p in parts if p).strip()
    return str(content).strip()


def _to_turns(history_messages: list[dict[str, Any]] | None) -> list[ConversationTurn]:
    if not history_messages:
        return []
    return [
        ConversationTurn(
            role=str(m.get("role", "USER")),
            content=str(m.get("content", "")),
            message_id=m.get("id"),
        )
        for m in history_messages
        if str(m.get("content", "")).strip()
    ]


async def rewrite_query_if_dependent(
    question: str,
    history_messages: list[dict[str, Any]] | None = None,
) -> tuple[str, bool, bool]:
    """Classify and rewrite follow-up questions using search-sphere-rag."""

    turns = _to_turns(history_messages)
    res = await rewrite_query(question, turns)
    return res.rewritten_query, res.was_rewritten, res.requires_history


def _build_citations(hits: list[dict[str, Any]], *, role: str) -> list[dict[str, Any]]:
    citations: list[dict[str, Any]] = []
    for idx, hit in enumerate(hits, start=1):
        title = hit.get("documentTitle") or "Medical Document"
        page = hit.get("startPage") or 1
        href = (
            f"/doctor/patients/{hit.get('patientId') or ''}/medical-documents"
            if role == "DOCTOR"
            else "/patient/medical-documents"
        )
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
                "href": href,
            }
        )
    return citations


async def retrieve_medical_evidence(
    db: AsyncConnection,
    *,
    actor: dict[str, Any],
    question: str,
    patient_id: str | None = None,
    turn_id: str | None = None,
    history_messages: list[dict[str, Any]] | None = None,
    document_ids: list[str] | None = None,
    document_type: str | None = None,
    top_k: int = 5,
) -> dict[str, Any]:
    """Shared retrieval + query rewrite + citation packaging for both agents."""

    intent = classify_query_intent(question)
    rewritten_query, was_rewritten, requires_hist = await rewrite_query_if_dependent(
        question, history_messages
    )
    retrieval = await retrieve_authorized_chunks(
        db,
        actor=actor,
        patient_id=patient_id,
        query=rewritten_query or question,
        turn_id=turn_id,
        top_k=top_k,
        document_ids=document_ids,
        document_type=document_type,
    )
    hits = retrieval["hits"]
    role = str(actor.get("role") or "PATIENT")
    citations = _build_citations(hits, role=role)
    formatted_chunks = [
        {
            "chunk_id": h["chunkId"],
            "chunk_stable_id": h.get("chunkStableId"),
            "document_id": h["documentId"],
            "document_title": h.get("documentTitle"),
            "document_version_id": h.get("versionId"),
            "content": h["content"],
            "kind": h.get("kind", "text"),
            "page_numbers": h.get("pageNumbers") or [h.get("startPage") or 1],
            "source_refs": h.get("provenance") or [],
            "score": h.get("rerankScore") or h.get("hybridScore") or 0.0,
            "review_required": bool(h.get("reviewRequired", False)),
        }
        for h in hits
    ]
    return {
        "query": question,
        "rewritten_query": rewritten_query if was_rewritten else question,
        "was_rewritten": was_rewritten,
        "requires_history": requires_hist,
        "intent_route": intent.route.value,
        "patientId": retrieval["patientId"],
        "retrieval_run_id": retrieval["retrievalRunId"],
        "retrievalRunId": retrieval["retrievalRunId"],
        "hits": hits,
        "chunks": formatted_chunks,
        "citations": citations,
    }


async def answer_medical_question(
    db: AsyncConnection,
    *,
    actor: dict[str, Any],
    patient_id: str | None,
    question: str,
    turn_id: str | None = None,
    history_messages: list[dict[str, Any]] | None = None,
    document_ids: list[str] | None = None,
    document_type: str | None = None,
    top_k: int = 5,
) -> dict[str, Any]:
    """Answer a doctor or patient question grounded strictly in authorized documents."""

    evidence = await retrieve_medical_evidence(
        db,
        actor=actor,
        question=question,
        patient_id=patient_id,
        turn_id=turn_id,
        history_messages=history_messages,
        document_ids=document_ids,
        document_type=document_type,
        top_k=top_k,
    )
    hits = evidence["hits"]
    citations = evidence["citations"]

    if not hits:
        return {
            "type": "MEDICAL_RAG_ANSWER",
            "patientId": evidence["patientId"],
            "rewrittenQuery": evidence["rewritten_query"] if evidence["was_rewritten"] else None,
            "answer": (
                "No matching extracted evidence was found in the authorized medical "
                "documents. Ensure the document has finished processing."
            ),
            "citations": [],
            "chunks": [],
            "retrievalRunId": evidence["retrievalRunId"],
            "provider": None,
            "model": None,
            "generationMode": "no_evidence",
        }

    evidence_blocks = [
        f"[{idx}] {hit['documentTitle']} (Page {hit['startPage']}, Kind: {hit['kind']}):\n{hit['content']}"
        for idx, hit in enumerate(hits, start=1)
    ]

    settings = get_settings()
    answer_text = ""
    used_provider: str | None = None
    used_model: str | None = None
    generation_mode = "fallback_snippets"

    configured_providers = [
        name
        for name, key in (
            ("google", settings.google_api_key),
            ("groq", settings.groq_api_key),
            ("cohere", settings.cohere_api_key),
        )
        if key
    ]
    if configured_providers:
        role_label = "doctor's" if actor.get("role") == "DOCTOR" else "patient's"
        prompt = (
            f"Answer the {role_label} question using ONLY the numbered medical document "
            "excerpts below. Cite sources inline as [1], [2], etc. If the excerpts do not "
            "contain the requested fact, state clearly that the provided documents do not "
            "contain that information. Never invent values or present uncertain chart "
            "estimates as verified facts.\n\n"
            + "\n\n".join(evidence_blocks)
        )
        for provider in configured_providers:
            try:
                model = get_model(provider)
                msg = await model.ainvoke([SystemMessage(content=prompt), HumanMessage(content=question)])
                candidate = _extract_ai_text(msg) if isinstance(msg, AIMessage) else str(getattr(msg, "content", msg)).strip()
                if candidate:
                    answer_text = candidate
                    used_provider = provider
                    used_model = str(getattr(model, "model", provider))
                    generation_mode = "llm"
                    break
            except Exception:
                continue

    if not answer_text:
        top_snippets = "\n".join(
            f"- {c['label']}: {hits[i]['content'][:280]}" for i, c in enumerate(citations[:3])
        )
        answer_text = f"Based on the authorized medical documents:\n{top_snippets}"

    return {
        "type": "MEDICAL_RAG_ANSWER",
        "patientId": evidence["patientId"],
        "rewrittenQuery": evidence["rewritten_query"] if evidence["was_rewritten"] else None,
        "answer": answer_text,
        "citations": citations,
        "chunks": evidence["chunks"],
        "retrievalRunId": evidence["retrievalRunId"],
        "provider": used_provider,
        "model": used_model,
        "generationMode": generation_mode,
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
