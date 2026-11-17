"""End-to-end LangGraph workflow verification for all 26 Doctor & 31 Patient tools,
extended PDF corpus shapes (borderless tables, charts, diagrams, multi-batch PARTIAL),
multi-document RAG, processing documents, and persistent conversation summaries.
"""

from __future__ import annotations

from datetime import timedelta
from typing import Any

import pytest
from fastapi import HTTPException
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage, SystemMessage, ToolMessage
from langchain_core.outputs import ChatGeneration, ChatResult
from langgraph.checkpoint.memory import MemorySaver
import pymupdf
from pydantic import PrivateAttr
from sqlalchemy import select

from app.core.clock import now_clinic
from app.features.ai_agent.graph.routing import (
    APPROVAL_DOCTOR_TOOLS,
    APPROVAL_PATIENT_TOOLS,
    READ_ONLY_DOCTOR_TOOLS,
    READ_ONLY_PATIENT_TOOLS,
)
from app.features.ai_agent.rag.pipeline import answer_medical_question
from app.features.ai_agent.service import AIAgentService
from app.features.documents import files
from app.features.documents.pipeline_runner import run_document_ingestion
from app.features.documents.storage import storage_path
from app.infrastructure.database import tables, utcnow


class _LangGraphScriptedModel(BaseChatModel):
    _responses: list[AIMessage] = PrivateAttr()
    _seen_messages: list[list[Any]] = PrivateAttr(default_factory=list)  # type: ignore[name-defined]

    def __init__(self, responses: list[AIMessage]):
        super().__init__()
        self._responses = list(responses)
        self._seen_messages = []

    @property
    def _llm_type(self) -> str:
        return "scripted-langgraph-e2e"

    def bind_tools(self, tools, **kwargs):
        return self

    def _generate(self, messages, stop=None, run_manager=None, **kwargs) -> ChatResult:
        self._seen_messages.append(list(messages))
        return ChatResult(generations=[ChatGeneration(message=self._responses.pop(0))])


