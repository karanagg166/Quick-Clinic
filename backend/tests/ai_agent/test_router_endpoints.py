"""API router tests for Doctor AI Agent threads, approvals, and document ingestion wiring."""

from datetime import timedelta
import importlib

import fitz
import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from langchain_core.language_models.fake_chat_models import FakeListChatModel

from app.core.security import current_user
from app.features.ai_agent.persistence.approvals import create_or_get_approval
from app.features.ai_agent.persistence.telemetry import record_tool_call
from app.features.ai_agent.persistence.threads import append_turn, create_or_get_thread
from app.features.documents import router as doc_router
from app.features.documents import service as doc_service
from app.infrastructure.database import get_db, tables, utcnow

service_module = importlib.import_module("app.features.ai_agent.service")
router_module = importlib.import_module("app.features.ai_agent.router")


class _BindableFakeModel(FakeListChatModel):
    def bind_tools(self, tools, **kwargs):
        return self


async def _seed_doctor(db):
    now = utcnow()
    await db.execute(tables["Location"].insert().values(pincode=560002, city="Bengaluru", state="KA"))
    await db.execute(
        tables["User"].insert().values(
            id="u_doc_api",
            email="docapi@example.com",
            phoneNo="9876543210",
            name="Dr. Api",
            password="hash",
            age=40,
            gender="FEMALE",
            role="DOCTOR",
            address="Clinic",
            pinCode=560002,
            isActive=True,
            createdAt=now,
            updatedAt=now,
        )
    )
    await db.execute(
        tables["Doctor"].insert().values(
            id="doc_api",
            userId="u_doc_api",
            specialty="GENERAL_PHYSICIAN",
            experience=10,
            fees=500,
            createdAt=now,
            updatedAt=now,
        )
    )


def _build_app(db, actor):
    app = FastAPI()
    app.include_router(router_module.router)
    app.dependency_overrides[current_user] = lambda: actor

    async def _override_db():
        yield db

    app.dependency_overrides[get_db] = _override_db
    return app


@pytest.mark.unit
@pytest.mark.asyncio
async def test_threads_chat_and_delete_endpoints(db, monkeypatch):
    await _seed_doctor(db)
    fake_model = _BindableFakeModel(responses=["Here is your schedule summary."])
    monkeypatch.setattr(service_module, "get_model", lambda provider="google": fake_model)
    svc = service_module.AIAgentService()
    monkeypatch.setattr(router_module, "get_agent_service", lambda: svc)

    actor = {"id": "u_doc_api", "role": "DOCTOR", "isActive": True}
    app = _build_app(db, actor)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        chat_res = await client.post(
            "/api/ai-agent/chat",
            json={"message": "Check my schedule", "threadId": ""},
        )
        assert chat_res.status_code == 200
        body = chat_res.json()
        thread_id = body["threadId"]
        assert thread_id
        assert body["response"] == "Here is your schedule summary."
        assert body["mode"] == "live"

        list_res = await client.get("/api/ai-agent/threads")
        assert list_res.status_code == 200
        threads = list_res.json()["threads"]
        assert len(threads) == 1
        assert threads[0]["threadId"] == thread_id
        assert len(threads[0]["messages"]) == 2

        get_res = await client.get(f"/api/ai-agent/threads/{thread_id}")
        assert get_res.status_code == 200
        assert get_res.json()["threadId"] == thread_id

        del_res = await client.delete(f"/api/ai-agent/threads/{thread_id}")
        assert del_res.status_code == 200
        assert del_res.json() == {"success": True}

        list_after = await client.get("/api/ai-agent/threads")
        assert list_after.json()["threads"] == []


