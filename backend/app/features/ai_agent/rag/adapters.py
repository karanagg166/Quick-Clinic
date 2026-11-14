"""PostgreSQL pgvector & tsvector retrieval adapters for search-sphere-rag."""

import math
import re
from collections.abc import Mapping, Sequence
from typing import Any

from search_sphere_rag import EmbeddingSpace, RetrievalCandidate
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncConnection

from app.infrastructure.database import tables


def _tokenize(value: str) -> set[str]:
    return {tok for tok in re.findall(r"[a-z0-9]+", value.casefold()) if len(tok) > 1}


def _cosine_sim(a: Sequence[float], b: Sequence[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = sum(float(x) * float(y) for x, y in zip(a, b, strict=True))
    na = math.sqrt(sum(float(x) * float(x) for x in a))
    nb = math.sqrt(sum(float(y) * float(y) for y in b))
    if na == 0.0 or nb == 0.0:
        return 0.0
    return max(0.0, dot / (na * nb))


def _row_to_candidate(row: Mapping[str, Any], *, score: float, rank: int) -> RetrievalCandidate:
    start_page = int(row.get("startPage") or 1)
    end_page = int(row.get("endPage") or start_page)
    pages = list(range(start_page, end_page + 1))
    source_refs = row.get("provenance")
    return RetrievalCandidate(
        chunk_id=str(row["chunkId"]),
        chunk_stable_id=row.get("chunkStableId"),
        document_id=str(row["documentId"]),
        document_version_id=row.get("versionId"),
        document_title=str(row.get("documentTitle") or "Medical Document"),
        document_type=row.get("documentType"),
        content=str(row.get("content") or ""),
        content_sha256=row.get("contentSha256"),
        kind=str(row.get("kind") or "text"),
        start_page=start_page,
        end_page=end_page,
        page_numbers=pages,
        source_object_ids=list(row.get("sourceObjectIds") or []),
        source_refs=list(source_refs) if isinstance(source_refs, list) else [],
        score=round(float(score), 6),
        rank=rank,
        review_required=bool(row.get("reviewRequired", False)),
    )


class QuickClinicVectorRetriever:
    """Authorized pgvector dense retriever scoped in SQL before ranking."""

    def __init__(self, db: AsyncConnection) -> None:
        self.db = db

    async def search_dense(
        self,
        query_vector: Sequence[float],
        *,
        space: EmbeddingSpace,
        scope: Mapping[str, Any],
        limit: int,
    ) -> list[RetrievalCandidate]:
        patient_id = str(scope["patient_id"])
        document_ids = [str(d) for d in (scope.get("document_ids") or []) if str(d).strip()]
        document_type = scope.get("document_type")

        if self.db.dialect.name == "postgresql":
            qvec_literal = "[" + ",".join(f"{float(v):.8f}" for v in query_vector) + "]"
            clauses = [
                'd."patientId" = :patient_id',
                'v."isPublished" = TRUE',
                'v."revokedAt" IS NULL',
                'e."status" = \'COMPLETED\'',
                'e."provider" = :provider',
                'e."model" = :model',
                'e."embeddingVersion" = :emb_version',
                'e."dimension" = :dimension',
            ]
            params: dict[str, Any] = {
                "patient_id": patient_id,
                "provider": space.provider,
                "model": space.model,
                "emb_version": space.version,
                "dimension": space.dimension,
                "qvec": qvec_literal,
                "limit": limit,
            }
            if document_ids:
                clauses.append('d."id" = ANY(:doc_ids)')
                params["doc_ids"] = document_ids
            if document_type:
                clauses.append('d."type" = :doc_type')
                params["doc_type"] = str(document_type)

            sql = text(
                f"""
                SELECT
                    c."id" AS "chunkId", c."chunkStableId", c."versionId", c."kind",
                    c."content", c."contentSha256", c."startPage", c."endPage",
                    c."sourceObjectIds", c."provenance",
                    d."id" AS "documentId", d."title" AS "documentTitle", d."type" AS "documentType",
                    1.0 - (e."embedding" <=> CAST(:qvec AS vector)) AS score
                FROM "MedicalChunkEmbedding" e
                JOIN "MedicalDocumentChunk" c ON c."id" = e."chunkId"
                JOIN "MedicalDocumentVersion" v ON v."id" = c."versionId"
                JOIN "MedicalDocument" d ON d."id" = v."documentId"
                WHERE {" AND ".join(clauses)}
                ORDER BY e."embedding" <=> CAST(:qvec AS vector) ASC
                LIMIT :limit
                """
            )
            rows = (await self.db.execute(sql, params)).mappings().all()
            return [_row_to_candidate(r, score=max(0.0, float(r["score"] or 0.0)), rank=i) for i, r in enumerate(rows, 1)]

        # SQLite fallback for isolated unit/feature tests
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
                emb_t.c.embedding,
            )
            .select_from(
                emb_t.join(chunks_t, chunks_t.c.id == emb_t.c.chunkId)
                .join(versions_t, versions_t.c.id == chunks_t.c.versionId)
                .join(docs_t, docs_t.c.id == versions_t.c.documentId)
            )
            .where(
                docs_t.c.patientId == patient_id,
                versions_t.c.isPublished.is_(True),
                versions_t.c.revokedAt.is_(None),
                emb_t.c.status == "COMPLETED",
                emb_t.c.provider == space.provider,
                emb_t.c.model == space.model,
                emb_t.c.embeddingVersion == space.version,
                emb_t.c.dimension == space.dimension,
            )
            .limit(200)
        )
        if document_ids:
            stmt = stmt.where(docs_t.c.id.in_(document_ids))
        if document_type:
            stmt = stmt.where(docs_t.c.type == str(document_type))
        rows = (await self.db.execute(stmt)).mappings().all()
        scored = [
            (_cosine_sim(query_vector, r["embedding"]), r)
            for r in rows
            if r.get("embedding")
        ]
        scored.sort(key=lambda pair: -pair[0])
        return [_row_to_candidate(r, score=score, rank=i) for i, (score, r) in enumerate(scored[:limit], 1)]


