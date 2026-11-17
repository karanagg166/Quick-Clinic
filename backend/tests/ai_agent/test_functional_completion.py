"""Comprehensive functional completion regression tests for AI Agents, HITL, RAG, and PDF corpus."""

from __future__ import annotations

import json
from datetime import timedelta
from typing import Any

import httpx
import pymupdf
import pytest
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from langchain_core.outputs import ChatGeneration, ChatResult
from langgraph.checkpoint.memory import MemorySaver
from pydantic import PrivateAttr
from sqlalchemy import select

from app.core.clock import now_clinic
from app.core.security import issue_token
from app.features.ai_agent.approval_resume import decide_and_resume_approval
from app.features.ai_agent.models.fallback import get_fallback_model
from app.features.ai_agent.persistence.approvals import create_or_get_approval
from app.features.ai_agent.persistence.threads import append_turn, create_or_get_thread
from app.features.ai_agent.rag.pipeline import answer_medical_question
from app.features.ai_agent.service import AIAgentService
from app.features.ai_agent.tools.doctor_executor import execute_approved_doctor_action
from app.features.ai_agent.tools.patient import build_patient_tools
from app.features.documents import files
from app.features.documents.pipeline_runner import run_document_ingestion
from app.infrastructure.database import tables, utcnow


class _ScriptedToolModel(BaseChatModel):
    _responses: list[AIMessage] = PrivateAttr()
    _seen_messages: list[list[Any]] = PrivateAttr(default_factory=list)  # type: ignore[name-defined]

    def __init__(self, responses: list[AIMessage]):
        super().__init__()
        self._responses = list(responses)
        self._seen_messages = []

    @property
    def _llm_type(self) -> str:
        return "scripted-functional"

    def bind_tools(self, tools, **kwargs):
        return self

    def _generate(self, messages, stop=None, run_manager=None, **kwargs) -> ChatResult:
        self._seen_messages.append(list(messages))
        msg = self._responses.pop(0)
        return ChatResult(generations=[ChatGeneration(message=msg)])


class _FailingToolModel(BaseChatModel):
    _exc: BaseException = PrivateAttr()

    def __init__(self, exc: BaseException):
        super().__init__()
        self._exc = exc

    @property
    def _llm_type(self) -> str:
        return "failing-functional"

    def bind_tools(self, tools, **kwargs):
        return self

    def _generate(self, messages, stop=None, run_manager=None, **kwargs) -> ChatResult:
        raise self._exc


async def _mock_embed_coro(texts: list[str]):
    return ("cohere", "embed-english-light-v3.0", [[0.05] * 384 for _ in texts])


async def _seed_clinic(db):
    now = utcnow()
    await db.execute(tables["Location"].insert().values(pincode=560001, city="Bengaluru", state="KA"))
    for uid, role, name, email in [
        ("u_fc_pat", "PATIENT", "Functional Patient", "fcpat@example.com"),
        ("u_fc_doc", "DOCTOR", "Dr. Functional", "fcdoc@example.com"),
        ("u_fc_doc_unauth", "DOCTOR", "Dr. Unauth", "fcunauth@example.com"),
    ]:
        await db.execute(
            tables["User"].insert().values(
                id=uid,
                email=email,
                phoneNo="9999999999",
                name=name,
                password="hash",
                age=34,
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
            id="pat_fc",
            userId="u_fc_pat",
            medicalHistory="Asthma",
            allergies="None",
            currentMedications="Inhaler",
            createdAt=now,
            updatedAt=now,
        )
    )
    await db.execute(
        tables["Doctor"].insert().values(
            id="doc_fc",
            userId="u_fc_doc",
            specialty="CARDIOLOGIST",
            experience=9,
            fees=750,
            balance=3000,
            isReleaseFixture=False,
            createdAt=now,
            updatedAt=now,
        )
    )
    weekly = [
        {"day": d, "slots": [{"slotNo": 1, "start": "09:00", "end": "13:00"}] if d != "Sunday" else []}
        for d in ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
    ]
    await db.execute(
        tables["Schedule"].insert().values(
            id="sched_fc",
            doctorId="doc_fc",
            weeklySchedule=weekly,
            createdAt=now,
            updatedAt=now,
        )
    )
    await db.execute(
        tables["Doctor"].insert().values(
            id="doc_fc_unauth",
            userId="u_fc_doc_unauth",
            specialty="DERMATOLOGIST",
            experience=4,
            fees=500,
            isReleaseFixture=False,
            createdAt=now,
            updatedAt=now,
        )
    )
    future = now + timedelta(days=2)
    await db.execute(
        tables["Slot"].insert().values(
            id="slot_fc_1",
            doctorId="doc_fc",
            date=future.date(),
            startTime=future,
            endTime=future + timedelta(minutes=30),
            status="AVAILABLE",
            createdAt=now,
            updatedAt=now,
        )
    )
    await db.execute(
        tables["Slot"].insert().values(
            id="slot_fc_booked",
            doctorId="doc_fc",
            date=now.date(),
            startTime=now,
            endTime=now + timedelta(minutes=30),
            status="BOOKED",
            createdAt=now,
            updatedAt=now,
        )
    )
    await db.execute(
        tables["Appointment"].insert().values(
            id="appt_fc_1",
            doctorId="doc_fc",
            patientId="pat_fc",
            slotId="slot_fc_booked",
            status="CONFIRMED",
            paymentMethod="OFFLINE",
            bookedAt=now,
            updatedAt=now,
        )
    )
    return {
        "pat": {"id": "u_fc_pat", "role": "PATIENT", "isActive": True, "name": "Functional Patient"},
        "doc": {"id": "u_fc_doc", "role": "DOCTOR", "isActive": True, "name": "Dr. Functional"},
        "doc_unauth": {"id": "u_fc_doc_unauth", "role": "DOCTOR", "isActive": True, "name": "Dr. Unauth"},
        "future_date": future.date(),
    }