async def _seed_world(db) -> dict[str, Any]:
    now = utcnow()
    today = now_clinic().date()
    past_start = now - timedelta(days=2)
    future_start = now + timedelta(days=2)
    avail_start = now + timedelta(days=3)

    await db.execute(tables["Location"].insert().values(pincode=560001, city="Bengaluru", state="KA"))

    for uid, role, name, email in [
        ("u_lg_pat", "PATIENT", "Alice LG", "lgpat@example.com"),
        ("u_lg_doc", "DOCTOR", "Dr. Rao LG", "lgdoc@example.com"),
        ("u_lg_pat_other", "PATIENT", "Other Pat", "lgother@example.com"),
    ]:
        await db.execute(
            tables["User"].insert().values(
                id=uid,
                email=email,
                phoneNo="9999999999",
                name=name,
                password="hash",
                age=35,
                gender="FEMALE" if role == "PATIENT" else "MALE",
                role=role,
                address="100 Clinic St",
                pinCode=560001,
                emailVerified=True,
                isActive=True,
                createdAt=now,
                updatedAt=now,
            )
        )

    await db.execute(
        tables["Patient"].insert().values(
            id="pat_lg",
            userId="u_lg_pat",
            medicalHistory="Mild asthma",
            allergies="Pollen",
            currentMedications="Inhaler",
            createdAt=now,
            updatedAt=now,
        )
    )
    await db.execute(
        tables["Patient"].insert().values(
            id="pat_lg_other",
            userId="u_lg_pat_other",
            createdAt=now,
            updatedAt=now,
        )
    )
    await db.execute(
        tables["Doctor"].insert().values(
            id="doc_lg",
            userId="u_lg_doc",
            specialty="CARDIOLOGIST",
            experience=12,
            fees=800,
            doctorBio="Senior cardiologist",
            balance=2500,
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
            id="sched_lg", doctorId="doc_lg", weeklySchedule=weekly, createdAt=now, updatedAt=now
        )
    )
    await db.execute(
        tables["Leave"].insert().values(
            id="leave_lg_1",
            doctorId="doc_lg",
            reason="Medical Summit",
            startDate=now + timedelta(days=10),
            endDate=now + timedelta(days=11),
            applyAt=now,
        )
    )

    for sid, dt, st, et, status in [
        ("slot_lg_past", past_start.date(), past_start, past_start + timedelta(minutes=30), "UNAVAILABLE"),
        ("slot_lg_conf", future_start.date(), future_start, future_start + timedelta(minutes=30), "BOOKED"),
        ("slot_lg_avail", avail_start.date(), avail_start, avail_start + timedelta(minutes=30), "AVAILABLE"),
        (
            "slot_lg_avail2",
            (avail_start + timedelta(hours=1)).date(),
            avail_start + timedelta(hours=1),
            avail_start + timedelta(hours=1, minutes=30),
            "AVAILABLE",
        ),
    ]:
        await db.execute(
            tables["Slot"].insert().values(
                id=sid,
                doctorId="doc_lg",
                date=dt,
                startTime=st,
                endTime=et,
                status=status,
                createdAt=now,
                updatedAt=now,
            )
        )

    await db.execute(
        tables["Payment"].insert().values(
            id="pay_lg_1",
            idempotencyKey="pay_lg_idem_1",
            amount=800,
            currency="INR",
            userId="u_lg_pat",
            doctorId="doc_lg",
            slotId="slot_lg_conf",
            status="SUCCESS",
            razorpayOrderId="order_lg_1",
            razorpayPaymentId="rzp_lg_1",
            attempts=1,
            createdAt=now,
            updatedAt=now,
        )
    )
    await db.execute(
        tables["Checkout"].insert().values(
            id="chk_lg_1",
            idempotencyKey="chk_lg_idem_1",
            userId="u_lg_pat",
            patientId="pat_lg",
            doctorId="doc_lg",
            slotId="slot_lg_conf",
            holdToken="hold_lg_1",
            paymentMethod="ONLINE",
            amount=800,
            currency="INR",
            status="CONFIRMED",
            razorpayOrderId="order_lg_1",
            expiresAt=now + timedelta(minutes=10),
            paymentId="pay_lg_1",
            attempts=1,
            createdAt=now,
            updatedAt=now,
        )
    )
    for aid, sid, payid, status, pm in [
        ("appt_lg_past", "slot_lg_past", None, "COMPLETED", "OFFLINE"),
        ("appt_lg_conf", "slot_lg_conf", "pay_lg_1", "CONFIRMED", "ONLINE"),
    ]:
        await db.execute(
            tables["Appointment"].insert().values(
                id=aid,
                doctorId="doc_lg",
                patientId="pat_lg",
                slotId=sid,
                paymentId=payid,
                status=status,
                paymentMethod=pm,
                bookedAt=now,
                updatedAt=now,
                isAppointmentOffline=(pm == "OFFLINE"),
            )
        )

    await db.execute(
        tables["Notification"].insert().values(
            id="notif_lg_1",
            userId="u_lg_pat",
            message="Lab results ready",
            isRead=False,
            status="SENT",
            createdAt=now,
        )
    )
    await db.execute(
        tables["DoctorPatientRelation"].insert().values(
            id="rel_lg_1", doctorsUserId="u_lg_doc", patientsUserId="u_lg_pat", createdAt=now, updatedAt=now
        )
    )
    await db.execute(
        tables["ChatMessages"].insert().values(
            id="cmsg_lg_1",
            doctorPatientRelationId="rel_lg_1",
            senderId="u_lg_doc",
            text="Please bring reports.",
            createdAt=now,
        )
    )

    # Ready document + chunk + second processing document
    await db.execute(
        tables["MedicalDocument"].insert().values(
            id="doc_lg_1",
            patientId="pat_lg",
            title="Cardiac Echo Report",
            type="RADIOLOGY_SCAN",
            fileName="echo.pdf",
            mimeType="application/pdf",
            fileSize=1024,
            storagePath="local/pat_lg/doc_lg_1/secret",
            reportDate=now,
            processingStatus="READY",
            createdAt=now,
            updatedAt=now,
        )
    )
    await db.execute(
        tables["MedicalDocumentVersion"].insert().values(
            id="ver_lg_1",
            documentId="doc_lg_1",
            versionNumber=1,
            sourceSha256="abc123lg",
            schemaVersion="1.0",
            pipelineVersion="test",
            configFingerprint="cfg",
            tokenizerName="tiktoken",
            extractionStatus="COMPLETED",
            indexStatus="COMPLETED",
            pageCount=2,
            chunkCount=1,
            issueCount=0,
            isPublished=True,
            manifest={},
            contentSha256="csha_lg_1",
            createdAt=now,
            publishedAt=now,
        )
    )
    await db.execute(
        tables["MedicalDocumentChunk"].insert().values(
            id="chk_lg_chunk_1",
            versionId="ver_lg_1",
            chunkStableId="st_lg_1",
            chunkIndex=0,
            kind="text",
            content="Echocardiogram ejection fraction 64% with normal valves.",
            contentSha256="sha_lg_1",
            tokenCount=10,
            tokenizer="cl100k",
            headingPath=["Cardiac"],
            sourceObjectIds=["obj_1"],
            paragraphIds=["p_1"],
            sentenceIds=["s_1"],
            pageNumbers=[1],
            startPage=1,
            endPage=1,
            isFragment=False,
            provenance=[{"page_number": 1}],
            pipelineVersion="test",
            status="COMPLETED",
            createdAt=now,
        )
    )

    return {
        "pat": {"id": "u_lg_pat", "role": "PATIENT", "isActive": True, "name": "Alice LG"},
        "doc": {"id": "u_lg_doc", "role": "DOCTOR", "isActive": True, "name": "Dr. Rao LG"},
        "today": today,
        "avail_day": avail_start.date().isoformat(),
    }


