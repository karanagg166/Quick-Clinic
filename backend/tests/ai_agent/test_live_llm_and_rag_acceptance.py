"""Live hosted LLM, LangGraph Postgres checkpointer, and pgvector RAG acceptance tests."""

from __future__ import annotations

import os
import uuid
from datetime import timedelta

import pymupdf
import pytest
from sqlalchemy import select

from app.core.config import get_settings
from app.features.ai_agent.persistence.checkpoints import get_checkpoint, initialize_checkpoint_schema
from app.features.ai_agent.rag.pipeline import answer_medical_question
from app.features.ai_agent.service import AIAgentService
from app.features.documents.pipeline_runner import run_document_ingestion
from app.infrastructure.database import tables, utcnow


def _make_clinical_pdf() -> bytes:
    doc = pymupdf.open()
    p = doc.new_page()
    p.insert_text(
        (72, 72),
        "ENDOCRINOLOGY LAB REPORT\n"
        "Patient: Live Acceptance Patient\n"
        "HbA1c: 6.1 percent (Reference < 5.7)\n"
        "TSH: 2.34 mIU/L (Reference 0.40 - 4.00)\n"
        "Vitamin D: 38 ng/mL\n",
        fontsize=11,
    )
    return doc.tobytes()


async def _seed_live_world(db):
    now = utcnow()
    await db.execute(tables["Location"].insert().values(pincode=560001, city="Bengaluru", state="KA"))
    for uid, role, name, email in [
        ("u_live_pat", "PATIENT", "Live Patient", "livepat@example.com"),
        ("u_live_doc", "DOCTOR", "Dr. Live", "livedoc@example.com"),
    ]:
        await db.execute(
            tables["User"].insert().values(
                id=uid,
                email=email,
                phoneNo="9999999999",
                name=name,
                password="hash",
                age=36,
                gender="FEMALE" if role == "PATIENT" else "MALE",
                role=role,
                address="Clinic Rd",
                pinCode=560001,
                isActive=True,
                createdAt=now,
                updatedAt=now,
            )
        )
    await db.execute(
        tables["Patient"].insert().values(
            id="pat_live",
            userId="u_live_pat",
            medicalHistory="Pre-diabetes",
            allergies="None",
            currentMedications="Metformin 500mg",
            createdAt=now,
            updatedAt=now,
        )
    )
    await db.execute(
        tables["Doctor"].insert().values(
            id="doc_live",
            userId="u_live_doc",
            specialty="GENERAL_PHYSICIAN",
            experience=12,
            fees=600,
            balance=4500,
            isReleaseFixture=False,
            createdAt=now,
            updatedAt=now,
        )
    )
    slot_t = now + timedelta(days=1)
    await db.execute(
        tables["Slot"].insert().values(
            id="slot_live_booked",
            doctorId="doc_live",
            date=now.date(),
            startTime=now,
            endTime=now + timedelta(minutes=30),
            status="BOOKED",
            createdAt=now,
            updatedAt=now,
        )
    )
    await db.execute(
        tables["Slot"].insert().values(
            id="slot_live_avail",
            doctorId="doc_live",
            date=slot_t.date(),
            startTime=slot_t,
            endTime=slot_t + timedelta(minutes=30),
            status="AVAILABLE",
            createdAt=now,
            updatedAt=now,
        )
    )
    await db.execute(
        tables["Appointment"].insert().values(
            id="appt_live_1",
            doctorId="doc_live",
            patientId="pat_live",
            slotId="slot_live_booked",
            status="CONFIRMED",
            paymentMethod="OFFLINE",
            bookedAt=now,
            updatedAt=now,
        )
    )
    await db.execute(
        tables["MedicalDocument"].insert().values(
            id="doc_live_endo",
            patientId="pat_live",
            title="Endocrinology Panel",
            type="LAB_REPORT",
            fileName="endo.pdf",
            mimeType="application/pdf",
            fileSize=1024,
            storagePath="local/pat_live/doc_live_endo/f",
            reportDate=now,
            processingStatus="QUEUED",
            createdAt=now,
            updatedAt=now,
        )
    )
    return {
        "pat": {"id": "u_live_pat", "role": "PATIENT", "isActive": True, "name": "Live Patient"},
        "doc": {"id": "u_live_doc", "role": "DOCTOR", "isActive": True, "name": "Dr. Live"},
    }