@pytest.mark.unit
@pytest.mark.asyncio
async def test_bindable_fallback_model_recovers_on_rate_limit_and_api_errors():
    req = httpx.Request("POST", "https://api.example.test/v1/generate")
    resp_429 = httpx.Response(429, request=req)
    rate_limit_exc = httpx.HTTPStatusError("429 Too Many Requests", request=req, response=resp_429)

    primary = _FailingToolModel(rate_limit_exc)
    secondary = _FailingToolModel(TimeoutError("upstream timed out"))
    tertiary = _ScriptedToolModel([AIMessage(content="Fallback provider succeeded")])

    factory_map = {"google": primary, "groq": secondary, "cohere": tertiary}
    model = get_fallback_model(["google", "groq", "cohere"], model_factory=lambda p: factory_map[p])
    bound = model.bind_tools([])
    result = await bound.ainvoke([HumanMessage(content="Hello")])
    assert result.content == "Fallback provider succeeded"


@pytest.mark.integration
@pytest.mark.asyncio
async def test_multi_tool_sequential_execution_and_tool_error_handling(db, monkeypatch):
    world = await _seed_clinic(db)
    doc = world["doc"]
    pat = world["pat"]

    # 1. Doctor emits TWO read-only tool calls in one AIMessage -> executed sequentially without crash
    #    and dict-returning tools (like get_my_profile / query_patient_medical_documents) serialize as valid JSON.
    multi_model = _ScriptedToolModel(
        [
            AIMessage(
                content="",
                tool_calls=[
                    {"id": "tc_1", "name": "get_my_profile", "args": {}},
                    {"id": "tc_2", "name": "get_my_balance", "args": {}},
                ],
            ),
            AIMessage(content="You are a Cardiologist with ₹30 balance."),
        ]
    )
    monkeypatch.setattr("app.features.ai_agent.service.get_model", lambda provider="google": multi_model)
    svc = AIAgentService(provider="google")
    cp = MemorySaver()
    res = await svc.chat_turn(
        message="What is my specialty and balance?",
        actor=doc,
        db=db,
        thread_id="t_fc_multi",
        checkpointer=cp,
    )
    assert "Cardiologist" in res["message"]["content"]
    tool_msgs = [m for m in multi_model._seen_messages[-1] if m.__class__.__name__ == "ToolMessage"]
    assert len(tool_msgs) == 2
    assert json.loads(tool_msgs[0].content)["specialty"] == "CARDIOLOGIST"
    assert json.loads(tool_msgs[1].content)["balance_rupees"] == 30

    # 2. Second turn reuses checkpoint without duplicating SystemMessage
    multi_model._responses.append(AIMessage(content="Follow-up answered."))
    res2 = await svc.chat_turn(
        message="Follow-up question",
        actor=doc,
        db=db,
        thread_id="t_fc_multi",
        checkpointer=cp,
    )
    assert res2["message"]["content"] == "Follow-up answered."
    sys_msgs = [m for m in multi_model._seen_messages[-1] if isinstance(m, SystemMessage)]
    assert len(sys_msgs) == 1

    # 3. Tool raising HTTPException(404) inside graph is caught into ToolMessage rather than 500
    err_model = _ScriptedToolModel(
        [
            AIMessage(
                content="",
                tool_calls=[
                    {"id": "tc_missing", "name": "get_appointment_details", "args": {"appointment_id": "nonexistent_appt"}}
                ],
            ),
            AIMessage(content="That appointment was not found."),
        ]
    )
    monkeypatch.setattr("app.features.ai_agent.service.get_model", lambda provider="google": err_model)
    svc_err = AIAgentService(provider="google")
    res_err = await svc_err.chat_turn(
        message="Show appointment nonexistent_appt",
        actor=pat,
        db=db,
        thread_id="t_fc_err",
        checkpointer=MemorySaver(),
    )
    assert "not found" in res_err["message"]["content"].lower()