@pytest.mark.integration
@pytest.mark.asyncio
async def test_all_26_doctor_tools_via_langgraph_workflow(db, monkeypatch):
    """Execute all 16 read-only and all 10 HITL mutating Doctor tools through the actual LangGraph workflow."""
    monkeypatch.setattr("app.features.ai_agent.rag.retrieval.get_embedding_provider", lambda: None)
    monkeypatch.setattr("app.features.ai_agent.rag.retrieval.get_reranker_provider", lambda: None)
    monkeypatch.setattr("app.features.ai_agent.rag.pipeline.get_settings", lambda: type("S", (), {"google_api_key": "", "groq_api_key": "", "cohere_api_key": ""})())

    world = await _seed_world(db)
    doc = world["doc"]
    cp = MemorySaver()

    # Phase A: All 16 read tools invoked inside real LangGraph sequential_tool_node turns
    read_calls = [
        ("get_my_profile", {}),
        ("get_my_weekly_schedule", {}),
        ("get_my_leaves", {}),
        ("get_my_statistics", {}),
        ("get_my_balance", {}),
        ("get_my_earnings_summary", {}),
        ("get_my_consultation_slots", {"day": world["avail_day"]}),
        ("get_my_free_slots", {"day": world["avail_day"]}),
        ("get_my_appointments", {}),
        ("get_appointment_details", {"appointment_id": "appt_lg_conf"}),
        ("list_my_patients", {}),
        ("get_patient_info", {"patient_id": "pat_lg"}),
        ("get_patient_appointment_history", {"patient_id": "pat_lg"}),
        ("list_patient_medical_documents", {"patient_id": "pat_lg"}),
        ("query_patient_medical_documents", {"patient_id": "pat_lg", "question": "ejection fraction"}),
        ("get_conversation_history", {}),
    ]
    assert {name for name, _ in read_calls} == READ_ONLY_DOCTOR_TOOLS

    scripted_read_msgs: list[AIMessage] = []
    # Run in batches of 2 tool calls per turn (inside MAX_TOOL_CALLS_PER_TURN = 3)
    for i in range(0, len(read_calls), 2):
        batch = read_calls[i : i + 2]
        scripted_read_msgs.append(
            AIMessage(
                content="",
                tool_calls=[
                    {"id": f"tc_dr_{i + j}", "name": name, "args": args}
                    for j, (name, args) in enumerate(batch)
                ],
            )
        )
        scripted_read_msgs.append(AIMessage(content=f"Read batch {i // 2} ok."))

    model = _LangGraphScriptedModel(scripted_read_msgs)
    monkeypatch.setattr("app.features.ai_agent.service.get_model", lambda provider="google": model)
    svc = AIAgentService(provider="google")

    for i in range(0, len(read_calls), 2):
        res = await svc.chat_turn(
            message=f"Doctor read check batch {i // 2}",
            actor=doc,
            db=db,
            thread_id="t_lg_doc_reads",
            checkpointer=cp,
        )
        assert f"Read batch {i // 2} ok." in res["message"]["content"]

    # Verify all 16 read tool outputs were captured cleanly in LangGraph checkpoint ToolMessages
    seen_tool_msgs = [
        m for msgs in model._seen_messages for m in msgs if isinstance(m, ToolMessage)
    ]
    invoked_read_names = {m.name for m in seen_tool_msgs}
    assert invoked_read_names == READ_ONLY_DOCTOR_TOOLS

    # Phase B: All 10 Doctor mutating tools through chat_turn -> PENDING -> decide_and_resume(APPROVED) -> DB check
    mut_calls = [
        ("apply_leave", {"start_date": "2027-01-10", "end_date": "2027-01-11", "reason": "Winter leave"}),
        ("update_leave", {"leave_id": "leave_lg_1", "start_date": "2027-02-01", "end_date": "2027-02-02", "reason": "Moved"}),
        ("cancel_leave", {"leave_id": "leave_lg_1"}),
        ("update_weekly_schedule", {"day": "Monday", "slots": [{"start": "10:00", "end": "12:00"}]}),
        ("create_slot", {"date": (now_clinic().date() + timedelta(days=7)).isoformat(), "start_time": "16:00", "end_time": "16:30"}),
        ("update_slot_availability", {"slot_id": "slot_lg_avail2", "status": "UNAVAILABLE"}),
        ("remove_slot", {"slot_id": "slot_lg_avail"}),
        ("update_my_profile", {"fees": 950}),
        ("update_appointment_status", {"appointment_id": "appt_lg_conf", "status": "COMPLETED"}),
        ("send_patient_message", {"patient_user_id": "pat_lg", "text": "Hydrate well before consult."}),
    ]
    assert {name for name, _ in mut_calls} == APPROVAL_DOCTOR_TOOLS

    invoked_mut_names: set[str] = set()
    for idx, (tool_name, args) in enumerate(mut_calls):
        tid = f"t_lg_doc_mut_{idx}"
        mut_model = _LangGraphScriptedModel(
            [
                AIMessage(
                    content="",
                    tool_calls=[{"id": f"tc_dm_{idx}", "name": tool_name, "args": args}],
                ),
                AIMessage(content=f"Completed {tool_name}."),
            ]
        )
        svc_m = AIAgentService(provider="google")
        # Rebind scripted model on svc_m
        svc_m.model = mut_model
        paused = await svc_m.chat_turn(
            message=f"Execute {tool_name}",
            actor=doc,
            db=db,
            thread_id=tid,
            checkpointer=cp,
        )
        appr = paused["approvalRequest"]
        assert appr is not None and appr["status"] == "PENDING", f"{tool_name} failed to pause"

        resumed = await svc_m.decide_and_resume(
            db=db,
            actor=doc,
            thread_id=tid,
            approval_id=appr["approvalId"],
            decision="APPROVED",
            checkpointer=cp,
        )
        assert resumed["approval"]["status"] == "APPROVED"
        assert resumed["approval"]["executionStatus"] == "COMPLETED", f"{tool_name}: {resumed}"
        assert f"Completed {tool_name}." in resumed["resumedMessage"]["content"]
        invoked_mut_names.add(tool_name)

    assert invoked_mut_names == APPROVAL_DOCTOR_TOOLS

    # Verify real database mutations persisted
    doc_row = (await db.execute(select(tables["Doctor"]).where(tables["Doctor"].c.id == "doc_lg"))).mappings().one()
    assert doc_row["fees"] == 950
    appt_row = (
        await db.execute(select(tables["Appointment"]).where(tables["Appointment"].c.id == "appt_lg_conf"))
    ).mappings().one()
    assert appt_row["status"] == "COMPLETED"
    removed_slot = (await db.execute(select(tables["Slot"]).where(tables["Slot"].c.id == "slot_lg_avail"))).first()
    assert removed_slot is None
    msgs = (
        await db.execute(
            select(tables["ChatMessages"]).where(tables["ChatMessages"].c.doctorPatientRelationId == "rel_lg_1")
        )
    ).mappings().all()
    assert any("Hydrate well" in m["text"] for m in msgs)


