"""Integration test suite for real hosted embeddings and pgvector validation."""

import pytest
from sqlalchemy import select, text

from app.core.config import get_settings
from app.features.documents.embeddings import (
    PGVECTOR_DIMENSION,
    embed_query,
    embed_texts,
    get_embedding_provider,
)
from app.infrastructure.database import new_id, tables, utcnow
from search_sphere_rag import EmbeddingSpace, EmbeddingSpaceMismatchError, validate_vectors


@pytest.mark.integration
@pytest.mark.live
@pytest.mark.asyncio
async def test_real_hosted_embeddings_document_and_query():
    """Verify live hosted embeddings produce valid 384-dim vectors with correct metadata."""
    settings = get_settings()
    if not (settings.cohere_api_key or settings.google_api_key):
        pytest.skip("No hosted embedding provider credentials configured (BLOCKED)")

    provider = get_embedding_provider()
    assert provider is not None
    assert provider.space.dimension == PGVECTOR_DIMENSION

    # Document mode embedding
    doc_texts = [
        "Patient presents with mild fever and sore throat. Vital signs are stable.",
        "Complete blood count indicates normal hemoglobin (14.2 g/dL) and platelets.",
    ]
    embedded = await embed_texts(doc_texts)
    assert embedded is not None
    provider_name, model_name, vectors = embedded

    assert provider_name in {"cohere", "google"}
    assert len(vectors) == 2
    for vec in vectors:
        assert len(vec) == PGVECTOR_DIMENSION
        assert all(isinstance(val, float) for val in vec)
        # Vector must be non-zero and non-trivial
        assert any(abs(val) > 1e-4 for val in vec)

    # Validate vector counts and dimensions
    validated = validate_vectors(vectors, expected_count=2, expected_dimension=PGVECTOR_DIMENSION)
    assert len(validated) == 2

    # Query mode embedding
    query_text = "What is the patient's hemoglobin level?"
    query_embedded = await embed_query(query_text)
    assert query_embedded is not None
    q_prov, q_model, q_vec = query_embedded

    assert q_prov == provider_name
    assert len(q_vec) == PGVECTOR_DIMENSION
    assert any(abs(val) > 1e-4 for val in q_vec)

    # Embedding space mismatch protection
    incompatible_space = EmbeddingSpace(
        provider="openai", model="text-embedding-3-small", version="v1", dimension=1536
    )
    with pytest.raises(EmbeddingSpaceMismatchError):
        provider.space.assert_compatible(incompatible_space)


@pytest.mark.integration
@pytest.mark.live
@pytest.mark.asyncio
async def test_pgvector_insertion_and_distance_query(db):
    """Verify vector insertion and distance/similarity querying against database."""
    settings = get_settings()
    if not (settings.cohere_api_key or settings.google_api_key):
        pytest.skip("Hosted credentials unavailable for live vector test (BLOCKED)")

    now = utcnow()
    emb_table = tables["MedicalChunkEmbedding"]
    chunks_table = tables["MedicalDocumentChunk"]
    versions_table = tables["MedicalDocumentVersion"]
    docs_table = tables["MedicalDocument"]
    users_table = tables["User"]
    patients_table = tables["Patient"]

    # Seed minimal patient and document record
    await db.execute(tables["Location"].insert().values(pincode=560001, city="Bengaluru", state="KA"))
    await db.execute(
        users_table.insert().values(
            id="u_live_vec",
            email="livevec@example.com",
            phoneNo="9888888888",
            name="Live Vec",
            password="hash",
            age=28,
            gender="MALE",
            role="PATIENT",
            address="Addr",
            pinCode=560001,
            isActive=True,
            createdAt=now,
            updatedAt=now,
        )
    )
    await db.execute(
        patients_table.insert().values(
            id="pat_live_vec",
            userId="u_live_vec",
            medicalHistory="None",
            allergies="None",
            currentMedications="None",
            createdAt=now,
            updatedAt=now,
        )
    )
    await db.execute(
        docs_table.insert().values(
            id="doc_live_vec",
            patientId="pat_live_vec",
            title="Cardiology Report",
            type="OTHER",
            fileName="cardio.pdf",
            mimeType="application/pdf",
            fileSize=512,
            storagePath="local/live_vec.pdf",
            reportDate=now,
            processingStatus="READY",
            createdAt=now,
            updatedAt=now,
        )
    )
    await db.execute(
        versions_table.insert().values(
            id="ver_live_vec",
            documentId="doc_live_vec",
            versionNumber=1,
            sourceSha256="sha256livevec",
            schemaVersion="1.0",
            pipelineVersion="search-sphere-ingest:0.3.0",
            configFingerprint="fp_live_vec",
            extractionStatus="COMPLETED",
            indexStatus="COMPLETED",
            isPublished=True,
            pageCount=1,
            objectCount=1,
            chunkCount=1,
            issueCount=0,
            createdAt=now,
            publishedAt=now,
        )
    )
    chunk_id = new_id()
    await db.execute(
        chunks_table.insert().values(
            id=chunk_id,
            versionId="ver_live_vec",
            chunkStableId="c_live_vec_1",
            chunkIndex=0,
            kind="text",
            content="Normal sinus rhythm with heart rate 72 bpm. Blood pressure 118/76 mmHg.",
            contentSha256="csha_live_vec",
            tokenCount=18,
            tokenizer="tiktoken",
            sourceObjectIds=[],
            provenance=[],
            pipelineVersion="search-sphere-ingest:0.3.0",
            pageNumbers=[1],
            startPage=1,
            endPage=1,
            status="COMPLETED",
            createdAt=now,
        )
    )

    embedded = await embed_texts(["Normal sinus rhythm with heart rate 72 bpm."])
    assert embedded is not None
    prov, mod, vecs = embedded

    # Insert into MedicalChunkEmbedding
    await db.execute(
        emb_table.insert().values(
            id=new_id(),
            chunkId=chunk_id,
            vectorId="vec_live_1",
            provider=prov,
            model=mod,
            dimension=PGVECTOR_DIMENSION,
            embeddingVersion="v3.0" if prov == "cohere" else "v1",
            indexGeneration=1,
            inputSha256="csha_live_vec",
            status="COMPLETED",
            embedding=vecs[0],
            indexedAt=now,
            createdAt=now,
        )
    )

    # Verify retrieval query
    retrieved = (
        await db.execute(select(emb_table).where(emb_table.c.chunkId == chunk_id))
    ).mappings().first()
    assert retrieved is not None
    assert retrieved["provider"] == prov
    assert retrieved["dimension"] == PGVECTOR_DIMENSION

    # If connected to PostgreSQL with pgvector, run vector distance operator query
    if db.dialect.name == "postgresql":
        raw_res = (
            await db.execute(
                text(
                    'SELECT "chunkId", "embedding" <=> CAST(:qvec AS vector) AS distance '
                    'FROM "MedicalChunkEmbedding" WHERE "chunkId" = :cid'
                ),
                {"qvec": str(vecs[0]), "cid": chunk_id},
            )
        ).mappings().first()
        assert raw_res is not None
        assert float(raw_res["distance"]) < 0.05
