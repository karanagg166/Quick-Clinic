"""Shared authorized hybrid retrieval for Doctor and Patient AI agents."""

from typing import Any

from fastapi import HTTPException
from search_sphere_rag import CohereRerankProvider, HybridRagEngine
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncConnection

from app.core.config import get_settings
from app.features.doctors.agent_patient_queries import _authorize_patient, _resolve_doctor
from app.features.documents.embeddings import get_embedding_provider
from app.infrastructure.database import new_id, tables, utcnow

from .adapters import QuickClinicLexicalRetriever, QuickClinicVectorRetriever


async def resolve_authorized_patient_scope(
    db: AsyncConnection,
    *,
    actor: dict[str, Any],
    patient_id: str | None = None,
) -> str:
    """Resolve and authorize the target patient_id from the authenticated actor."""

    role = actor.get("role")
    if role == "DOCTOR":
        if not patient_id:
            raise HTTPException(400, "patient_id is required for doctor retrieval")
        doctor = await _resolve_doctor(db, actor)
        await _authorize_patient(db, actor, doctor["id"], patient_id)
        return patient_id

    if role == "PATIENT":
        patients = tables["Patient"]
        row = (
            await db.execute(select(patients.c.id).where(patients.c.userId == actor["id"]))
        ).first()
        if row is None:
            raise HTTPException(404, "Patient profile not found")
        resolved = str(row[0])
        if patient_id is not None and patient_id != resolved:
            raise HTTPException(403, "Patients may only access their own medical documents")
        return resolved

    raise HTTPException(403, "Medical document retrieval is not permitted for this role")


def get_reranker_provider():
    settings = get_settings()
    return (
        CohereRerankProvider(api_key=settings.cohere_api_key)
        if settings.cohere_api_key
        else None
    )


async def retrieve_authorized_chunks(
    db: AsyncConnection,
    *,
    actor: dict[str, Any],
    patient_id: str | None = None,
    query: str,
    turn_id: str | None = None,
    top_k: int = 6,
    document_ids: list[str] | None = None,
    document_type: str | None = None,
) -> dict[str, Any]:
    """Retrieve, fuse, and optionally rerank authorized chunks via search-sphere-rag."""

    resolved_patient_id = await resolve_authorized_patient_scope(
        db, actor=actor, patient_id=patient_id
    )

    embedding_provider = get_embedding_provider()
    reranker = get_reranker_provider()

    engine = HybridRagEngine(
        vector_retriever=QuickClinicVectorRetriever(db),
        lexical_retriever=QuickClinicLexicalRetriever(db),
        embedding_provider=embedding_provider,
        reranker=reranker,
        default_top_k=top_k,
    )

    scope: dict[str, Any] = {"patient_id": resolved_patient_id}
    if document_ids:
        scope["document_ids"] = document_ids
    if document_type:
        scope["document_type"] = document_type

    response = await engine.retrieve(query, scope=scope, top_k=top_k)

    selected: list[dict[str, Any]] = []
    for item in response.results:
        cand = item.candidate
        selected.append(
            {
                "chunkId": cand.chunk_id,
                "chunkStableId": cand.chunk_stable_id,
                "versionId": cand.document_version_id,
                "kind": cand.kind,
                "content": cand.content,
                "contentSha256": cand.content_sha256,
                "startPage": cand.start_page,
                "endPage": cand.end_page,
                "pageNumbers": cand.page_numbers or [cand.start_page],
                "sourceObjectIds": cand.source_object_ids,
                "provenance": cand.source_refs,
                "documentId": cand.document_id,
                "documentTitle": cand.document_title,
                "documentType": cand.document_type,
                "patientId": resolved_patient_id,
                "reviewRequired": cand.review_required,
                "denseScore": item.dense_score,
                "sparseScore": item.sparse_score,
                "hybridScore": item.hybrid_score,
                "rerankScore": item.rerank_score,
            }
        )

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
                strategy=response.strategy,
                queryFilters=scope,
                embeddingModel=(
                    response.embedding_space.model if response.embedding_space else None
                ),
                topK=top_k,
                candidateCount=response.candidate_count,
                selectedCount=len(selected),
                status="COMPLETED",
                durationMs=response.duration_ms,
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
                    rerankScore=item["rerankScore"],
                    includedInPrompt=True,
                    citedInAnswer=True,
                    authorizedAtRetrieval=True,
                    createdAt=now,
                )
            )

    return {
        "patientId": resolved_patient_id,
        "retrievalRunId": run_id,
        "candidateCount": response.candidate_count,
        "hits": selected,
    }
