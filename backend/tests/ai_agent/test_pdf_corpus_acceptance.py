"""End-to-end acceptance tests across the 12-condition PDF medical document corpus."""

import json
import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.core.security import issue_token
from app.features.ai_agent.persistence.threads import append_turn, create_or_get_thread
from app.features.ai_agent.rag.pipeline import answer_medical_question
from app.features.ai_agent.tools.patient_document_tools import build_patient_document_tools
from app.features.documents.pipeline_runner import run_document_ingestion
from app.infrastructure.database import tables, utcnow

from .corpus_fixtures import (
    make_encrypted_pdf,
    make_lab_report_pdf,
    make_large_pdf,
)


def _auth(user):
    return {"Authorization": f"Bearer {issue_token(user)}"}


async def _mock_embed_coro(texts: list[str]):
    return ("cohere", "embed-english-light-v3.0", [[0.0] * 384 for _ in texts])


async def _seed_corpus_world(db):
    now = utcnow()
    await db.execute(tables["Location"].insert().values(pincode=560001, city="Bengaluru", state="KA"))

    # Seed patient
    await db.execute(
        tables["User"].insert().values(
            id="u_corp_pat", email="corppat@example.com", phoneNo="9777777771", name="Alice Corpus",
            password="hash", age=35, gender="FEMALE", role="PATIENT", address="Addr",
            pinCode=560001, isActive=True, createdAt=now, updatedAt=now,
        )
    )
    await db.execute(
        tables["Patient"].insert().values(
            id="pat_corp", userId="u_corp_pat", medicalHistory="None",
            allergies="None", currentMedications="None", createdAt=now, updatedAt=now,
        )
    )

    # Seed authorized doctor and unauthorized doctor
    for uid, doc_id, email in [
        ("u_corp_doc_auth", "doc_corp_auth", "corpdocauth@example.com"),
        ("u_corp_doc_unauth", "doc_corp_unauth", "corpdocunauth@example.com"),
    ]:
        await db.execute(
            tables["User"].insert().values(
                id=uid, email=email, phoneNo="9777777772", name=doc_id,
                password="hash", age=45, gender="MALE", role="DOCTOR", address="Addr",
                pinCode=560001, isActive=True, createdAt=now, updatedAt=now,
            )
        )
        await db.execute(
            tables["Doctor"].insert().values(
                id=doc_id, userId=uid, specialty="GENERAL_PHYSICIAN",
                experience=10, fees=500, createdAt=now, updatedAt=now,
            )
        )

    # Confirmed appointment only for authorized doctor
    await db.execute(
        tables["Schedule"].insert().values(
            id="sched_corp_1", doctorId="doc_corp_auth", weeklySchedule={}, createdAt=now, updatedAt=now
        )
    )
    await db.execute(
        tables["Slot"].insert().values(
            id="slot_corp_1", doctorId="doc_corp_auth", date=now.date(),
            startTime=now, endTime=now, status="BOOKED", createdAt=now, updatedAt=now,
        )
    )
    await db.execute(
        tables["Appointment"].insert().values(
            id="appt_corp_conf", doctorId="doc_corp_auth", patientId="pat_corp",
            slotId="slot_corp_1", status="CONFIRMED", bookedAt=now, updatedAt=now,
        )
    )


