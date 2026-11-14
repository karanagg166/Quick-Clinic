"""Integration and security tests for the Patient AI Agent and shared Search Sphere RAG."""

import json
from datetime import timedelta

import fitz
import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.features.ai_agent.approval_resume import decide_and_resume_approval
from app.features.ai_agent.graph.workflow import build_workflow
from app.features.ai_agent.persistence.approvals import create_or_get_approval
from app.features.ai_agent.persistence.threads import append_turn, create_or_get_thread
from app.features.ai_agent.rag.retrieval import resolve_authorized_patient_scope
from app.features.ai_agent.tools.patient import build_patient_tools
from app.features.documents.cleanup import invalidate_document_evidence
from app.features.documents.pipeline_runner import run_document_ingestion
from app.infrastructure.database import tables, utcnow


def _make_pdf(text: str) -> bytes:
    doc = fitz.open()
    page = doc.new_page()
    page.insert_text((72, 72), text, fontsize=12)
    return doc.tobytes()


async def _seed_patient_world(db):
    now = utcnow()
    await db.execute(tables["Location"].insert().values(pincode=560001, city="Bengaluru", state="KA"))
    for uid, role, email in [
        ("u_pat_1", "PATIENT", "pat1@example.com"),
        ("u_pat_2", "PATIENT", "pat2@example.com"),
        ("u_doc_1", "DOCTOR", "doc1@example.com"),
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
        tables["Patient"].insert().values(
            id="pat_1", userId="u_pat_1", medicalHistory="Asthma", allergies="Dust", currentMedications="Inhaler", createdAt=now, updatedAt=now
        )
    )
    await db.execute(
        tables["Patient"].insert().values(
            id="pat_2", userId="u_pat_2", medicalHistory="None", allergies="None", currentMedications="None", createdAt=now, updatedAt=now
        )
    )
    await db.execute(
        tables["Doctor"].insert().values(
            id="doc_1", userId="u_doc_1", specialty="CARDIOLOGIST", experience=8, fees=700, createdAt=now, updatedAt=now
        )
    )
    await db.execute(
        tables["Slot"].insert().values(
            id="slot_avail_1",
            doctorId="doc_1",
            date=(now + timedelta(hours=2)).date(),
            startTime=now + timedelta(hours=2),
            endTime=now + timedelta(hours=2, minutes=30),
            status="AVAILABLE",
            createdAt=now,
            updatedAt=now,
        )
    )
    await db.execute(
        tables["MedicalDocument"].insert().values(
            id="doc_pat1_cbc",
            patientId="pat_1",
            title="Lipid Profile",
            type="LAB_REPORT",
            fileName="lipid.pdf",
            mimeType="application/pdf",
            fileSize=512,
            storagePath="local/pat_1/doc_pat1_cbc/abc",
            reportDate=now,
            processingStatus="READY",
            createdAt=now,
            updatedAt=now,
        )
    )
    await db.execute(
        tables["MedicalDocument"].insert().values(
            id="doc_pat2_secret",
            patientId="pat_2",
            title="Private Report",
            type="LAB_REPORT",
            fileName="secret.pdf",
            mimeType="application/pdf",
            fileSize=512,
            storagePath="local/pat_2/doc_pat2_secret/xyz",
            reportDate=now,
            processingStatus="READY",
            createdAt=now,
            updatedAt=now,
        )
    )


async def _none_coro():
    return None