@pytest.mark.integration
@pytest.mark.asyncio
async def test_hitl_reject_clears_checkpoint_and_allows_subsequent_turn(db, monkeypatch):
    world = await _seed_clinic(db)
    doc = world["doc"]
    cp = MemorySaver()
    model = _ScriptedToolModel(
        [
            AIMessage(
                content="",
                tool_calls=[
                    {
                        "id": "tc_rej_leave",
                        "name": "apply_leave",
                        "args": {"start_date": "2026-12-20", "end_date": "2026-12-21", "reason": "Trip"},
                    }
                ],
            ),
            AIMessage(content="Your specialty is Cardiologist."),
        ]
    )
    monkeypatch.setattr("app.features.ai_agent.service.get_model", lambda provider="google": model)
    svc = AIAgentService(provider="google")

    paused = await svc.chat_turn(
        message="Apply leave Dec 20-21 for Trip",
        actor=doc,
        db=db,
        thread_id="t_fc_rej",
        checkpointer=cp,
    )
    assert paused["approvalRequest"]["status"] == "PENDING"
    aid = paused["approvalRequest"]["approvalId"]

    rejected = await svc.decide_and_resume(
        db=db,
        actor=doc,
        thread_id="t_fc_rej",
        approval_id=aid,
        decision="REJECTED",
        decision_reason="Cancelled trip",
        checkpointer=cp,
    )
    assert rejected["approval"]["status"] == "REJECTED"

    leaves = (await db.execute(select(tables["Leave"]).where(tables["Leave"].c.doctorId == "doc_fc"))).all()
    assert leaves == []

    # Checkpoint interrupt cleared; follow-up turn succeeds cleanly
    followup = await svc.chat_turn(
        message="What is my specialty?",
        actor=doc,
        db=db,
        thread_id="t_fc_rej",
        checkpointer=cp,
    )
    assert "Cardiologist" in followup["message"]["content"]


