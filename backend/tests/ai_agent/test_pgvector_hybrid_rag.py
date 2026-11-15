"""Integration tests for pgvector hybrid RAG and reranking on real PostgreSQL."""

import pytest
from sqlalchemy import select

from app.core.config import get_settings
from app.features.ai_agent.persistence.threads import append_turn, create_or_get_thread
from app.features.ai_agent.rag.retrieval import retrieve_authorized_chunks
from app.features.documents.pipeline_runner import run_document_ingestion
from app.infrastructure.database import tables, utcnow

from .corpus_fixtures import make_lab_report_pdf, make_simple_text_pdf


@pytest.mark.integration
@pytest.mark.live
@pytest.mark.postgres
@pytest.mark.asyncio
async def test_real_pgvector_hybrid_rag_and_reranking(pg_engine):
    """Verify full hosted embeddings + pgvector + hybrid fusion + reranking + citations on PostgreSQL."""
    settings = get_settings()
    if not (settings.cohere_api_key or settings.google_api_key):
        pytest.skip("Hosted credentials unavailable for live pgvector hybrid RAG test (BLOCKED)")

    now = utcnow()
    pat_actor = {"id": "u_pg_rag_pat", "role": "PATIENT", "isActive": True}

    async with pg_engine.begin() as db:
        await db.execute(tables["Location"].insert().values(pincode=560001, city="Bengaluru", state="KA"))
        await db.execute(
            tables["User"].insert().values(
                id="u_pg_rag_pat",
                email="pgrag@example.com",
                phoneNo="9888888881",
                name="PG RAG Patient",
                password="hash",
                age=32,
                gender="FEMALE",
                role="PATIENT",
                address="Addr",
                pinCode=560001,
                isActive=True,
                createdAt=now,
                updatedAt=now,
            )
        )
        await db.execute(
            tables["Patient"].insert().values(
                id="pat_pg_rag",
                userId="u_pg_rag_pat",
                medicalHistory="None",
                allergies="None",
                currentMedications="None",
                createdAt=now,
                updatedAt=now,
            )
        )
        for doc_id, title, dtype in [
            ("doc_pg_lab", "Comprehensive Metabolic Panel", "LAB_REPORT"),
            ("doc_pg_note", "Outpatient Allergy Summary", "OTHER"),
        ]:
            await db.execute(
                tables["MedicalDocument"].insert().values(
                    id=doc_id,
                    patientId="pat_pg_rag",
                    title=title,
                    type=dtype,
                    fileName=f"{doc_id}.pdf",
                    mimeType="application/pdf",
                    fileSize=2048,
                    storagePath=f"local/pat_pg_rag/{doc_id}.pdf",
                    reportDate=now,
                    processingStatus="QUEUED",
                    createdAt=now,
                    updatedAt=now,
                )
            )

        lab_res = await run_document_ingestion(db, document_id="doc_pg_lab", data=make_lab_report_pdf())
        assert lab_res["status"] == "COMPLETED"
        note_res = await run_document_ingestion(db, document_id="doc_pg_note", data=make_simple_text_pdf())
        assert note_res["status"] == "COMPLETED"

        thread = await create_or_get_thread(db, actor=pat_actor, thread_id="t_pg_rag")
        turn = await append_turn(db, thread_id=thread["id"], original_query="What is my serum glucose?")

        rag_res = await retrieve_authorized_chunks(
            db,
            actor=pat_actor,
            query="What is my serum glucose?",
            turn_id=turn["id"],
            top_k=4,
        )
        assert len(rag_res["hits"]) >= 1
        top_chunk = rag_res["hits"][0]
        assert top_chunk["documentId"] == "doc_pg_lab"
        assert "94" in top_chunk["content"]
        assert top_chunk["chunkId"]
        assert top_chunk["provenance"]

        run_row = (
            await db.execute(
                select(tables["AgentRetrievalRun"]).where(tables["AgentRetrievalRun"].c.id == rag_res["retrievalRunId"])
            )
        ).mappings().first()
        assert run_row is not None
        assert run_row["status"] == "COMPLETED"
        assert run_row["embeddingModel"] is not None

        hits = (
            await db.execute(
                select(tables["AgentRetrievalHit"]).where(
                    tables["AgentRetrievalHit"].c.retrievalRunId == rag_res["retrievalRunId"]
                )
            )
        ).mappings().all()
        assert len(hits) == len(rag_res["hits"])
        assert hits[0]["chunkId"] == top_chunk["chunkId"]
