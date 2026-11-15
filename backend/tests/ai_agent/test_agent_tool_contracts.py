"""Comprehensive contract, authorization, and HITL regression tests for all Doctor & Patient Agent tools."""

from __future__ import annotations

import json
from datetime import timedelta

import pytest
from fastapi import HTTPException
from langchain_core.messages import AIMessage
from langgraph.checkpoint.memory import MemorySaver
from sqlalchemy import select

from app.core.clock import now_clinic
from app.features.ai_agent.approval_resume import decide_and_resume_approval
from app.features.ai_agent.graph.workflow import build_workflow
from app.features.ai_agent.hitl_bridge import build_hitl_callbacks
from app.features.ai_agent.persistence.approvals import create_or_get_approval, decide_approval
from app.features.ai_agent.persistence.threads import append_message, append_turn, create_or_get_thread
from app.features.ai_agent.tools.doctor import build_doctor_tools
from app.features.ai_agent.tools.doctor_executor import execute_approved_doctor_action
from app.features.ai_agent.tools.patient import build_patient_tools
from app.features.ai_agent.tools.patient_executor import execute_approved_patient_action
from app.infrastructure.database import tables, utcnow


async def _seed_clinic_world(db) -> dict:
    now = utcnow()
    today = now_clinic().date()
    past_start = now - timedelta(days=2)
    past_end = past_start + timedelta(minutes=30)
    future_start = now + timedelta(days=2)
    future_end = future_start + timedelta(minutes=30)
    future_avail_start = now + timedelta(days=3)
    future_avail_end = future_avail_start + timedelta(minutes=30)

    await db.execute(tables["Location"].insert().values(pincode=560001, city="Bengaluru", state="KA"))

    users = [
        ("u_pat_a", "PATIENT", "Alice Sharma", "pat_a@example.com"),
        ("u_pat_b", "PATIENT", "Bob Nair", "pat_b@example.com"),
        ("u_doc_a", "DOCTOR", "Dr. Priya Rao", "doc_a@example.com"),
        ("u_doc_b", "DOCTOR", "Dr. Vikram Sen", "doc_b@example.com"),
    ]
    for uid, role, name, email in users:
        await db.execute(
            tables["User"].insert().values(
                id=uid,
                email=email,
                phoneNo="9999999999",
                name=name,
                password="hash",
                age=32,
                gender="FEMALE" if "Alice" in name or "Priya" in name else "MALE",
                role=role,
                address="123 MG Road",
                pinCode=560001,
                emailVerified=True,
                isActive=True,
                createdAt=now,
                updatedAt=now,
            )
        )

    await db.execute(
        tables["Patient"].insert().values(
            id="pat_a",
            userId="u_pat_a",
            medicalHistory="Mild asthma",
            allergies="Pollen",
            currentMedications="Albuterol",
            createdAt=now,
            updatedAt=now,
        )
    )
    await db.execute(
        tables["Patient"].insert().values(
            id="pat_b",
            userId="u_pat_b",
            medicalHistory="Migraine",
            allergies="None",
            currentMedications="Sumatriptan",
            createdAt=now,
            updatedAt=now,
        )
    )
    await db.execute(
        tables["Doctor"].insert().values(
            id="doc_a",
            userId="u_doc_a",
            specialty="CARDIOLOGIST",
            experience=10,
            fees=800,
            doctorBio="Senior cardiologist",
            balance=2500,
            isReleaseFixture=False,
            createdAt=now,
            updatedAt=now,
        )
    )
    await db.execute(
        tables["Doctor"].insert().values(
            id="doc_b",
            userId="u_doc_b",
            specialty="DERMATOLOGIST",
            experience=6,
            fees=500,
            doctorBio="Skin specialist",
            balance=1000,
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
            id="sched_doc_a", doctorId="doc_a", weeklySchedule=weekly, createdAt=now, updatedAt=now
        )
    )
    await db.execute(
        tables["Leave"].insert().values(
            id="leave_doc_a_1",
            doctorId="doc_a",
            reason="Conference",
            startDate=now + timedelta(days=10),
            endDate=now + timedelta(days=11),
            applyAt=now,
        )
    )

    slots = [
        ("slot_past_a", "doc_a", past_start.date(), past_start, past_end, "UNAVAILABLE"),
        ("slot_future_conf_a", "doc_a", future_start.date(), future_start, future_end, "BOOKED"),
        (
            "slot_future_canc_a",
            "doc_a",
            (future_start + timedelta(hours=1)).date(),
            future_start + timedelta(hours=1),
            future_end + timedelta(hours=1),
            "AVAILABLE",
        ),
        ("slot_avail_a", "doc_a", future_avail_start.date(), future_avail_start, future_avail_end, "AVAILABLE"),
        (
            "slot_other_b",
            "doc_a",
            (future_avail_start + timedelta(hours=2)).date(),
            future_avail_start + timedelta(hours=2),
            future_avail_end + timedelta(hours=2),
            "BOOKED",
        ),
    ]
    for sid, did, dt, st, et, status in slots:
        await db.execute(
            tables["Slot"].insert().values(
                id=sid, doctorId=did, date=dt, startTime=st, endTime=et, status=status, createdAt=now, updatedAt=now
            )
        )

    await db.execute(
        tables["Payment"].insert().values(
            id="pay_a_1",
            idempotencyKey="pay_idem_1",
            amount=800,
            currency="INR",
            userId="u_pat_a",
            doctorId="doc_a",
            slotId="slot_future_conf_a",
            status="SUCCESS",
            razorpayOrderId="order_a_1",
            razorpayPaymentId="rzp_pay_1",
            attempts=1,
            createdAt=now,
            updatedAt=now,
        )
    )
    await db.execute(
        tables["Checkout"].insert().values(
            id="chk_a_1",
            idempotencyKey="chk_idem_1",
            userId="u_pat_a",
            patientId="pat_a",
            doctorId="doc_a",
            slotId="slot_future_conf_a",
            holdToken="hold_tok_existing",
            paymentMethod="ONLINE",
            amount=800,
            currency="INR",
            status="CONFIRMED",
            razorpayOrderId="order_a_1",
            expiresAt=now + timedelta(minutes=10),
            paymentId="pay_a_1",
            attempts=1,
            createdAt=now,
            updatedAt=now,
        )
    )

    appts = [
        ("appt_past_a", "doc_a", "pat_a", "slot_past_a", None, "COMPLETED", "OFFLINE"),
        ("appt_future_a", "doc_a", "pat_a", "slot_future_conf_a", "pay_a_1", "CONFIRMED", "ONLINE"),
        ("appt_canc_a", "doc_a", "pat_a", "slot_future_canc_a", None, "CANCELLED", "OFFLINE"),
        ("appt_other_b", "doc_a", "pat_b", "slot_other_b", None, "CONFIRMED", "OFFLINE"),
    ]
    for aid, did, pid, sid, payid, status, pm in appts:
        await db.execute(
            tables["Appointment"].insert().values(
                id=aid,
                doctorId=did,
                patientId=pid,
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
            id="notif_a_1",
            userId="u_pat_a",
            message="Appointment confirmed",
            isRead=False,
            status="SENT",
            createdAt=now,
        )
    )
    await db.execute(
        tables["DoctorPatientRelation"].insert().values(
            id="rel_a_1", doctorsUserId="u_doc_a", patientsUserId="u_pat_a", updatedAt=now, createdAt=now
        )
    )
    await db.execute(
        tables["ChatMessages"].insert().values(
            id="msg_seed_1",
            doctorPatientRelationId="rel_a_1",
            senderId="u_doc_a",
            text="Please bring prior echo results.",
            createdAt=now,
        )
    )
    await db.execute(
        tables["MedicalDocument"].insert().values(
            id="doc_med_a_1",
            patientId="pat_a",
            title="Echo Report",
            type="RADIOLOGY_SCAN",
            fileName="echo.pdf",
            mimeType="application/pdf",
            fileSize=1024,
            storagePath="local/pat_a/doc_med_a_1/secretkey",
            reportDate=now,
            processingStatus="READY",
            createdAt=now,
            updatedAt=now,
        )
    )
    await db.execute(
        tables["MedicalDocument"].insert().values(
            id="doc_med_b_secret",
            patientId="pat_b",
            title="Bob Secret Scan",
            type="LAB_REPORT",
            fileName="bob.pdf",
            mimeType="application/pdf",
            fileSize=512,
            storagePath="local/pat_b/doc_med_b_secret/secretkey",
            reportDate=now,
            processingStatus="READY",
            createdAt=now,
            updatedAt=now,
        )
    )
    await db.execute(
        tables["MedicalDocumentVersion"].insert().values(
            id="ver_med_a_1",
            documentId="doc_med_a_1",
            versionNumber=1,
            sourceSha256="sha_a",
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
            contentSha256="csha_a",
            createdAt=now,
            publishedAt=now,
        )
    )
    await db.execute(
        tables["MedicalDocumentChunk"].insert().values(
            id="chk_med_a_1",
            versionId="ver_med_a_1",
            chunkStableId="cs_a_1",
            chunkIndex=0,
            kind="text",
            content="Echocardiogram ejection fraction 62 percent normal valve function.",
            contentSha256="hash_echo",
            tokenCount=10,
            tokenizer="tiktoken",
            sourceObjectIds=[],
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
        "today": today,
        "future_avail_day": future_avail_start.date(),
        "pat_a": {"id": "u_pat_a", "role": "PATIENT", "isActive": True, "name": "Alice Sharma"},
        "pat_b": {"id": "u_pat_b", "role": "PATIENT", "isActive": True, "name": "Bob Nair"},
        "doc_a": {"id": "u_doc_a", "role": "DOCTOR", "isActive": True, "name": "Dr. Priya Rao"},
        "doc_b": {"id": "u_doc_b", "role": "DOCTOR", "isActive": True, "name": "Dr. Vikram Sen"},
    }


@pytest.mark.integration
@pytest.mark.asyncio
async def test_all_patient_read_tools_contracts_and_isolation(db, monkeypatch):
    monkeypatch.setattr("app.features.ai_agent.rag.retrieval.get_embedding_provider", lambda: None)
    monkeypatch.setattr("app.features.ai_agent.rag.retrieval.get_reranker_provider", lambda: None)
    world = await _seed_clinic_world(db)
    pat_a = world["pat_a"]
    thread = await create_or_get_thread(db, actor=pat_a, thread_id="t_pat_all_reads")
    await append_message(db, thread_id=thread["id"], turn_id=None, role="USER", content="Hello")

    tools = {
        t.name: t
        for t in build_patient_tools(
            db=db,
            actor=pat_a,
            reference_date=world["today"],
            thread_id=thread["id"],
            turn_id=None,
            include_mutations=True,
        )
    }

    expected_read = {
        "get_my_profile",
        "get_my_medical_profile",
        "get_my_health_summary",
        "get_my_notifications",
        "search_doctors",
        "get_doctor_details",
        "get_doctor_available_slots",
        "get_doctor_schedule",
        "get_doctor_ratings",
        "get_my_appointments",
        "get_appointment_details",
        "get_upcoming_appointments",
        "get_past_appointments",
        "list_my_medical_documents",
        "get_my_document_details",
        "get_document_processing_status",
        "search_my_medical_documents",
        "get_my_checkout_status",
        "get_my_payment_status",
        "list_my_doctor_conversations",
        "get_my_messages",
        "get_conversation_history",
    }
    assert expected_read.issubset(set(tools.keys()))

    # 1. Profile, medical profile, health summary, notifications
    prof = json.loads(await tools["get_my_profile"].ainvoke({}))
    assert prof["id"] == "u_pat_a"
    med = json.loads(await tools["get_my_medical_profile"].ainvoke({}))
    assert med["patient"]["medicalHistory"] == "Mild asthma"
    stats = json.loads(await tools["get_my_health_summary"].ainvoke({}))
    assert "completedAppointments" in stats
    notifs = json.loads(await tools["get_my_notifications"].ainvoke({}))
    assert any(n["id"] == "notif_a_1" for n in notifs)

    # 2. Doctor search (Bug #4 fix: `name` filter works!)
    doc_search = json.loads(await tools["search_doctors"].ainvoke({"name": "Priya"}))
    assert len(doc_search) == 1
    assert doc_search[0]["id"] == "doc_a"
    assert json.loads(await tools["search_doctors"].ainvoke({"name": "NonExistent"})) == []

    # 3. Doctor details, schedule, ratings, and available slots (tuple unpack fix!)
    doc_det = json.loads(await tools["get_doctor_details"].ainvoke({"doctor_id": "doc_a"}))
    assert doc_det["doctor"]["id"] == "doc_a"
    sched = json.loads(await tools["get_doctor_schedule"].ainvoke({"doctor_id": "doc_a"}))
    assert "weeklySchedule" in sched
    ratings = json.loads(await tools["get_doctor_ratings"].ainvoke({"doctor_id": "doc_a"}))
    assert "summary" in ratings and "comments" in ratings
    avail = json.loads(
        await tools["get_doctor_available_slots"].ainvoke(
            {"doctor_id": "doc_a", "date_str": world["future_avail_day"].isoformat()}
        )
    )
    assert any(s["id"] == "slot_avail_a" for s in avail["slots"])

    # 4. Appointments (Bugs #1, #2, #5 fixes: role string, tuple unpack, real date filtering)
    all_appts = json.loads(await tools["get_my_appointments"].ainvoke({"status": "CONFIRMED", "limit": 10}))
    assert [a["id"] for a in all_appts] == ["appt_future_a"]

    appt_det = json.loads(await tools["get_appointment_details"].ainvoke({"appointment_id": "appt_future_a"}))
    assert appt_det["appointment"]["id"] == "appt_future_a"

    with pytest.raises(HTTPException) as exc:
        await tools["get_appointment_details"].ainvoke({"appointment_id": "appt_other_b"})
    assert exc.value.status_code == 404

    upcoming = json.loads(await tools["get_upcoming_appointments"].ainvoke({"limit": 10}))
    upcoming_ids = [a["id"] for a in upcoming]
    assert "appt_future_a" in upcoming_ids
    assert "appt_past_a" not in upcoming_ids
    assert "appt_canc_a" not in upcoming_ids

    past = json.loads(await tools["get_past_appointments"].ainvoke({"limit": 10}))
    past_ids = [a["id"] for a in past]
    assert "appt_past_a" in past_ids
    assert "appt_future_a" not in past_ids

    # 5. Documents & RAG & Checkout/Payment & Messaging & Thread History
    docs = json.loads(await tools["list_my_medical_documents"].ainvoke({}))
    assert len(docs["documents"]) == 1
    assert "storagePath" not in docs["documents"][0]

    with pytest.raises(HTTPException) as exc_doc:
        await tools["get_my_document_details"].ainvoke({"document_id": "doc_med_b_secret"})
    assert exc_doc.value.status_code == 404

    doc_det = json.loads(await tools["get_my_document_details"].ainvoke({"document_id": "doc_med_a_1"}))
    assert doc_det["document"]["id"] == "doc_med_a_1"
    proc = json.loads(await tools["get_document_processing_status"].ainvoke({"document_id": "doc_med_a_1"}))
    assert proc["processingStatus"] == "READY"
    rag = json.loads(await tools["search_my_medical_documents"].ainvoke({"query": "ejection fraction"}))
    assert "62" in rag["answer"]
    assert rag["citations"][0]["documentId"] == "doc_med_a_1"

    chk = json.loads(await tools["get_my_checkout_status"].ainvoke({"checkout_id": "chk_a_1"}))
    assert chk["status"] == "CONFIRMED"
    pay = json.loads(await tools["get_my_payment_status"].ainvoke({"order_id": "order_a_1"}))
    assert pay["status"] == "CONFIRMED"
    assert pay["paymentStatus"]["orderId"] == "order_a_1"

    convs = json.loads(await tools["list_my_doctor_conversations"].ainvoke({}))
    assert convs["relations"][0]["id"] == "rel_a_1"
    msgs = json.loads(await tools["get_my_messages"].ainvoke({"relation_id": "rel_a_1"}))
    assert msgs["chats"][0]["id"] == "msg_seed_1"
    hist = json.loads(await tools["get_conversation_history"].ainvoke({"limit": 10}))
    assert hist["messages"][0]["content"] == "Hello"

    # Mutating tools NEVER execute directly when called by the LLM
    direct_msg = await tools["propose_appointment_booking"].ainvoke(
        {"doctor_id": "doc_a", "slot_id": "slot_avail_a", "reason": "Checkup"}
    )
    assert "requires confirmed human approval" in direct_msg


@pytest.mark.integration
@pytest.mark.asyncio
async def test_all_patient_mutating_executors_and_authorization(db, monkeypatch, tmp_path):
    monkeypatch.setenv("DOCUMENT_STORAGE_DIR", str(tmp_path))
    from app.features.documents import files

    world = await _seed_clinic_world(db)
    await files.write_file("local/pat_a/doc_med_a_1/secretkey", b"%PDF-1.4\n%", "echo.pdf", "application/pdf")
    pat_a = world["pat_a"]
    pat_b = world["pat_b"]

    # 1. UPDATE_PATIENT_ACCOUNT
    code, res = await execute_approved_patient_action(
        db, actor=pat_a, action_type="UPDATE_PATIENT_ACCOUNT", parameters={"name": "Alice S. Updated"}, approval_id="ap_1"
    )
    assert code == "PROFILE_UPDATED"
    assert res["user"]["name"] == "Alice S. Updated"

    # 2. UPDATE_MEDICAL_PROFILE
    code, res = await execute_approved_patient_action(
        db, actor=pat_a, action_type="UPDATE_MEDICAL_PROFILE", parameters={"allergies": "Peanuts"}, approval_id="ap_2"
    )
    assert code == "MEDICAL_PROFILE_UPDATED"
    assert res["patient"]["allergies"] == "Peanuts"

    # 3. PROPOSE_BOOKING (Bug #3 fix: holdToken populated!)
    code, res = await execute_approved_patient_action(
        db,
        actor=pat_a,
        action_type="PROPOSE_BOOKING",
        parameters={"doctor_id": "doc_a", "slot_id": "slot_avail_a"},
        approval_id="ap_3",
    )
    assert code == "BOOKING_HOLD_CREATED"
    assert res["checkoutHandoff"]["holdToken"]
    assert res["hold"]["holdToken"] == res["checkoutHandoff"]["holdToken"]

    # Duplicate hold by another patient fails 409
    with pytest.raises(HTTPException) as exc_hold:
        await execute_approved_patient_action(
            db,
            actor=pat_b,
            action_type="PROPOSE_BOOKING",
            parameters={"doctor_id": "doc_a", "slot_id": "slot_avail_a"},
            approval_id="ap_3b",
        )
    assert exc_hold.value.status_code == 409

    # 4. CANCEL_PATIENT_APPOINTMENT (Bugs #1 & #2 fix + ownership check)
    with pytest.raises(HTTPException) as exc_canc:
        await execute_approved_patient_action(
            db,
            actor=pat_b,
            action_type="CANCEL_PATIENT_APPOINTMENT",
            parameters={"appointment_id": "appt_future_a"},
            approval_id="ap_4_unauth",
        )
    assert exc_canc.value.status_code == 404

    code, res = await execute_approved_patient_action(
        db,
        actor=pat_a,
        action_type="CANCEL_PATIENT_APPOINTMENT",
        parameters={"appointment_id": "appt_future_a"},
        approval_id="ap_4",
    )
    assert code == "APPOINTMENT_CANCELLED"
    assert res["appointment"]["status"] == "CANCELLED"

    # 5. SEND_DOCTOR_MESSAGE (Bug #6 fix + idempotent duplicate handling)
    code, res = await execute_approved_patient_action(
        db,
        actor=pat_a,
        action_type="SEND_DOCTOR_MESSAGE",
        parameters={"relation_id": "rel_a_1", "content": "Thank you doctor"},
        approval_id="ap_5",
    )
    assert code == "MESSAGE_SENT"
    assert res["message"]["text"] == "Thank you doctor"
    assert res["duplicate"] is False

    # Same approval_id replayed -> idempotent duplicate=True
    code_dup, res_dup = await execute_approved_patient_action(
        db,
        actor=pat_a,
        action_type="SEND_DOCTOR_MESSAGE",
        parameters={"relation_id": "rel_a_1", "content": "Thank you doctor"},
        approval_id="ap_5",
    )
    assert code_dup == "MESSAGE_SENT"
    assert res_dup["duplicate"] is True

    # Unauthorized patient cannot message rel_a_1
    with pytest.raises(HTTPException) as exc_msg:
        await execute_approved_patient_action(
            db,
            actor=pat_b,
            action_type="SEND_DOCTOR_MESSAGE",
            parameters={"relation_id": "rel_a_1", "content": "Hi"},
            approval_id="ap_5_unauth",
        )
    assert exc_msg.value.status_code == 403

    # 6. MARK_NOTIFICATION_READ
    code, res = await execute_approved_patient_action(
        db, actor=pat_a, action_type="MARK_NOTIFICATION_READ", parameters={"notification_id": "notif_a_1"}, approval_id="ap_6"
    )
    assert code == "NOTIFICATION_MARKED_READ"

    # 7. SUBMIT_DOCTOR_FEEDBACK (fixed `text` payload + requires rating/comment + eligible completed appt)
    with pytest.raises(HTTPException) as exc_empty:
        await execute_approved_patient_action(
            db, actor=pat_a, action_type="SUBMIT_DOCTOR_FEEDBACK", parameters={"doctor_id": "doc_a"}, approval_id="ap_7e"
        )
    assert exc_empty.value.status_code == 400

    with pytest.raises(HTTPException) as exc_inelig:
        await execute_approved_patient_action(
            db, actor=pat_a, action_type="SUBMIT_DOCTOR_FEEDBACK", parameters={"doctor_id": "doc_b", "rating": 5}, approval_id="ap_7i"
        )
    assert exc_inelig.value.status_code == 403

    code, res = await execute_approved_patient_action(
        db,
        actor=pat_a,
        action_type="SUBMIT_DOCTOR_FEEDBACK",
        parameters={"doctor_id": "doc_a", "rating": 5, "comment": "Very clear explanation."},
        approval_id="ap_7",
    )
    assert code == "FEEDBACK_SUBMITTED"
    assert res["comment"]["comment"]["text"] == "Very clear explanation."

    # 8. RENAME_DOCUMENT & DELETE_DOCUMENT
    code, res = await execute_approved_patient_action(
        db,
        actor=pat_a,
        action_type="RENAME_DOCUMENT",
        parameters={"document_id": "doc_med_a_1", "title": "Renamed Echo Report"},
        approval_id="ap_8",
    )
    assert code == "DOCUMENT_RENAMED"
    code, _ = await execute_approved_patient_action(
        db,
        actor=pat_a,
        action_type="DELETE_DOCUMENT",
        parameters={"document_id": "doc_med_a_1"},
        approval_id="ap_9",
    )
    assert code == "DOCUMENT_DELETED"


@pytest.mark.integration
@pytest.mark.asyncio
async def test_all_doctor_read_and_mutating_tools(db, monkeypatch):
    monkeypatch.setattr("app.features.ai_agent.rag.retrieval.get_embedding_provider", lambda: None)
    monkeypatch.setattr("app.features.ai_agent.rag.retrieval.get_reranker_provider", lambda: None)
    world = await _seed_clinic_world(db)
    doc_a = world["doc_a"]
    doc_b = world["doc_b"]
    thread = await create_or_get_thread(db, actor=doc_a, thread_id="t_doc_all")
    await append_message(db, thread_id=thread["id"], turn_id=None, role="USER", content="Check schedule")

    tools = {
        t.name: t
        for t in build_doctor_tools(
            db=db,
            actor=doc_a,
            reference_date=world["today"],
            thread_id=thread["id"],
            turn_id=None,
            include_mutations=True,
        )
    }

    # Verify all 16 read tools
    assert (await tools["get_my_profile"].ainvoke({}))["specialty"] == "CARDIOLOGIST"
    assert "weekly_schedule" in (await tools["get_my_weekly_schedule"].ainvoke({}))
    assert len((await tools["get_my_leaves"].ainvoke({}))["leaves"]) == 1
    assert "balance_rupees" in (await tools["get_my_balance"].ainvoke({}))
    assert "activePatients" in (await tools["get_my_statistics"].ainvoke({}))
    assert "total_earnings_rupees" in (await tools["get_my_earnings_summary"].ainvoke({}))
    consult = await tools["get_my_consultation_slots"].ainvoke({"day": world["future_avail_day"].isoformat()})
    assert consult["type"] == "CONSULTATION_SLOTS"
    free = await tools["get_my_free_slots"].ainvoke({"day": world["future_avail_day"].isoformat()})
    assert "slots" in free or "free_slots" in free or free.get("type") == "FREE_SLOTS"
    assert len((await tools["get_my_appointments"].ainvoke({}))["appointments"]) >= 1
    assert "appointment" in (await tools["get_appointment_details"].ainvoke({"appointment_id": "appt_future_a"}))
    assert len((await tools["list_my_patients"].ainvoke({}))["patients"]) == 2
    assert (await tools["get_patient_info"].ainvoke({"patient_id": "pat_a"}))["patient"]["patientId"] == "pat_a"
    assert len((await tools["get_patient_appointment_history"].ainvoke({"patient_id": "pat_a"}))["appointments"]) >= 2
    assert len((await tools["list_patient_medical_documents"].ainvoke({"patient_id": "pat_a"}))["documents"]) == 1
    rag = await tools["query_patient_medical_documents"].ainvoke({"patient_id": "pat_a", "question": "ejection fraction"})
    assert "62" in rag["answer"]
    assert (await tools["get_conversation_history"].ainvoke({}))["count"] == 1

    # Unauthorized doctor B cannot read pat_a records
    tools_b = {t.name: t for t in build_doctor_tools(db=db, actor=doc_b, reference_date=world["today"])}
    with pytest.raises(HTTPException) as exc_unauth:
        await tools_b["get_patient_info"].ainvoke({"patient_id": "pat_a"})
    assert exc_unauth.value.status_code == 403

    # Direct mutating tool blocked without HITL
    with pytest.raises(RuntimeError, match="human approval"):
        await tools["apply_leave"].ainvoke(
            {"start_date": "2026-12-20", "end_date": "2026-12-21", "reason": "Vacation"}
        )

    # All 10 Doctor mutating executors
    c_leave, r_leave = await execute_approved_doctor_action(
        db,
        actor=doc_a,
        action_type="APPLY_LEAVE",
        parameters={"start_date": "2026-12-20", "end_date": "2026-12-21", "reason": "Vacation"},
        approval_id="dap_1",
    )
    assert c_leave == "APPLY_LEAVE_OK"
    assert r_leave["leaveId"] is not None

    c_upd_l, _ = await execute_approved_doctor_action(
        db,
        actor=doc_a,
        action_type="UPDATE_LEAVE",
        parameters={
            "leave_id": r_leave["leaveId"],
            "start_date": "2026-12-22",
            "end_date": "2026-12-23",
            "reason": "Updated",
        },
        approval_id="dap_2",
    )
    assert c_upd_l == "UPDATE_LEAVE_OK"

    c_can_l, _ = await execute_approved_doctor_action(
        db, actor=doc_a, action_type="CANCEL_LEAVE", parameters={"leave_id": r_leave["leaveId"]}, approval_id="dap_3"
    )
    assert c_can_l == "CANCEL_LEAVE_OK"

    c_slot, r_slot = await execute_approved_doctor_action(
        db,
        actor=doc_a,
        action_type="CREATE_SLOT",
        parameters={"date": (world["future_avail_day"] + timedelta(days=5)).isoformat(), "start_time": "17:00", "end_time": "17:30"},
        approval_id="dap_4",
    )
    assert c_slot == "CREATE_SLOT_OK"
    new_slot_id = r_slot["slotId"]

    c_uslot, _ = await execute_approved_doctor_action(
        db, actor=doc_a, action_type="UPDATE_SLOT", parameters={"slot_id": new_slot_id, "status": "UNAVAILABLE"}, approval_id="dap_5"
    )
    assert c_uslot == "UPDATE_SLOT_OK"
    await execute_approved_doctor_action(
        db, actor=doc_a, action_type="UPDATE_SLOT", parameters={"slot_id": new_slot_id, "status": "AVAILABLE"}, approval_id="dap_5b"
    )
    c_rslot, _ = await execute_approved_doctor_action(
        db, actor=doc_a, action_type="REMOVE_SLOT", parameters={"slot_id": new_slot_id}, approval_id="dap_6"
    )
    assert c_rslot == "REMOVE_SLOT_OK"

    with pytest.raises(HTTPException) as exc_empty_prof:
        await execute_approved_doctor_action(
            db, actor=doc_a, action_type="UPDATE_DOCTOR_PROFILE", parameters={}, approval_id="dap_7e"
        )
    assert exc_empty_prof.value.status_code == 400

    c_prof, _ = await execute_approved_doctor_action(
        db, actor=doc_a, action_type="UPDATE_DOCTOR_PROFILE", parameters={"fees": 950}, approval_id="dap_7"
    )
    assert c_prof == "UPDATE_DOCTOR_PROFILE_OK"

    c_appt, r_appt = await execute_approved_doctor_action(
        db, actor=doc_a, action_type="CANCEL_APPOINTMENT", parameters={"appointment_id": "appt_future_a"}, approval_id="dap_8"
    )
    assert c_appt == "UPDATE_APPOINTMENT_OK"
    assert r_appt["status"] == "CANCELLED"

    # SEND_PATIENT_MESSAGE works for authorized patient, rejects unauthorized patient (doc_b -> pat_a)
    c_msg, r_msg = await execute_approved_doctor_action(
        db,
        actor=doc_a,
        action_type="SEND_PATIENT_MESSAGE",
        parameters={"patient_user_id": "u_pat_a", "text": "Fasting before your test."},
        approval_id="dap_9",
    )
    assert c_msg == "SEND_PATIENT_MESSAGE_OK"
    assert r_msg["messageId"] is not None

    with pytest.raises(HTTPException) as exc_unauth_msg:
        await execute_approved_doctor_action(
            db,
            actor=doc_b,
            action_type="SEND_PATIENT_MESSAGE",
            parameters={"patient_user_id": "u_pat_a", "text": "Unauthorized"},
            approval_id="dap_9_unauth",
        )
    assert exc_unauth_msg.value.status_code == 403


class _StubModel:
    def __init__(self, responses):
        self._responses = list(responses)

    def bind_tools(self, tools):
        return self

    async def ainvoke(self, messages):
        return self._responses.pop(0)


@pytest.mark.integration
@pytest.mark.asyncio
async def test_hitl_execution_failure_recorded_recoverable_and_no_double_exec(db):
    world = await _seed_clinic_world(db)
    pat_a = world["pat_a"]
    pat_b = world["pat_b"]

    thread = await create_or_get_thread(db, actor=pat_a, thread_id="t_hitl_fail")
    turn = await append_turn(db, thread_id=thread["id"], original_query="Book already booked slot")

    # 1. LangGraph checkpointed execution failure records FAILED without crashing or half-mutating
    model = _StubModel(
        [
            AIMessage(
                content="",
                tool_calls=[
                    {
                        "id": "call_fail_book",
                        "name": "propose_appointment_booking",
                        "args": {"doctor_id": "doc_a", "slot_id": "slot_future_conf_a", "reason": "Retry"},
                    }
                ],
            ),
            AIMessage(content="That slot is no longer available. Please pick another slot."),
        ]
    )
    tools = build_patient_tools(
        db=db, actor=pat_a, reference_date=world["today"], thread_id=thread["id"], turn_id=turn["id"], include_mutations=True
    )
    factory, verifier, executor = build_hitl_callbacks(db, actor=pat_a, thread_id=thread["id"], turn_id=turn["id"])
    cp = MemorySaver()
    graph = build_workflow(
        model=model,
        tools=tools,
        role="PATIENT",
        checkpointer=cp,
        approval_request_factory=factory,
        approval_verifier=verifier,
        approved_tool_executor=executor,
    )
    paused = await graph.ainvoke(
        {"messages": [], "next_agent": "patient"},
        config={"configurable": {"thread_id": thread["id"]}, "recursion_limit": 16},
    )
    approval_id = paused["__interrupt__"][0].value["approval_id"]

    # Wrong user cannot decide
    with pytest.raises(HTTPException):
        await decide_approval(db, actor=pat_b, thread_id=thread["id"], approval_id=approval_id, decision="APPROVED")

    # Resume with slot already BOOKED -> records FAILED cleanly & finishes turn
    resumed = await decide_and_resume_approval(
        model=model,
        db=db,
        actor=pat_a,
        thread_id=thread["id"],
        approval_id=approval_id,
        decision="APPROVED",
        checkpointer=cp,
    )
    assert resumed["approval"]["status"] == "APPROVED"
    assert resumed["approval"]["executionStatus"] == "FAILED"
    assert resumed["approval"]["lastErrorCode"] == "HTTP_409"

    # Duplicate click is rejected cleanly (no double execution)
    with pytest.raises(HTTPException) as exc_dup:
        await decide_and_resume_approval(
            model=model,
            db=db,
            actor=pat_a,
            thread_id=thread["id"],
            approval_id=approval_id,
            decision="APPROVED",
            checkpointer=cp,
        )
    assert exc_dup.value.status_code == 409

    # Reject path performs no mutation
    proposal2 = await create_or_get_approval(
        db,
        actor=pat_a,
        thread_id=thread["id"],
        tool_call_id="tc_reject_pat",
        action_type="UPDATE_PATIENT_ACCOUNT",
        risk_level="MEDIUM_HUMAN_APPROVAL",
        parameters={"name": "Should Not Change"},
        title="Update profile",
        summary="Update profile",
        reason="User asked",
        idempotency_key="idem_reject_pat_1234",
    )
    rejected = await decide_and_resume_approval(
        model=model, db=db, actor=pat_a, thread_id=thread["id"], approval_id=proposal2["id"], decision="REJECTED"
    )
    assert rejected["approval"]["status"] == "REJECTED"
    u_row = (await db.execute(select(tables["User"].c.name).where(tables["User"].c.id == "u_pat_a"))).scalar_one()
    assert u_row == "Alice Sharma"