@pytest.mark.integration
@pytest.mark.asyncio
async def test_delete_document_hitl_approval_nested_tx_and_rag_gemini_blocks(db, monkeypatch, tmp_path):
    monkeypatch.setenv("DOCUMENT_STORAGE_DIR", str(tmp_path))
    from app.core.config import get_settings

    get_settings.cache_clear()
    monkeypatch.setattr("app.features.documents.embeddings.embed_texts", lambda texts: _mock_embed_coro(texts))
    monkeypatch.setattr("app.features.ai_agent.rag.retrieval.get_embedding_provider", lambda: None)
    monkeypatch.setattr("app.features.ai_agent.rag.retrieval.get_reranker_provider", lambda: None)

    world = await _seed_clinic(db)
    pat = world["pat"]
    doc_actor = world["doc"]
    now = utcnow()

    doc_pdf = pymupdf.open()
    doc_pdf.new_page().insert_text((72, 72), "Serum Ferritin: 88 ng/mL (Normal 30-400)", fontsize=11)
    pdf_bytes = doc_pdf.tobytes()

    storage_key = "local/pat_fc/doc_fc_1/hash_fc"
    await files.write_file(storage_key, pdf_bytes, "ferritin.pdf", "application/pdf")
    await db.execute(
        tables["MedicalDocument"].insert().values(
            id="doc_fc_1",
            patientId="pat_fc",
            title="Iron Studies",
            type="LAB_REPORT",
            fileName="ferritin.pdf",
            mimeType="application/pdf",
            fileSize=len(pdf_bytes),
            storagePath=storage_key,
            reportDate=now,
            processingStatus="QUEUED",
            createdAt=now,
            updatedAt=now,
        )
    )
    ing = await run_document_ingestion(db, document_id="doc_fc_1", data=pdf_bytes)
    assert ing["status"] == "COMPLETED"

    # 1. RAG answer parses structured Gemini content blocks cleanly + falls back across providers
    monkeypatch.setenv("GOOGLE_API_KEY", "test-google-key")
    monkeypatch.setenv("GROQ_API_KEY", "test-groq-key")
    from app.core.config import get_settings

    get_settings.cache_clear()
    try:
        failing_google = _FailingToolModel(RuntimeError("429 RESOURCE_EXHAUSTED"))
        block_groq = _ScriptedToolModel(
            [AIMessage(content=[{"type": "text", "text": "Your serum ferritin is 88 ng/mL [1].", "extras": {"sig": "x"}}])]
        )
        monkeypatch.setattr(
            "app.features.ai_agent.rag.pipeline.get_model",
            lambda p: failing_google if p == "google" else block_groq,
        )
        rag_doc = await answer_medical_question(
            db, actor=doc_actor, patient_id="pat_fc", question="What was the serum ferritin?"
        )
        assert rag_doc["answer"] == "Your serum ferritin is 88 ng/mL [1]."
        assert rag_doc["generationMode"] == "llm"
        assert rag_doc["provider"] == "groq"
        assert rag_doc["citations"][0]["href"] == "/doctor/patients/pat_fc/medical-documents"

        # Ungrounded question with no matching chunks -> no_evidence
        rag_missing = await answer_medical_question(
            db, actor=pat, patient_id=None, question="What was my troponin I level?"
        )
        assert rag_missing["generationMode"] == "no_evidence"
        assert rag_missing["citations"] == []
    finally:
        get_settings.cache_clear()

    # 2. DELETE_DOCUMENT approved through decide_and_resume_approval inside db.begin_nested()
    thread = await create_or_get_thread(db, actor=pat, thread_id="t_fc_del")
    await append_turn(db, thread_id=thread["id"], original_query="Delete my Iron Studies report")
    appr = await create_or_get_approval(
        db,
        actor=pat,
        thread_id=thread["id"],
        tool_call_id="tc_del_1",
        action_type="DELETE_DOCUMENT",
        risk_level="MEDIUM_HUMAN_APPROVAL",
        parameters={"document_id": "doc_fc_1"},
        title="Delete Medical Document",
        summary="Delete doc_fc_1",
        reason="User requested deletion",
        idempotency_key="hitl_t_fc_del_tc_del_1",
    )
    res = await decide_and_resume_approval(
        model=None,
        db=db,
        actor=pat,
        thread_id=thread["id"],
        approval_id=appr["id"],
        decision="APPROVED",
    )
    assert res["approval"]["status"] == "APPROVED"
    assert res["approval"]["executionStatus"] == "COMPLETED"
    row_after = (await db.execute(select(tables["MedicalDocument"]).where(tables["MedicalDocument"].c.id == "doc_fc_1"))).first()
    assert row_after is None


@pytest.mark.integration
@pytest.mark.asyncio
async def test_relative_slot_dates_and_doctor_send_message_patient_id_resolution(db):
    world = await _seed_clinic(db)
    pat = world["pat"]
    doc = world["doc"]

    # Patient get_doctor_available_slots accepts relative 'today' and 'tomorrow' without ValueError
    tools = {
        t.name: t
        for t in build_patient_tools(
            db=db, actor=pat, reference_date=now_clinic().date(), include_mutations=False
        )
    }
    res_tomorrow = json.loads(
        await tools["get_doctor_available_slots"].ainvoke({"doctor_id": "doc_fc", "date_str": "tomorrow"})
    )
    assert res_tomorrow["doctorId"] == "doc_fc"
    assert res_tomorrow["date"] == (now_clinic().date() + timedelta(days=1)).isoformat()

    # Doctor SEND_PATIENT_MESSAGE works when LLM supplies Patient.id ('pat_fc') instead of User.id ('u_fc_pat')
    code, payload = await execute_approved_doctor_action(
        db,
        actor=doc,
        action_type="SEND_PATIENT_MESSAGE",
        parameters={"patient_user_id": "pat_fc", "text": "Fasting is required."},
        approval_id="appr_msg_pat_id",
    )
    assert code == "SEND_PATIENT_MESSAGE_OK"
    assert payload["messageId"] is not None


