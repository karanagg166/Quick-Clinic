"""Tests for Search Sphere ingestion, medical RAG retrieval, citations, and revocation."""

import fitz
import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.features.ai_agent.rag.pipeline import answer_medical_question, persist_message_citations
from app.features.ai_agent.persistence.threads import append_message, append_turn, create_or_get_thread
from app.features.documents.cleanup import invalidate_document_evidence
from app.features.documents.pipeline_runner import run_document_ingestion
from app.infrastructure.database import tables, utcnow


def _make_lab_pdf(text: str) -> bytes:
    doc = fitz.open()
    page = doc.new_page()
    page.insert_text((72, 72), text, fontsize=12)
    return doc.tobytes()


async def _seed_clinical_context(db):
    now = utcnow()
    await db.execute(tables["Location"].insert().values(pincode=560001, city="Bengaluru", state="KA"))
    for uid, role, email in [
        ("u_doc_rag", "DOCTOR", "docrag@example.com"),
        ("u_pat_rag", "PATIENT", "patrag@example.com"),
        ("u_doc_unauth", "DOCTOR", "docunauth@example.com"),
    ]:
        await db.execute(
            tables["User"].insert().values(
                id=uid,
                email=email,
                phoneNo="9999999999",
                name=uid,
                password="hash",
                age=30,
                gender="MALE",
                role=role,
                address="Addr",
                pinCode=560001,
                isActive=True,
                createdAt=now,
                updatedAt=now,
            )
        )
    await db.execute(
        tables["Doctor"].insert().values(
            id="doc_rag", userId="u_doc_rag", specialty="GENERAL_PHYSICIAN", experience=4, fees=400, createdAt=now, updatedAt=now
        )
    )
    await db.execute(
        tables["Doctor"].insert().values(
            id="doc_unauth", userId="u_doc_unauth", specialty="GENERAL_PHYSICIAN", experience=2, fees=300, createdAt=now, updatedAt=now
        )
    )
    await db.execute(
        tables["Patient"].insert().values(
            id="pat_rag", userId="u_pat_rag", medicalHistory="None", allergies="None", currentMedications="None", createdAt=now, updatedAt=now
        )
    )
    await db.execute(
        tables["Schedule"].insert().values(
            id="sched_rag", doctorId="doc_rag", weeklySchedule={}, createdAt=now, updatedAt=now
        )
    )
    await db.execute(
        tables["Slot"].insert().values(
            id="slot_rag",
            doctorId="doc_rag",
            date=now.date(),
            startTime=now,
            endTime=now,
            status="BOOKED",
            createdAt=now,
            updatedAt=now,
        )
    )
    await db.execute(
        tables["Appointment"].insert().values(
            id="appt_rag",
            doctorId="doc_rag",
            patientId="pat_rag",
            slotId="slot_rag",
            status="CONFIRMED",
            bookedAt=now,
            updatedAt=now,
        )
    )
    await db.execute(
        tables["MedicalDocument"].insert().values(
            id="doc_lab_1",
            patientId="pat_rag",
            title="CBC Lab Report",
            type="LAB_REPORT",
            fileName="cbc.pdf",
            mimeType="application/pdf",
            fileSize=1024,
            storagePath="pat_rag/doc_lab_1.pdf",
            reportDate=now,
            processingStatus="PENDING",
            createdAt=now,
            updatedAt=now,
        )
    )


@pytest.mark.integration
@pytest.mark.asyncio
async def test_search_sphere_ingestion_rag_citations_and_revocation(db, monkeypatch):
    await _seed_clinical_context(db)
    pdf_bytes = _make_lab_pdf("Complete Blood Count\nHemoglobin: 13.8 g/dL (Reference 13.0-17.0)")

    # Mock hosted embedding provider without network calls
    monkeypatch.setattr("app.features.documents.embeddings.embed_texts", lambda texts: _mock_embed_coro(texts))
    monkeypatch.setattr("app.features.ai_agent.rag.retrieval.get_embedding_provider", lambda: None)
    monkeypatch.setattr("app.features.ai_agent.rag.retrieval.get_reranker_provider", lambda: None)

    ingest_res = await run_document_ingestion(db, document_id="doc_lab_1", data=pdf_bytes)
    assert ingest_res["status"] in {"COMPLETED", "PARTIAL"}
    assert ingest_res["chunkCount"] >= 1

    doc_actor = {"id": "u_doc_rag", "role": "DOCTOR", "isActive": True}
    unauth_actor = {"id": "u_doc_unauth", "role": "DOCTOR", "isActive": True}

    # Unauthorized doctor is blocked
    with pytest.raises(HTTPException) as exc:
        await answer_medical_question(
            db, actor=unauth_actor, patient_id="pat_rag", question="What is the hemoglobin level?"
        )
    assert exc.value.status_code == 403

    thread = await create_or_get_thread(db, actor=doc_actor, thread_id="thread_rag_1", patient_id="pat_rag")
    turn = await append_turn(db, thread_id=thread["id"], original_query="What is the hemoglobin level?")
    rag_res = await answer_medical_question(
        db,
        actor=doc_actor,
        patient_id="pat_rag",
        question="What is the hemoglobin level?",
        turn_id=turn["id"],
    )
    assert "13.8" in rag_res["answer"]
    assert len(rag_res["citations"]) >= 1
    assert rag_res["retrievalRunId"] is not None

    msg = await append_message(
        db, thread_id=thread["id"], turn_id=turn["id"], role="ASSISTANT", content=rag_res["answer"]
    )
    await persist_message_citations(db, message_id=msg["id"], citations=rag_res["citations"])

    # Deleting/revoking document invalidates citations and prevents further retrieval
    await invalidate_document_evidence(db, document_id="doc_lab_1", reason="DOCUMENT_DELETED")
    revoked_cits = (
        await db.execute(
            select(tables["AgentMessageCitation"]).where(tables["AgentMessageCitation"].c.messageId == msg["id"])
        )
    ).mappings().all()
    assert all(c["revokedAt"] is not None for c in revoked_cits)

    after_revoke = await answer_medical_question(
        db, actor=doc_actor, patient_id="pat_rag", question="What is the hemoglobin level?"
    )
    assert after_revoke["citations"] == []


async def _mock_embed_coro(texts: list[str]):
    return ("cohere", "embed-english-light-v3.0", [[0.0] * 384 for _ in texts])