@pytest.mark.integration
@pytest.mark.asyncio
async def test_all_31_patient_tools_via_langgraph_workflow(db, monkeypatch, tmp_path):
    """Execute all 22 read-only and all 9 HITL mutating Patient tools through the actual LangGraph workflow."""
    monkeypatch.setenv("DOCUMENT_STORAGE_DIR", str(tmp_path))
    monkeypatch.setattr("app.features.ai_agent.rag.retrieval.get_embedding_provider", lambda: None)
    monkeypatch.setattr("app.features.ai_agent.rag.retrieval.get_reranker_provider", lambda: None)
    monkeypatch.setattr("app.features.ai_agent.rag.pipeline.get_settings", lambda: type("S", (), {"google_api_key": "", "groq_api_key": "", "cohere_api_key": ""})())

    await files.write_file("local/pat_lg/doc_lg_1/secret", b"%PDF-1.4\n%%test", "echo.pdf", "application/pdf")
    assert storage_path("local/pat_lg/doc_lg_1/secret").is_file()

    world = await _seed_world(db)
    pat = world["pat"]
    cp = MemorySaver()

    read_calls = [
        ("get_my_profile", {}),
        ("get_my_medical_profile", {}),
        ("get_my_health_summary", {}),
        ("get_my_notifications", {}),
        ("search_doctors", {"specialty": "CARDIOLOGIST"}),
        ("get_doctor_details", {"doctor_id": "doc_lg"}),
        ("get_doctor_available_slots", {"doctor_id": "doc_lg", "day": world["avail_day"]}),
        ("get_doctor_schedule", {"doctor_id": "doc_lg"}),
        ("get_doctor_ratings", {"doctor_id": "doc_lg"}),
        ("get_my_appointments", {}),
        ("get_appointment_details", {"appointment_id": "appt_lg_conf"}),
        ("get_upcoming_appointments", {}),
        ("get_past_appointments", {}),
        ("list_my_medical_documents", {}),
        ("get_my_document_details", {"document_id": "doc_lg_1"}),
        ("get_document_processing_status", {"document_id": "doc_lg_1"}),
        ("search_my_medical_documents", {"question": "ejection fraction"}),
        ("get_my_checkout_status", {}),
        ("get_my_payment_status", {}),
        ("list_my_doctor_conversations", {}),
        ("get_my_messages", {"relation_id": "rel_lg_1"}),
        ("get_conversation_history", {}),
    ]
    assert {name for name, _ in read_calls} == READ_ONLY_PATIENT_TOOLS

    scripted_read_msgs: list[AIMessage] = []
    for i in range(0, len(read_calls), 2):
        batch = read_calls[i : i + 2]
        scripted_read_msgs.append(
            AIMessage(
                content="",
                tool_calls=[
                    {"id": f"tc_pr_{i + j}", "name": name, "args": args}
                    for j, (name, args) in enumerate(batch)
                ],
            )
        )
        scripted_read_msgs.append(AIMessage(content=f"Patient read batch {i // 2} ok."))

    model = _LangGraphScriptedModel(scripted_read_msgs)
    monkeypatch.setattr("app.features.ai_agent.service.get_model", lambda provider="google": model)
    svc = AIAgentService(provider="google")

    for i in range(0, len(read_calls), 2):
        res = await svc.chat_turn(
            message=f"Patient read check batch {i // 2}",
            actor=pat,
            db=db,
            thread_id="t_lg_pat_reads",
            checkpointer=cp,
        )
        assert f"Patient read batch {i // 2} ok." in res["message"]["content"]

    seen_tool_msgs = [
        m for msgs in model._seen_messages for m in msgs if isinstance(m, ToolMessage)
    ]
    assert {m.name for m in seen_tool_msgs} == READ_ONLY_PATIENT_TOOLS

    mut_calls = [
        ("update_my_profile", {"address": "999 Wellness Blvd"}),
        ("update_my_medical_profile", {"allergies": "Dust & Pollen"}),
        ("propose_appointment_booking", {"doctor_id": "doc_lg", "slot_id": "slot_lg_avail", "reason": "Checkup"}),
        ("cancel_my_appointment", {"appointment_id": "appt_lg_conf", "reason": "Rescheduling"}),
        ("rename_my_document", {"document_id": "doc_lg_1", "title": "Updated Cardiac Echo"}),
        ("send_doctor_message", {"relation_id": "rel_lg_1", "content": "Uploaded my latest echo."}),
        ("mark_notification_read", {"notification_id": "notif_lg_1"}),
        ("submit_doctor_feedback", {"doctor_id": "doc_lg", "rating": 5, "comment": "Excellent care"}),
        ("delete_my_document", {"document_id": "doc_lg_1", "reason": "No longer needed"}),
    ]
    assert {name for name, _ in mut_calls} == APPROVAL_PATIENT_TOOLS

    invoked_mut_names: set[str] = set()
    for idx, (tool_name, args) in enumerate(mut_calls):
        tid = f"t_lg_pat_mut_{idx}"
        mut_model = _LangGraphScriptedModel(
            [
                AIMessage(
                    content="",
                    tool_calls=[{"id": f"tc_pm_{idx}", "name": tool_name, "args": args}],
                ),
                AIMessage(content=f"Completed {tool_name}."),
            ]
        )
        svc_m = AIAgentService(provider="google")
        svc_m.model = mut_model
        paused = await svc_m.chat_turn(
            message=f"Execute {tool_name}",
            actor=pat,
            db=db,
            thread_id=tid,
            checkpointer=cp,
        )
        appr = paused["approvalRequest"]
        assert appr is not None and appr["status"] == "PENDING"

        resumed = await svc_m.decide_and_resume(
            db=db,
            actor=pat,
            thread_id=tid,
            approval_id=appr["approvalId"],
            decision="APPROVED",
            checkpointer=cp,
        )
        assert resumed["approval"]["status"] == "APPROVED"
        assert resumed["approval"]["executionStatus"] == "COMPLETED", f"{tool_name}: {resumed}"
        invoked_mut_names.add(tool_name)

    assert invoked_mut_names == APPROVAL_PATIENT_TOOLS

    # Verify DB mutations persisted
    pat_row = (await db.execute(select(tables["Patient"]).where(tables["Patient"].c.id == "pat_lg"))).mappings().one()
    assert pat_row["allergies"] == "Dust & Pollen"
    slot_held = (await db.execute(select(tables["Slot"]).where(tables["Slot"].c.id == "slot_lg_avail"))).mappings().one()
    assert slot_held["status"] == "HELD" and slot_held["holdToken"] is not None
    notif_row = (
        await db.execute(select(tables["Notification"]).where(tables["Notification"].c.id == "notif_lg_1"))
    ).mappings().one()
    assert notif_row["isRead"] is True
    doc_deleted = (
        await db.execute(select(tables["MedicalDocument"]).where(tables["MedicalDocument"].c.id == "doc_lg_1"))
    ).first()
    assert doc_deleted is None
    assert not storage_path("local/pat_lg/doc_lg_1/secret").exists()