@pytest.mark.integration
@pytest.mark.asyncio
async def test_drawn_multipage_table_across_25_page_boundary_unicode_and_corrupt_pdf(client, db, monkeypatch, tmp_path):
    monkeypatch.setenv("DOCUMENT_STORAGE_DIR", str(tmp_path))
    monkeypatch.setattr("app.features.documents.embeddings.embed_texts", lambda texts: _mock_embed_coro(texts))
    world = await _seed_clinic(db)
    pat = world["pat"]
    now = utcnow()

    # 1. Real drawn table spanning batch boundary (page 25 -> page 26)
    d = pymupdf.open()
    for _ in range(24):
        d.new_page().insert_text((72, 72), "Clinical filler page.")

    def _draw_tbl(page, rows, y_start):
        x0, x1, x2 = 50, 250, 450
        y = y_start
        for c1, c2 in rows:
            page.draw_rect(pymupdf.Rect(x0, y, x1, y + 30), color=(0, 0, 0), width=1)
            page.draw_rect(pymupdf.Rect(x1, y, x2, y + 30), color=(0, 0, 0), width=1)
            page.insert_text((x0 + 6, y + 20), c1, fontsize=10)
            page.insert_text((x1 + 6, y + 20), c2, fontsize=10)
            y += 30

    p25 = d.new_page(width=595, height=842)
    _draw_tbl(p25, [("Analyte", "Value"), ("Hemoglobin", "14.1 g/dL"), ("WBC", "7.1 K/uL")], y_start=680)
    p26 = d.new_page(width=595, height=842)
    _draw_tbl(p26, [("Analyte", "Value"), ("Platelets", "255 K/uL"), ("Creatinine", "0.88 mg/dL")], y_start=40)

    await db.execute(
        tables["MedicalDocument"].insert().values(
            id="doc_fc_tbl26",
            patientId="pat_fc",
            title="26 Page Table Boundary",
            type="LAB_REPORT",
            fileName="tbl26.pdf",
            mimeType="application/pdf",
            fileSize=4096,
            storagePath="local/pat_fc/doc_fc_tbl26/f",
            reportDate=now,
            processingStatus="QUEUED",
            createdAt=now,
            updatedAt=now,
        )
    )
    res_tbl = await run_document_ingestion(db, document_id="doc_fc_tbl26", data=d.tobytes())
    assert res_tbl["status"] == "COMPLETED"
    tbl_objs = (
        await db.execute(
            select(tables["MedicalDocumentObject"]).where(
                tables["MedicalDocumentObject"].c.versionId == res_tbl["versionId"],
                tables["MedicalDocumentObject"].c.kind == "table",
            )
        )
    ).mappings().all()
    assert len(tbl_objs) == 1  # Merged across page 25 -> 26 batch boundary!
    assert tbl_objs[0]["firstPage"] == 25
    assert tbl_objs[0]["lastPage"] == 26

    # 2. Corrupted PDF rejected at upload (400) AND non-retryable FAILED in ingestion
    corrupt_bytes = b"%PDF-1.4\n%%corrupted-binary-stream"
    r_corrupt = await client.post(
        "/api/patients/me/medical-documents",
        headers={"Authorization": f"Bearer {issue_token(pat)}"},
        data={"title": "Corrupt", "type": "OTHER", "reportDate": "2026-11-15"},
        files={"file": ("corrupt.pdf", corrupt_bytes, "application/pdf")},
    )
    assert r_corrupt.status_code == 400

    await db.execute(
        tables["MedicalDocument"].insert().values(
            id="doc_fc_corrupt",
            patientId="pat_fc",
            title="Corrupt Ingest",
            type="OTHER",
            fileName="corrupt.pdf",
            mimeType="application/pdf",
            fileSize=len(corrupt_bytes),
            storagePath="local/pat_fc/doc_fc_corrupt/f",
            reportDate=now,
            processingStatus="QUEUED",
            createdAt=now,
            updatedAt=now,
        )
    )
    res_corrupt = await run_document_ingestion(db, document_id="doc_fc_corrupt", data=corrupt_bytes)
    assert res_corrupt["status"] == "FAILED"
    job_c = (
        await db.execute(select(tables["MedicalIngestionJob"]).where(tables["MedicalIngestionJob"].c.documentId == "doc_fc_corrupt"))
    ).mappings().first()
    assert job_c["retryable"] is False

    # 3. Multilingual / Unicode PDF preserves UTF-8 content
    d_uni = pymupdf.open()
    p_uni = d_uni.new_page()
    p_uni.insert_htmlbox(
        pymupdf.Rect(50, 50, 500, 300),
        "<p>Patient: José García — Vitamin B12: 450 pg/mL (≥ 200 normal). <b>रक्त शर्करा: 94 mg/dL</b></p>",
    )
    await db.execute(
        tables["MedicalDocument"].insert().values(
            id="doc_fc_uni",
            patientId="pat_fc",
            title="Unicode Report",
            type="LAB_REPORT",
            fileName="unicode.pdf",
            mimeType="application/pdf",
            fileSize=2048,
            storagePath="local/pat_fc/doc_fc_uni/f",
            reportDate=now,
            processingStatus="QUEUED",
            createdAt=now,
            updatedAt=now,
        )
    )
    res_uni = await run_document_ingestion(db, document_id="doc_fc_uni", data=d_uni.tobytes())
    assert res_uni["status"] == "COMPLETED"
    uni_chunks = (
        await db.execute(
            select(tables["MedicalDocumentChunk"]).where(tables["MedicalDocumentChunk"].c.versionId == res_uni["versionId"])
        )
    ).mappings().all()
    uni_text = " ".join(c["content"] for c in uni_chunks)
    assert "José García" in uni_text
    assert "450 pg/mL" in uni_text


