"""Authorized hybrid retrieval and pgvector ranking for medical documents."""

import re
import time
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncConnection

from app.features.doctors.agent_patient_queries import _authorize_patient, _resolve_doctor
from app.features.documents.embeddings import embed_query
from app.infrastructure.database import new_id, tables, utcnow


def _tokenize(text: str) -> set[str]:
    return {t for t in re.findall(r"[a-z0-9]+", text.lower()) if len(t) > 1}


def _lexical_score(query_tokens: set[str], content: str) -> float:
    if not query_tokens:
        return 0.0
    doc_tokens = _tokenize(content)
    if not doc_tokens:
        return 0.0
    overlap = len(query_tokens & doc_tokens)
    return overlap / max(1, len(query_tokens))


def _cosine_similarity(a: list[float], b: list[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    na = sum(x * x for x in a) ** 0.5
    nb = sum(y * y for y in b) ** 0.5
    if na == 0.0 or nb == 0.0:
        return 0.0
    return max(0.0, dot / (na * nb))


async def retrieve_authorized_chunks(
    db: AsyncConnection,
    *,
    actor: dict[str, Any],
    patient_id: str,
    query: str,
    turn_id: str | None = None,
    top_k: int = 6,
) -> dict[str, Any]:
    """Retrieve and rerank authorized chunks for a patient's medical documents."""

    started = time.monotonic()
    doctor = await _resolve_doctor(db, actor)
    await _authorize_patient(db, actor, doctor["id"], patient_id)

    chunks_t = tables["MedicalDocumentChunk"]
    versions_t = tables["MedicalDocumentVersion"]
    docs_t = tables["MedicalDocument"]
    emb_t = tables["MedicalChunkEmbedding"]

    stmt = (
        select(
            chunks_t.c.id.label("chunkId"),
            chunks_t.c.chunkStableId,
            chunks_t.c.versionId,
            chunks_t.c.kind,
            chunks_t.c.content,
            chunks_t.c.contentSha256,
            chunks_t.c.startPage,
            chunks_t.c.endPage,
            chunks_t.c.sourceObjectIds,
            chunks_t.c.provenance,
            docs_t.c.id.label("documentId"),
            docs_t.c.title.label("documentTitle"),
            docs_t.c.type.label("documentType"),
            docs_t.c.reportDate,
            emb_t.c.embedding,
        )
        .select_from(
            chunks_t.join(versions_t, versions_t.c.id == chunks_t.c.versionId)
            .join(docs_t, docs_t.c.id == versions_t.c.documentId)
            .outerjoin(emb_t, (emb_t.c.chunkId == chunks_t.c.id) & (emb_t.c.status == "COMPLETED"))
        )
        .where(
            docs_t.c.patientId == patient_id,
            versions_t.c.isPublished.is_(True),
            versions_t.c.revokedAt.is_(None),
        )
        .limit(200)
    )
    rows = (await db.execute(stmt)).mappings().all()

    q_tokens = _tokenize(query)
    q_emb = await embed_query(query) if rows else None
    q_vec = q_emb[2] if q_emb else None
    emb_model = q_emb[1] if q_emb else None

    scored: list[dict[str, Any]] = []
    for r in rows:
        sparse = _lexical_score(q_tokens, r["content"])
        dense = _cosine_similarity(q_vec, r["embedding"]) if (q_vec and r["embedding"]) else 0.0
        hybrid = (0.65 * dense + 0.35 * sparse) if q_vec else sparse
        if hybrid <= 0.0 and len(rows) > top_k:
            continue
        item = dict(r)
        item.pop("embedding", None)
        item["sparseScore"] = round(sparse, 4)
        item["denseScore"] = round(dense, 4) if q_vec else None
        item["hybridScore"] = round(hybrid, 4)
        scored.append(item)

    scored.sort(key=lambda x: (x["hybridScore"], x["startPage"] * -1), reverse=True)
    selected = scored[:top_k]

    duration_ms = int((time.monotonic() - started) * 1000)
    run_id = None
    if turn_id is not None:
        runs_t = tables["AgentRetrievalRun"]
        hits_t = tables["AgentRetrievalHit"]
        run_id = new_id()
        now = utcnow()
        await db.execute(
            runs_t.insert().values(
                id=run_id,
                turnId=turn_id,
                query=query,
                strategy="hybrid" if q_vec else "sparse",
                queryFilters={"patientId": patient_id},
                embeddingModel=emb_model,
                topK=top_k,
                candidateCount=len(rows),
                selectedCount=len(selected),
                status="COMPLETED",
                durationMs=duration_ms,
                createdAt=now,
            )
        )
        for rank, item in enumerate(selected, start=1):
            hit_id = new_id()
            item["retrievalHitId"] = hit_id
            await db.execute(
                hits_t.insert().values(
                    id=hit_id,
                    retrievalRunId=run_id,
                    chunkId=item["chunkId"],
                    chunkStableId=item["chunkStableId"],
                    versionStableId=item["versionId"],
                    sourceObjectIds=item["sourceObjectIds"],
                    sourceRefs=item["provenance"],
                    contentSha256=item["contentSha256"],
                    candidateRank=rank,
                    finalRank=rank,
                    denseScore=item["denseScore"],
                    sparseScore=item["sparseScore"],
                    hybridScore=item["hybridScore"],
                    rerankScore=item["hybridScore"],
                    includedInPrompt=True,
                    citedInAnswer=True,
                    authorizedAtRetrieval=True,
                    createdAt=now,
                )
            )

    return {
        "patientId": patient_id,
        "retrievalRunId": run_id,
        "candidateCount": len(rows),
        "hits": selected,
    }
