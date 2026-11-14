"""Validated hosted embeddings and pgvector indexing via search-sphere-rag."""

import hashlib
import logging
from typing import Any

from search_sphere_rag import (
    CohereEmbeddingProvider,
    EmbeddingProvider,
    EmbeddingSpace,
    EmbeddingSpaceMismatchError,
    GoogleEmbeddingProvider,
    compute_content_sha256,
    validate_vectors,
)
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncConnection

from app.core.config import get_settings
from app.infrastructure.database import new_id, tables, utcnow

logger = logging.getLogger(__name__)
PGVECTOR_DIMENSION = 384


def get_embedding_provider(
    required_space: EmbeddingSpace | None = None,
) -> EmbeddingProvider | None:
    """Return the configured hosted embedding provider without silent space mixing."""

    settings = get_settings()
    provider: EmbeddingProvider | None = None

    if settings.cohere_api_key:
        provider = CohereEmbeddingProvider(
            api_key=settings.cohere_api_key,
            model="embed-english-light-v3.0",
            version="v3.0",
            dimension=PGVECTOR_DIMENSION,
        )
    elif settings.google_api_key:
        provider = GoogleEmbeddingProvider(
            api_key=settings.google_api_key,
            model="gemini-embedding-001",
            version="v1",
            dimension=PGVECTOR_DIMENSION,
        )

    if provider is not None and required_space is not None:
        provider.space.assert_compatible(required_space)

    return provider


async def embed_texts(texts: list[str]) -> tuple[str, str, list[list[float]]] | None:
    """Embed document chunks using explicit document mode and strict validation."""

    if not texts:
        return ("none", "none", [])

    provider = get_embedding_provider()
    if provider is None:
        return None

    result = await provider.embed_documents(texts)
    vectors = validate_vectors(
        result.vectors,
        expected_count=len(texts),
        expected_dimension=provider.space.dimension,
    )
    return (provider.space.provider, provider.space.model, vectors)


async def embed_query(
    query: str,
    *,
    required_space: EmbeddingSpace | None = None,
) -> tuple[str, str, list[float]] | None:
    """Embed a single retrieval query in explicit query mode."""

    provider = get_embedding_provider(required_space=required_space)
    if provider is None:
        return None

    result = await provider.embed_query(query)
    vectors = validate_vectors(
        result.vectors,
        expected_count=1,
        expected_dimension=provider.space.dimension,
    )
    return (provider.space.provider, provider.space.model, vectors[0])


async def index_version_chunks(
    db: AsyncConnection,
    *,
    version_id: str,
) -> dict[str, Any]:
    """Generate and persist validated pgvector embeddings for a document version."""

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

    provider_name, model_name, vectors = embedded
    validate_vectors(vectors, expected_count=len(rows), expected_dimension=PGVECTOR_DIMENSION)

    existing_space_row = (
        await db.execute(
            select(
                emb_table.c.provider,
                emb_table.c.model,
                emb_table.c.embeddingVersion,
                emb_table.c.dimension,
            )
            .where(emb_table.c.status == "COMPLETED")
            .limit(1)
        )
    ).mappings().first()

    target_space = EmbeddingSpace(
        provider=provider_name,
        model=model_name,
        version="v3.0" if provider_name == "cohere" else "v1",
        dimension=PGVECTOR_DIMENSION,
    )
    generation = 1
    if existing_space_row is not None:
        existing_space = EmbeddingSpace(
            provider=existing_space_row["provider"],
            model=existing_space_row["model"],
            version=existing_space_row["embeddingVersion"],
            dimension=existing_space_row["dimension"],
        )
        try:
            target_space.assert_compatible(existing_space)
        except EmbeddingSpaceMismatchError:
            # New embedding provider/model starts a new controlled index generation
            generation = 2

    now = utcnow()
    for row, vec, text_input in zip(rows, vectors, texts, strict=True):
        input_hash = compute_content_sha256(text_input)
        vec_id = hashlib.sha256(
            f"{row['id']}:{provider_name}:{model_name}:{target_space.version}".encode("utf-8")
        ).hexdigest()[:32]
        await db.execute(
            emb_table.insert().values(
                id=new_id(),
                chunkId=row["id"],
                vectorId=vec_id,
                provider=provider_name,
                model=model_name,
                dimension=PGVECTOR_DIMENSION,
                embeddingVersion=target_space.version,
                indexGeneration=generation,
                inputSha256=row["contentSha256"] or input_hash,
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
    return {
        "indexed": len(rows),
        "status": "COMPLETED",
        "provider": provider_name,
        "model": model_name,
    }