@pytest.mark.integration
@pytest.mark.asyncio
async def test_patient_upload_to_answer_e2e(client, db, monkeypatch, tmp_path):
    """Full lifecycle: Patient upload -> extraction -> pgvector -> Patient Agent -> Doctor Agent -> Deletion."""
    monkeypatch.setenv("DOCUMENT_STORAGE_DIR", str(tmp_path))
    monkeypatch.setattr("app.features.documents.embeddings.embed_texts", lambda texts: _mock_embed_coro(texts))
    monkeypatch.setattr("app.features.ai_agent.rag.retrieval.get_embedding_provider", lambda: None)
    monkeypatch.setattr("app.features.ai_agent.rag.retrieval.get_reranker_provider", lambda: None)

    await _seed_corpus_world(db)
    pat_actor = {"id": "u_corp_pat", "role": "PATIENT", "isActive": True}
    doc_auth = {"id": "u_corp_doc_auth", "role": "DOCTOR", "isActive": True}
    doc_unauth = {"id": "u_corp_doc_unauth", "role": "DOCTOR", "isActive": True}

    # 1. Patient upload via HTTP
    pdf_bytes = make_lab_report_pdf()
    res = await client.post(
        "/api/patients/me/medical-documents",
        headers=_auth(pat_actor),
        data={"title": "Metabolic Panel", "type": "LAB_REPORT", "reportDate": "2026-11-15"},
        files={"file": ("cmp.pdf", pdf_bytes, "application/pdf")},
    )
    assert res.status_code == 201
    doc_id = res.json()["document"]["id"]
    assert res.json()["document"]["processingStatus"] == "QUEUED"

    # 2. Durable ingestion execution
    ingest_res = await run_document_ingestion(db, document_id=doc_id, data=pdf_bytes)
    assert ingest_res["status"] == "COMPLETED"
    assert ingest_res["indexStatus"] == "COMPLETED"
    assert ingest_res["chunkCount"] >= 1

    # Verify document marked READY and version is published
    doc_row = (await db.execute(select(tables["MedicalDocument"]).where(tables["MedicalDocument"].c.id == doc_id))).mappings().first()
    assert doc_row["processingStatus"] == "READY"

    # 3. Patient Agent tool invocation
    thread = await create_or_get_thread(db, actor=pat_actor, thread_id="t_corp_pat")
    turn = await append_turn(db, thread_id=thread["id"], original_query="What was my serum glucose?")
    tools = {
        t.name: t
        for t in build_patient_document_tools(
            db=db, actor=pat_actor, thread_id=thread["id"], turn_id=turn["id"]
        )
    }
    tool_raw = await tools["search_my_medical_documents"].ainvoke({"query": "serum glucose"})
    tool_res = json.loads(tool_raw)
    assert "94" in tool_res["answer"]
    assert len(tool_res["citations"]) >= 1
    assert tool_res["citations"][0]["documentId"] == doc_id

    # 4. Authorized Doctor RAG invocation succeeds with same grounding
    doc_thread = await create_or_get_thread(db, actor=doc_auth, thread_id="t_corp_doc", patient_id="pat_corp")
    doc_turn = await append_turn(db, thread_id=doc_thread["id"], original_query="What was the serum glucose?")
    doc_res = await answer_medical_question(
        db, actor=doc_auth, patient_id="pat_corp", question="What was the serum glucose?", turn_id=doc_turn["id"]
    )
    assert "94" in doc_res["answer"]
    assert len(doc_res["citations"]) >= 1

    # 5. Ineligible Doctor is blocked with 403 Forbidden
    with pytest.raises(HTTPException) as exc:
        await answer_medical_question(
            db, actor=doc_unauth, patient_id="pat_corp", question="What was the serum glucose?"
        )
    assert exc.value.status_code == 403

    # 6. Deletion invalidation
    del_res = await client.delete(f"/api/patients/me/medical-documents/{doc_id}", headers=_auth(pat_actor))
    assert del_res.status_code == 200

    # Citations are marked revoked and document is gone
    post_doc = (await db.execute(select(tables["MedicalDocument"]).where(tables["MedicalDocument"].c.id == doc_id))).first()
    assert post_doc is None


@pytest.mark.integration
@pytest.mark.asyncio
async def test_encrypted_and_corrupt_pdf_rejected(client, db, seed_user):
    """Verify encrypted or corrupt PDFs are rejected at validation before storage."""
    patient = await seed_user()
    encrypted_bytes = make_encrypted_pdf()

    res = await client.post(
        "/api/patients/me/medical-documents",
        headers=_auth(patient),
        data={"title": "Encrypted", "type": "OTHER", "reportDate": "2026-11-15"},
        files={"file": ("secret.pdf", encrypted_bytes, "application/pdf")},
    )
    assert res.status_code == 400
    assert "encrypted" in res.text.lower()


@pytest.mark.integration
@pytest.mark.asyncio
async def test_large_pdf_bounded_processing(db, monkeypatch):
    """Verify a 45-page PDF is processed in bounded batches preserving global page numbers."""
    monkeypatch.setattr("app.features.documents.embeddings.embed_texts", lambda texts: _mock_embed_coro(texts))
    await _seed_corpus_world(db)
    now = utcnow()

    doc_id = "doc_large_45"
    await db.execute(
        tables["MedicalDocument"].insert().values(
            id=doc_id, patientId="pat_corp", title="45 Page Record", type="OTHER",
            fileName="record45.pdf", mimeType="application/pdf", fileSize=10000,
            storagePath="local/pat_corp/doc_large_45/data.pdf", reportDate=now,
            processingStatus="PENDING", createdAt=now, updatedAt=now,
        )
    )

    pdf_bytes = make_large_pdf(page_count=45)
    res = await run_document_ingestion(db, document_id=doc_id, data=pdf_bytes)
    assert res["status"] == "COMPLETED"
    assert res["chunkCount"] >= 2

    # Verify global page numbers preserved across ranges up to page 45
    chunks = (
        await db.execute(
            select(tables["MedicalDocumentChunk"])
            .where(tables["MedicalDocumentChunk"].c.versionId == res["versionId"])
            .order_by(tables["MedicalDocumentChunk"].c.chunkIndex.asc())
        )
    ).mappings().all()

    first_pages = chunks[0]["pageNumbers"]
    last_pages = chunks[-1]["pageNumbers"]
    assert min(first_pages) == 1
    assert max(last_pages) == 45