@pytest.mark.integration
@pytest.mark.asyncio
async def test_patient_propose_booking_hitl_approval_with_datetime_hold(db, monkeypatch):
    """Regression: PROPOSE_BOOKING returns a hold with datetime expiresAt, which must serialize into AgentToolCall without breaking complete_execution."""
    world = await _seed_clinic(db)
    pat = world["pat"]
    cp = MemorySaver()
    model = _ScriptedToolModel(
        [
            AIMessage(
                content="",
                tool_calls=[
                    {
                        "id": "tc_fc_hold",
                        "name": "propose_appointment_booking",
                        "args": {"doctor_id": "doc_fc", "slot_id": "slot_fc_1"},
                    }
                ],
            ),
            AIMessage(content="Slot hold created. Proceed to checkout to complete booking."),
        ]
    )
    monkeypatch.setattr("app.features.ai_agent.service.get_model", lambda provider="google": model)
    svc = AIAgentService(provider="google")

    paused = await svc.chat_turn(
        message="Propose booking slot_fc_1 with doc_fc",
        actor=pat,
        db=db,
        thread_id="t_fc_book_hold",
        checkpointer=cp,
    )
    approval_id = paused["approvalRequest"]["approvalId"]
    assert paused["approvalRequest"]["actionType"] == "PROPOSE_BOOKING"

    resumed = await svc.decide_and_resume(
        db=db,
        actor=pat,
        thread_id="t_fc_book_hold",
        approval_id=approval_id,
        decision="APPROVED",
        checkpointer=cp,
    )
    assert resumed["approval"]["status"] == "APPROVED"
    assert resumed["approval"]["executionStatus"] == "COMPLETED"
    assert resumed["approval"]["executionResult"] == {"code": "BOOKING_HOLD_CREATED"}
    assert "checkout" in resumed["resumedMessage"]["content"].lower()

    slot_row = (
        await db.execute(select(tables["Slot"]).where(tables["Slot"].c.id == "slot_fc_1"))
    ).mappings().one()
    assert slot_row["status"] == "HELD"
    assert slot_row["holdToken"] is not None

    tc_row = (
        await db.execute(
            select(tables["AgentToolCall"]).where(tables["AgentToolCall"].c.approvalId == approval_id)
        )
    ).mappings().one()
    assert tc_row["status"] == "COMPLETED"
    assert isinstance(tc_row["resultJson"]["hold"]["expiresAt"], str)