@pytest.mark.unit
@pytest.mark.asyncio
async def test_approval_decision_endpoint_executes_leave(db, monkeypatch):
    await _seed_doctor(db)
    actor = {"id": "u_doc_api", "role": "DOCTOR", "isActive": True}
    thread = await create_or_get_thread(db, actor=actor, title="Leave thread")
    turn = await append_turn(db, thread_id=thread["id"], original_query="Apply leave")

    leave_date = (utcnow() + timedelta(days=5)).strftime("%Y-%m-%d")
    leave_params = {"start_date": leave_date, "end_date": leave_date, "reason": "Medical conference"}
    tool_call = await record_tool_call(
        db,
        thread_id=thread["id"],
        turn_id=turn["id"],
        tool_call_id="tc_api_1",
        tool_name="apply_leave_tool",
        input_json=leave_params,
        status="PENDING",
        action_type="APPLY_LEAVE",
        risk_level="MEDIUM_HUMAN_APPROVAL",
    )
    proposal = await create_or_get_approval(
        db,
        actor=actor,
        thread_id=thread["id"],
        tool_call_id=tool_call["toolCallId"],
        action_type="APPLY_LEAVE",
        risk_level="MEDIUM_HUMAN_APPROVAL",
        parameters=leave_params,
        title=f"Apply leave on {leave_date}",
        summary=f"Apply leave on {leave_date}",
        reason="Medical conference",
        idempotency_key="idem_api_leave_1",
    )

    fake_model = _BindableFakeModel(responses=["Done."])
    monkeypatch.setattr(service_module, "get_model", lambda provider="google": fake_model)
    svc = service_module.AIAgentService()
    monkeypatch.setattr(router_module, "get_agent_service", lambda: svc)

    app = _build_app(db, actor)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        res = await client.post(
            f"/api/ai-agent/approvals/{proposal['id']}/decision",
            json={"threadId": thread["id"], "decision": "APPROVED"},
        )
    assert res.status_code == 200
    data = res.json()
    assert data["approval"]["status"] == "APPROVED"
    assert data["approval"]["executionStatus"] == "COMPLETED"
    leaves = (await db.execute(tables["Leave"].select().where(tables["Leave"].c.doctorId == "doc_api"))).all()
    assert len(leaves) == 1


@pytest.mark.unit
@pytest.mark.asyncio
async def test_document_upload_schedules_search_sphere_ingestion(db, monkeypatch):
    now = utcnow()
    await db.execute(tables["Location"].insert().values(pincode=560003, city="Bengaluru", state="KA"))
    await db.execute(
        tables["User"].insert().values(
            id="u_pat_up",
            email="patup@example.com",
            phoneNo="9123456780",
            name="Pat Up",
            password="hash",
            age=28,
            gender="MALE",
            role="PATIENT",
            address="Home",
            pinCode=560003,
            isActive=True,
            createdAt=now,
            updatedAt=now,
        )
    )
    await db.execute(
        tables["Patient"].insert().values(
            id="pat_up",
            userId="u_pat_up",
            createdAt=now,
            updatedAt=now,
        )
    )

    scheduled: list[str] = []

    async def _fake_ingest(document_id: str, data: bytes) -> None:
        scheduled.append(document_id)

    async def _fake_write(*args, **kwargs):
        return None

    monkeypatch.setattr(doc_router, "_run_background_ingestion", _fake_ingest)
    monkeypatch.setattr(doc_service.files, "write_file", _fake_write)

    app = FastAPI()
    app.include_router(doc_router.router)
    app.dependency_overrides[current_user] = lambda: {
        "id": "u_pat_up",
        "role": "PATIENT",
        "isActive": True,
    }

    async def _override_db():
        yield db

    app.dependency_overrides[get_db] = _override_db

    doc = fitz.open()
    doc.new_page().insert_text((72, 72), "Hemoglobin 13.5 g/dL")
    pdf_bytes = doc.tobytes()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        res = await client.post(
            "/api/patients/me/medical-documents",
            files={"file": ("lab.pdf", pdf_bytes, "application/pdf")},
            data={
                "title": "Lab Report",
                "type": "LAB_REPORT",
                "reportDate": utcnow().strftime("%Y-%m-%d"),
            },
        )
    assert res.status_code in (200, 201)
    assert res.json()["document"]["title"] == "Lab Report"
    assert scheduled == [res.json()["document"]["id"]]