class QuickClinicLexicalRetriever:
    """Authorized PostgreSQL tsvector / SQLite token lexical retriever."""

    def __init__(self, db: AsyncConnection) -> None:
        self.db = db

    async def search_lexical(
        self,
        query: str,
        *,
        scope: Mapping[str, Any],
        limit: int,
    ) -> list[RetrievalCandidate]:
        patient_id = str(scope["patient_id"])
        document_ids = [str(d) for d in (scope.get("document_ids") or []) if str(d).strip()]
        document_type = scope.get("document_type")

        if self.db.dialect.name == "postgresql":
            clauses = [
                'd."patientId" = :patient_id',
                'v."isPublished" = TRUE',
                'v."revokedAt" IS NULL',
                "to_tsvector('english', c.\"content\") @@ plainto_tsquery('english', :query)",
            ]
            params: dict[str, Any] = {"patient_id": patient_id, "query": query, "limit": limit}
            if document_ids:
                clauses.append('d."id" = ANY(:doc_ids)')
                params["doc_ids"] = document_ids
            if document_type:
                clauses.append('d."type" = :doc_type')
                params["doc_type"] = str(document_type)

            sql = text(
                f"""
                SELECT
                    c."id" AS "chunkId", c."chunkStableId", c."versionId", c."kind",
                    c."content", c."contentSha256", c."startPage", c."endPage",
                    c."sourceObjectIds", c."provenance",
                    d."id" AS "documentId", d."title" AS "documentTitle", d."type" AS "documentType",
                    ts_rank_cd(to_tsvector('english', c."content"), plainto_tsquery('english', :query)) AS score
                FROM "MedicalDocumentChunk" c
                JOIN "MedicalDocumentVersion" v ON v."id" = c."versionId"
                JOIN "MedicalDocument" d ON d."id" = v."documentId"
                WHERE {" AND ".join(clauses)}
                ORDER BY score DESC, c."startPage" ASC
                LIMIT :limit
                """
            )
            rows = (await self.db.execute(sql, params)).mappings().all()
            if rows:
                return [_row_to_candidate(r, score=float(r["score"] or 0.0), rank=i) for i, r in enumerate(rows, 1)]

        # SQLite / exact-token fallback
        chunks_t = tables["MedicalDocumentChunk"]
        versions_t = tables["MedicalDocumentVersion"]
        docs_t = tables["MedicalDocument"]
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
            )
            .select_from(
                chunks_t.join(versions_t, versions_t.c.id == chunks_t.c.versionId).join(
                    docs_t, docs_t.c.id == versions_t.c.documentId
                )
            )
            .where(
                docs_t.c.patientId == patient_id,
                versions_t.c.isPublished.is_(True),
                versions_t.c.revokedAt.is_(None),
            )
            .limit(200)
        )
        if document_ids:
            stmt = stmt.where(docs_t.c.id.in_(document_ids))
        if document_type:
            stmt = stmt.where(docs_t.c.type == str(document_type))

        rows = (await self.db.execute(stmt)).mappings().all()
        q_tokens = _tokenize(query)
        scored: list[tuple[float, Mapping[str, Any]]] = []
        for r in rows:
            doc_tokens = _tokenize(str(r["content"]))
            if not q_tokens or not doc_tokens:
                continue
            overlap = len(q_tokens & doc_tokens) / max(1, len(q_tokens))
            if overlap > 0:
                scored.append((overlap, r))
        scored.sort(key=lambda pair: (-pair[0], int(pair[1]["startPage"] or 1)))
        return [_row_to_candidate(r, score=score, rank=i) for i, (score, r) in enumerate(scored[:limit], 1)]