@pytest.mark.integration
@pytest.mark.asyncio
async def test_patient_agent_rag_discovery_and_isolation(db, monkeypatch):
    await _seed_patient_world(db)
    monkeypatch.setattr("app.features.documents.embeddings.embed_texts", lambda texts: _none_coro())
    monkeypatch.setattr("app.features.ai_agent.rag.retrieval.get_embedding_provider", lambda: None)
    monkeypatch.setattr("app.features.ai_agent.rag.retrieval.get_reranker_provider", lambda: None)

    await run_document_ingestion(db, document_id="doc_pat1_cbc", data=_make_pdf("LDL Cholesterol: 112 mg/dL"))
    await run_document_ingestion(db, document_id="doc_pat2_secret", data=_make_pdf("Troponin: 9.9 ng/mL"))

    pat1_actor = {"id": "u_pat_1", "role": "PATIENT", "isActive": True}
    thread = await create_or_get_thread(db, actor=pat1_actor, thread_id="t_pat_1")
    turn = await append_turn(db, thread_id=thread["id"], original_query="What is my LDL?")

    tools = {
        t.name: t
        for t in build_patient_tools(
            db=db, actor=pat1_actor, reference_date=utcnow().date(), thread_id=thread["id"], turn_id=turn["id"]
        )
    }

    # Patient RAG retrieves own document only
    rag_json = json.loads(await tools["search_my_medical_documents"].ainvoke({"query": "LDL Cholesterol"}))
    assert "112" in rag_json["answer"]
    assert "9.9" not in rag_json["answer"]
    assert rag_json["retrieval_run_id"] is not None
    assert len(rag_json["citations"]) >= 1

    # Patient cannot pass another patient_id to scope resolver
    with pytest.raises(HTTPException) as exc:
        await resolve_authorized_patient_scope(db, actor=pat1_actor, patient_id="pat_2")
    assert exc.value.status_code == 403

    # Patient cannot access doctor-only tools in workflow
    from app.features.ai_agent.tools.doctor import build_doctor_tools

    doc_tools = build_doctor_tools(db=db, actor={"id": "u_doc_1", "role": "DOCTOR", "isActive": True}, reference_date=utcnow().date())
    from langchain_core.language_models.fake_chat_models import FakeListChatModel

    with pytest.raises(PermissionError):
        build_workflow(FakeListChatModel(responses=["ok"]), tools=doc_tools, role="PATIENT")

    # Discovery & document status tools work
    docs_res = json.loads(await tools["search_doctors"].ainvoke({"specialty": "CARDIOLOGIST"}))
    assert len(docs_res) == 1
    status_res = json.loads(await tools["get_document_processing_status"].ainvoke({"document_id": "doc_pat1_cbc"}))
    assert status_res["version"]["extractionStatus"] in {"COMPLETED", "PARTIAL"}

    # Revoking document blocks further retrieval
    await invalidate_document_evidence(db, document_id="doc_pat1_cbc")
    rag_after = json.loads(await tools["search_my_medical_documents"].ainvoke({"query": "LDL Cholesterol"}))
    assert rag_after["chunks"] == []


@pytest.mark.integration
@pytest.mark.asyncio
async def test_patient_hitl_booking_hold_handoff(db):
    await _seed_patient_world(db)
    pat1_actor = {"id": "u_pat_1", "role": "PATIENT", "isActive": True}
    thread = await create_or_get_thread(db, actor=pat1_actor, thread_id="t_pat_hitl")

    approval = await create_or_get_approval(
        db,
        actor=pat1_actor,
        thread_id=thread["id"],
        tool_call_id="call_book_1",
        action_type="PROPOSE_BOOKING",
        risk_level="MEDIUM_HUMAN_APPROVAL",
        parameters={"doctor_id": "doc_1", "slot_id": "slot_avail_1"},
        title="Hold Slot for Booking",
        summary="Hold slot_avail_1 with doc_1",
        reason="Patient requested booking",
        idempotency_key="hitl_t_pat_hitl_call_book_1",
    )

    from langchain_core.language_models.fake_chat_models import FakeListChatModel

    res = await decide_and_resume_approval(
        model=FakeListChatModel(responses=["ok"]),
        db=db,
        actor=pat1_actor,
        thread_id=thread["id"],
        approval_id=approval["id"],
        decision="APPROVED",
    )
    assert res["approval"]["status"] == "APPROVED"
    assert res["approval"]["executionStatus"] == "COMPLETED"

    slot_row = (await db.execute(select(tables["Slot"]).where(tables["Slot"].c.id == "slot_avail_1"))).mappings().one()
    assert slot_row["status"] == "HELD"
    assert slot_row["heldByPatientId"] == "pat_1"