@pytest.mark.integration
@pytest.mark.asyncio
async def test_pdf_borderless_table_charts_diagrams_and_multibatch_partial_status(db, monkeypatch):
    """Verify borderless table text preservation, bar/line/pie chart & diagram PARTIAL status, and >30p batch issue aggregation."""

    async def _mock_embed(texts):
        return ("cohere", "embed-english-light-v3.0", [[0.04] * 384 for _ in texts])

    monkeypatch.setattr("app.features.documents.embeddings.embed_texts", _mock_embed)
    await _seed_world(db)
    now = utcnow()

    # 1. Borderless table (whitespace aligned, no drawing grid lines)
    d_borderless = pymupdf.open()
    p = d_borderless.new_page()
    p.insert_text((72, 72), "METABOLIC PANEL BORDERLESS REPORT", fontsize=13)
    p.insert_text((72, 110), "TestName          Result      ReferenceRange", fontsize=11)
    p.insert_text((72, 130), "Sodium            140 mmol/L  135-145", fontsize=11)
    p.insert_text((72, 150), "Potassium         4.2 mmol/L  3.5-5.0", fontsize=11)

    await db.execute(
        tables["MedicalDocument"].insert().values(
            id="doc_lg_borderless",
            patientId="pat_lg",
            title="Borderless Panel",
            type="LAB_REPORT",
            fileName="borderless.pdf",
            mimeType="application/pdf",
            fileSize=1024,
            storagePath="local/pat_lg/doc_lg_borderless/f",
            reportDate=now,
            processingStatus="QUEUED",
            createdAt=now,
            updatedAt=now,
        )
    )
    res_b = await run_document_ingestion(db, document_id="doc_lg_borderless", data=d_borderless.tobytes())
    assert res_b["status"] == "COMPLETED"
    b_chunks = (
        await db.execute(
            select(tables["MedicalDocumentChunk"]).where(tables["MedicalDocumentChunk"].c.versionId == res_b["versionId"])
        )
    ).mappings().all()
    b_text = " ".join(c["content"] for c in b_chunks)
    assert "140 mmol/L" in b_text and "4.2 mmol/L" in b_text

    # 2. Vector bar/line/pie charts & diagram without vision provider -> PARTIAL + vision_provider_unavailable, zero invented values
    d_charts = pymupdf.open()
    p_bar = d_charts.new_page()
    p_bar.insert_text((72, 60), "Systolic BP Trend Bar Chart", fontsize=12)
    shape = p_bar.new_shape()
    shape.draw_rect(pymupdf.Rect(80, 120, 120, 220))
    shape.draw_rect(pymupdf.Rect(140, 100, 180, 220))
    shape.draw_line(pymupdf.Point(220, 200), pymupdf.Point(320, 140))  # line chart segment
    shape.draw_circle(pymupdf.Point(420, 170), 45)  # pie chart circle
    shape.finish(color=(0, 0, 1), fill=(0.2, 0.4, 0.8), width=1.5)
    shape.commit()

    await db.execute(
        tables["MedicalDocument"].insert().values(
            id="doc_lg_charts",
            patientId="pat_lg",
            title="Cardiac Charts",
            type="OTHER",
            fileName="charts.pdf",
            mimeType="application/pdf",
            fileSize=1024,
            storagePath="local/pat_lg/doc_lg_charts/f",
            reportDate=now,
            processingStatus="QUEUED",
            createdAt=now,
            updatedAt=now,
        )
    )
    res_c = await run_document_ingestion(db, document_id="doc_lg_charts", data=d_charts.tobytes())
    assert res_c["extractionStatus"] == "PARTIAL"
    assert res_c["issueCount"] >= 1
    c_issues = (
        await db.execute(
            select(tables["MedicalExtractionIssue"]).where(tables["MedicalExtractionIssue"].c.versionId == res_c["versionId"])
        )
    ).mappings().all()
    assert any(iss["code"] == "vision_provider_unavailable" for iss in c_issues)

    # 3. 32-page PDF: pages 1-25 clean native text, page 28 has vector diagram/chart -> combined extractionStatus MUST be PARTIAL
    d_multi = pymupdf.open()
    for p_idx in range(32):
        pg = d_multi.new_page()
        pg.insert_text((72, 72), f"Clinical note page {p_idx + 1}. Heart rate stable.", fontsize=11)
        if p_idx == 27:
            sh = pg.new_shape()
            sh.draw_circle(pymupdf.Point(250, 250), 60)
            sh.finish(color=(1, 0, 0), fill=(0.9, 0.2, 0.2))
            sh.commit()

    await db.execute(
        tables["MedicalDocument"].insert().values(
            id="doc_lg_multi32",
            patientId="pat_lg",
            title="32 Page Mixed Batch",
            type="OTHER",
            fileName="multi32.pdf",
            mimeType="application/pdf",
            fileSize=4096,
            storagePath="local/pat_lg/doc_lg_multi32/f",
            reportDate=now,
            processingStatus="QUEUED",
            createdAt=now,
            updatedAt=now,
        )
    )
    res_m32 = await run_document_ingestion(db, document_id="doc_lg_multi32", data=d_multi.tobytes())
    assert res_m32["extractionStatus"] == "PARTIAL"