@pytest.mark.integration
@pytest.mark.live
@pytest.mark.postgres
@pytest.mark.asyncio
async def test_live_rag_followup_and_ungrounded_denial(pg_engine):
    settings = get_settings()
    if not (settings.google_api_key and settings.cohere_api_key):
        pytest.skip("GOOGLE_API_KEY and COHERE_API_KEY required for live RAG acceptance")

    async with pg_engine.begin() as db:
        world = await _seed_live_world(db)
        ing = await run_document_ingestion(db, document_id="doc_live_endo", data=_make_clinical_pdf())
        assert ing["status"] == "COMPLETED"
        assert ing["indexStatus"] == "COMPLETED"

        pat = world["pat"]
        doc = world["doc"]

        rag_q1 = await answer_medical_question(
            db, actor=pat, patient_id=None, question="What was my HbA1c value?"
        )
        assert rag_q1["generationMode"] == "llm"
        assert "6.1" in rag_q1["answer"]
        assert len(rag_q1["citations"]) >= 1

        rag_followup = await answer_medical_question(
            db,
            actor=pat,
            patient_id=None,
            question="What about the TSH level in that report?",
            history_messages=[{"role": "USER", "content": "What was my HbA1c value?"}],
        )
        assert rag_followup["generationMode"] == "llm"
        assert "2.34" in rag_followup["answer"]

        rag_absent = await answer_medical_question(
            db, actor=doc, patient_id="pat_live", question="What was the patient's serum troponin I?"
        )
        ans_absent = rag_absent["answer"].lower()
        assert any(phrase in ans_absent for phrase in ("not", "no ", "do not", "does not", "unavailable", "missing"))
        assert "ng/ml" not in ans_absent


@pytest.mark.integration
@pytest.mark.live
@pytest.mark.postgres
@pytest.mark.asyncio
async def test_live_doctor_google_multitool_and_hitl_leave_approval(pg_engine):
    settings = get_settings()
    if not settings.google_api_key:
        pytest.skip("GOOGLE_API_KEY required")

    os.environ["LANGGRAPH_DATABASE_URL"] = os.environ.get("QC_TEST_DATABASE_URL", "")
    get_settings.cache_clear()
    await initialize_checkpoint_schema()
    try:
        async with pg_engine.begin() as db:
            world = await _seed_live_world(db)
            doc = world["doc"]
            async with get_checkpoint() as cp:
                svc = AIAgentService(provider="google")
                doc_tid = f"t_live_doc_{uuid.uuid4().hex[:8]}"
                d_res = await svc.chat_turn(
                    message="What is my specialty and consultation fee, and what is my current balance?",
                    actor=doc,
                    db=db,
                    thread_id=doc_tid,
                    checkpointer=cp,
                )
                assert "600" in d_res["message"]["content"]

                d_leave = await svc.chat_turn(
                    message="Apply leave from 2026-12-26 to 2026-12-27 for Medical Conference.",
                    actor=doc,
                    db=db,
                    thread_id=doc_tid,
                    checkpointer=cp,
                )
                assert d_leave.get("approvalRequest") is not None
                aid = d_leave["approvalRequest"]["approvalId"]
                approved = await svc.decide_and_resume(
                    db=db, actor=doc, thread_id=doc_tid, approval_id=aid, decision="APPROVED", checkpointer=cp
                )
                assert approved["approval"]["executionStatus"] == "COMPLETED"
                leaves = (await db.execute(select(tables["Leave"]).where(tables["Leave"].c.doctorId == "doc_live"))).all()
                assert len(leaves) == 1
    finally:
        os.environ.pop("LANGGRAPH_DATABASE_URL", None)
        get_settings.cache_clear()


@pytest.mark.integration
@pytest.mark.live
@pytest.mark.postgres
@pytest.mark.asyncio
async def test_live_groq_and_cohere_patient_tool_calling(pg_engine):
    settings = get_settings()
    if not (settings.groq_api_key and settings.cohere_api_key):
        pytest.skip("GROQ_API_KEY and COHERE_API_KEY required")

    os.environ["LANGGRAPH_DATABASE_URL"] = os.environ.get("QC_TEST_DATABASE_URL", "")
    get_settings.cache_clear()
    await initialize_checkpoint_schema()
    try:
        async with pg_engine.begin() as db:
            world = await _seed_live_world(db)
            await run_document_ingestion(db, document_id="doc_live_endo", data=_make_clinical_pdf())
            pat = world["pat"]
            async with get_checkpoint() as cp:
                svc_groq = AIAgentService(provider="groq")
                p_groq = await svc_groq.chat_turn(
                    message="What are my current medications on my medical profile?",
                    actor=pat,
                    db=db,
                    thread_id=f"t_live_groq_{uuid.uuid4().hex[:8]}",
                    checkpointer=cp,
                )
                assert "metformin" in p_groq["message"]["content"].lower()

                svc_cohere = AIAgentService(provider="cohere")
                p_cohere = await svc_cohere.chat_turn(
                    message="Check my uploaded medical documents for my Vitamin D level.",
                    actor=pat,
                    db=db,
                    thread_id=f"t_live_cohere_{uuid.uuid4().hex[:8]}",
                    checkpointer=cp,
                )
                assert "38" in p_cohere["message"]["content"]
    finally:
        os.environ.pop("LANGGRAPH_DATABASE_URL", None)
        get_settings.cache_clear()
