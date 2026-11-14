"""Free-tier friendly embedding and pgvector indexing for medical chunks."""

import hashlib
import logging
from typing import Any

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncConnection

from app.core.config import get_settings
from app.infrastructure.database import new_id, tables, utcnow

logger = logging.getLogger(__name__)
EMBEDDING_DIM = 384


def _normalize_dim(vec: list[float], dim: int = EMBEDDING_DIM) -> list[float]:
    if len(vec) == dim:
        return [float(x) for x in vec]
    if len(vec) > dim:
        return [float(x) for x in vec[:dim]]
    return [float(x) for x in vec] + [0.0] * (dim - len(vec))


async def embed_texts(texts: list[str]) -> tuple[str, str, list[list[float]]] | None:
    """Embed texts using configured hosted provider (Gemini or Cohere).

    Returns (provider, model, vectors) or None if no embedding provider is available.
    """

    if not texts:
        return ("none", "none", [])

    settings = get_settings()

    if settings.google_api_key:
        try:
            from langchain_google_genai import GoogleGenerativeAIEmbeddings

            client = GoogleGenerativeAIEmbeddings(
                model="models/text-embedding-004",
                google_api_key=settings.google_api_key,
            )
            raw = await client.aembed_documents(texts, output_dimensionality=EMBEDDING_DIM)
            return ("google", "text-embedding-004", [_normalize_dim(v) for v in raw])
        except Exception as exc:
            logger.warning("Google embedding failed: %s", type(exc).__name__)

    if settings.cohere_api_key:
        try:
            from langchain_cohere import CohereEmbeddings

            client = CohereEmbeddings(
                model="embed-english-light-v3.0",
                cohere_api_key=settings.cohere_api_key,
            )
            raw = await client.aembed_documents(texts)
            return ("cohere", "embed-english-light-v3.0", [_normalize_dim(v) for v in raw])
        except Exception as exc:
            logger.warning("Cohere embedding failed: %s", type(exc).__name__)

    return None


async def embed_query(query: str) -> tuple[str, str, list[float]] | None:
    """Embed a single retrieval query."""

    res = await embed_texts([query])
    if res is None or not res[2]:
        return None
    provider, model, vecs = res
    return (provider, model, vecs[0])


async def index_version_chunks(
    db: AsyncConnection,
    *,
    version_id: str,
) -> dict[str, Any]:
    """Generate and persist 384-dim pgvector embeddings for a document version."""

    chunks_table = tables["MedicalDocumentChunk"]
    emb_table = tables["MedicalChunkEmbedding"]
    versions_table = tables["MedicalDocumentVersion"]

    rows = (
        await db.execute(
            select(chunks_table)
            .where(chunks_table.c.versionId == version_id)
            .order_by(chunks_table.c.chunkIndex.asc())
        )
    ).mappings().all()

    if not rows:
        await db.execute(
            update(versions_table)
            .where(versions_table.c.id == version_id)
            .values(indexStatus="COMPLETED")
        )
        return {"indexed": 0, "status": "COMPLETED"}

    texts = [str(r["content"])[:4000] for r in rows]
    embedded = await embed_texts(texts)
    if embedded is None:
        await db.execute(
            update(versions_table)
            .where(versions_table.c.id == version_id)
            .values(indexStatus="RETRYABLE")
        )
        return {"indexed": 0, "status": "RETRYABLE"}

    provider, model, vectors = embedded
    now = utcnow()
    for row, vec in zip(rows, vectors, strict=True):
        vec_id = hashlib.sha256(f"{row['id']}:{model}:v1".encode("utf-8")).hexdigest()[:32]
        await db.execute(
            emb_table.insert().values(
                id=new_id(),
                chunkId=row["id"],
                vectorId=vec_id,
                provider=provider,
                model=model,
                dimension=EMBEDDING_DIM,
                embeddingVersion="v1",
                indexGeneration=1,
                inputSha256=row["contentSha256"],
                status="COMPLETED",
                embedding=vec,
                indexedAt=now,
                createdAt=now,
            )
        )

    await db.execute(
        update(versions_table)
        .where(versions_table.c.id == version_id)
        .values(indexStatus="COMPLETED")
    )
    return {"indexed": len(rows), "status": "COMPLETED", "provider": provider, "model": model}