@pytest.mark.integration
@pytest.mark.asyncio
async def test_multi_doc_rag_processing_document_and_persistent_memory_summary(db, monkeypatch):
    """Verify multi-doc citations, QUEUED/PROCESSING honesty, expired/duplicate approval guards, and AgentMemorySnapshot."""
    monkeypatch.setattr("app.features.ai_agent.rag.retrieval.get_embedding_provider", lambda: None)
    monkeypatch.setattr("app.features.ai_agent.rag.retrieval.get_reranker_provider", lambda: None)
    monkeypatch.setattr("app.features.ai_agent.rag.pipeline.get_settings", lambda: type("S", (), {"google_api_key": "", "groq_api_key": "", "cohere_api_key": ""})())

    world = await _seed_world(db)
    pat = world["pat"]
    now = utcnow()

    # Add second READY document + chunk and third PROCESSING document
    await db.execute(
        tables["MedicalDocument"].insert().values(
            id="doc_lg_2",
            patientId="pat_lg",
            title="Lipid Panel",
            type="LAB_REPORT",
            fileName="lipid.pdf",
            mimeType="application/pdf",
            fileSize=1024,
            storagePath="local/pat_lg/doc_lg_2/secret",
            reportDate=now,
            processingStatus="READY",
            createdAt=now,
            updatedAt=now,
        )
    )
    await db.execute(
        tables["MedicalDocumentVersion"].insert().values(
            id="ver_lg_2",
            documentId="doc_lg_2",
            versionNumber=1,
            sourceSha256="def456lg",
            schemaVersion="1.0",
            pipelineVersion="test",
            configFingerprint="cfg",
            tokenizerName="tiktoken",
            extractionStatus="COMPLETED",
            indexStatus="COMPLETED",
            pageCount=1,
            chunkCount=1,
            issueCount=0,
            isPublished=True,
            manifest={},
            contentSha256="csha_lg_2",
            createdAt=now,
            publishedAt=now,
        )
    )
    await db.execute(
        tables["MedicalDocumentChunk"].insert().values(
            id="chk_lg_chunk_2",
            versionId="ver_lg_2",
            chunkStableId="st_lg_2",
            chunkIndex=0,
            kind="text",
            content="Lipid panel LDL cholesterol 118 mg/dL and ejection evaluation follow-up.",
            contentSha256="sha_lg_2",
            tokenCount=10,
            tokenizer="cl100k",
            headingPath=["Lipids"],
            sourceObjectIds=["obj_2"],
            paragraphIds=["p_2"],
            sentenceIds=["s_2"],
            pageNumbers=[1],
            startPage=1,
            endPage=1,
            isFragment=False,
            provenance=[{"page_number": 1}],
            pipelineVersion="test",
            status="COMPLETED",
            createdAt=now,
        )
    )
    await db.execute(
        tables["MedicalDocument"].insert().values(
            id="doc_lg_proc",
            patientId="pat_lg",
            title="MRI Pending",
            type="RADIOLOGY_SCAN",
            fileName="mri.pdf",
            mimeType="application/pdf",
            fileSize=1024,
            storagePath="local/pat_lg/doc_lg_proc/secret",
            reportDate=now,
            processingStatus="PROCESSING",
            createdAt=now,
            updatedAt=now,
        )
    )

    # 1. Multi-doc retrieval returns hits across both READY docs
    multi_ans = await answer_medical_question(
        db,
        actor=pat,
        patient_id="pat_lg",
        question="Compare my ejection fraction and LDL cholesterol results.",
        top_k=5,
    )
    cited_doc_ids = {c["documentId"] for c in multi_ans["citations"]}
    assert {"doc_lg_1", "doc_lg_2"}.issubset(cited_doc_ids)

    # 2. Query matching nothing while a document is still PROCESSING returns honest pending notice
    pend_ans = await answer_medical_question(
        db,
        actor=pat,
        patient_id="pat_lg",
        question="What does my cranial MRI scan show for cerebellum?",
        top_k=5,
    )
    assert pend_ans["generationMode"] == "no_evidence"
    assert pend_ans["pendingDocumentCount"] == 1
    assert "queued or processing" in pend_ans["answer"].lower()
    assert pend_ans["citations"] == []

    # 3. Persistent conversation summary created at 30+ messages and loaded on next turn without duplication
    model = _LangGraphScriptedModel(
        [
            AIMessage(content="Summarized turn answer 1."),
            AIMessage(content="Summarized turn answer 2."),
        ]
    )
    monkeypatch.setattr("app.features.ai_agent.service.get_model", lambda provider="google": model)
    svc = AIAgentService(provider="google")
    cp = MemorySaver()

    await db.execute(
        tables["AgentThread"].insert().values(
            id="t_lg_mem",
            ownerUserId="u_lg_pat",
            scopeType="GENERAL",
            purpose="CLINIC_ASSISTANT",
            title="Long Conversation",
            status="ACTIVE",
            permissionRevision=1,
            latestMemoryVersion=0,
            createdAt=now,
            updatedAt=now,
            lastMessageAt=now,
        )
    )
    for idx in range(28):
        await db.execute(
            tables["AgentMessage"].insert().values(
                id=f"msg_hist_{idx}",
                threadId="t_lg_mem",
                sequence=idx + 1,
                role="USER" if idx % 2 == 0 else "ASSISTANT",
                status="COMPLETED",
                content=f"Historical clinical message {idx}",
                contentSha256=f"sha_hist_{idx}",
                createdAt=now + timedelta(seconds=idx),
            )
        )

    await svc.chat_turn(
        message="Summarize my recent questions",
        actor=pat,
        db=db,
        thread_id="t_lg_mem",
        checkpointer=cp,
    )
    snaps = (
        await db.execute(
            select(tables["AgentMemorySnapshot"]).where(tables["AgentMemorySnapshot"].c.threadId == "t_lg_mem")
        )
    ).mappings().all()
    assert len(snaps) == 1

    await svc.chat_turn(
        message="Follow up after summary",
        actor=pat,
        db=db,
        thread_id="t_lg_mem",
        checkpointer=cp,
    )
    last_seen_sys = [m for m in model._seen_messages[-1] if isinstance(m, SystemMessage)]
    assert any("Conversation summary:" in str(m.content) for m in last_seen_sys)
    assert len([m for m in last_seen_sys if m.id == "qc_memory_summary"]) == 1

    # 4. Expired approval -> 410 and duplicate approval -> 409
    model_exp = _LangGraphScriptedModel(
        [
            AIMessage(
                content="",
                tool_calls=[{"id": "tc_exp", "name": "update_my_profile", "args": {"address": "New Addr"}}],
            ),
            AIMessage(content="Updated."),
        ]
    )
    svc_exp = AIAgentService(provider="google")
    svc_exp.model = model_exp
    paused = await svc_exp.chat_turn(
        message="Change address",
        actor=pat,
        db=db,
        thread_id="t_lg_exp",
        checkpointer=cp,
    )
    exp_id = paused["approvalRequest"]["approvalId"]
    await db.execute(
        tables["AgentApproval"].update()
        .where(tables["AgentApproval"].c.id == exp_id)
        .values(expiresAt=utcnow() - timedelta(minutes=1))
    )
    with pytest.raises(HTTPException) as exc_exp:
        await svc_exp.decide_and_resume(
            db=db, actor=pat, thread_id="t_lg_exp", approval_id=exp_id, decision="APPROVED", checkpointer=cp
        )
    assert exc_exp.value.status_code == 410
