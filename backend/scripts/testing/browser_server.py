"""Run a local browser-test server with synthetic rows in an explicit test DB."""

import asyncio
import os
from datetime import timedelta
from pathlib import Path
from tempfile import TemporaryDirectory

from sqlalchemy import delete, insert, select, text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import create_async_engine


async def prepare(raw):
    from app.features.auth.passwords import hash_password
    from app.infrastructure.database import metadata, tables, utcnow

    engine = create_async_engine(raw)
    try:
        async with engine.begin() as db:
            await db.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
            await db.run_sync(metadata.create_all)
            # Previous failed runs can leave synthetic metadata after their temporary files were removed.
            await db.execute(
                delete(tables["MedicalDocument"]).where(
                    tables["MedicalDocument"].c.patientId == "browser-profile"
                )
            )
            if not (
                await db.execute(select(tables["User"].c.id).where(tables["User"].c.id == "browser-patient"))
            ).first():
                await db.execute(
                    insert(tables["Location"]).values(pincode=110001, city="Synthetic", state="Synthetic")
                )
                await db.execute(
                    insert(tables["User"]).values(
                        id="browser-patient",
                        email="browser@example.test",
                        name="Browser Patient",
                        phoneNo="9999999999",
                        password=hash_password("browser-test-password"),
                        age=30,
                        gender="MALE",
                        role="PATIENT",
                        address="Test",
                        pinCode=110001,
                        isActive=True,
                        emailVerified=True,
                    )
                )
                await db.execute(
                    insert(tables["Patient"]).values(id="browser-profile", userId="browser-patient")
                )
            if not (
                await db.execute(select(tables["User"].c.id).where(tables["User"].c.id == "browser-doctor"))
            ).first():
                now = utcnow()
                await db.execute(
                    insert(tables["User"]).values(
                        id="browser-doctor",
                        email="doctor@example.test",
                        name="Browser Doctor",
                        phoneNo="9999999998",
                        password=hash_password("browser-test-password"),
                        age=42,
                        gender="FEMALE",
                        role="DOCTOR",
                        address="Clinic",
                        pinCode=110001,
                        isActive=True,
                        emailVerified=True,
                    )
                )
                await db.execute(
                    insert(tables["Doctor"]).values(
                        id="browser-doc-profile",
                        userId="browser-doctor",
                        specialty="GENERAL_PHYSICIAN",
                        experience=10,
                        fees=500,
                    )
                )
                await db.execute(
                    insert(tables["Schedule"]).values(
                        id="browser-doc-sched",
                        doctorId="browser-doc-profile",
                        weeklySchedule={},
                        createdAt=now,
                        updatedAt=now,
                    )
                )
                await db.execute(
                    insert(tables["Slot"]).values(
                        id="browser-doc-slot",
                        doctorId="browser-doc-profile",
                        date=(now + timedelta(days=1)).date(),
                        startTime=now + timedelta(days=1),
                        endTime=now + timedelta(days=1, minutes=30),
                        status="BOOKED",
                        createdAt=now,
                        updatedAt=now,
                    )
                )
                await db.execute(
                    insert(tables["Appointment"]).values(
                        id="browser-doc-appt",
                        doctorId="browser-doc-profile",
                        patientId="browser-profile",
                        slotId="browser-doc-slot",
                        status="CONFIRMED",
                        bookedAt=now,
                        updatedAt=now,
                    )
                )
    finally:
        await engine.dispose()


def _install_deterministic_ai_if_no_keys():
    """Install deterministic embedding/LLM adapters ONLY in this isolated browser test harness when CI has no keys."""
    if os.environ.get("COHERE_API_KEY") or os.environ.get("GOOGLE_API_KEY"):
        return
    import json
    from langchain_core.language_models.chat_models import BaseChatModel
    from langchain_core.messages import AIMessage, ToolMessage
    from langchain_core.outputs import ChatGeneration, ChatResult
    from contextlib import asynccontextmanager
    from app.features.ai_agent import approval_resume, service as agent_service
    from app.features.ai_agent.models import providers
    from app.features.ai_agent.rag import pipeline as rag_pipeline
    from app.features.documents import embeddings as doc_embeddings
    from langgraph.checkpoint.memory import MemorySaver

    async def _det_embed(texts: list[str]):
        return ("cohere", "embed-english-light-v3.0", [[0.01] * 384 for _ in texts])

    doc_embeddings.embed_texts = _det_embed
    _shared_mem_cp = MemorySaver()

    @asynccontextmanager
    async def _test_checkpointer():
        yield _shared_mem_cp

    approval_resume.optional_checkpointer = _test_checkpointer
    agent_service.optional_checkpointer = _test_checkpointer

    class _BrowserChatModel(BaseChatModel):
        @property
        def _llm_type(self) -> str:
            return "browser-deterministic"

        def bind_tools(self, tools, **kwargs):
            return self

        def _generate(self, messages, stop=None, run_manager=None, **kwargs):
            sys_text = str(getattr(messages[0], "content", "")) if messages else ""
            if "medical document excerpts below" in sys_text:
                return ChatResult(generations=[ChatGeneration(
                    message=AIMessage(content="Based on authorized records: Serum Glucose: 94 mg/dL (Reference 70-99).")
                )])
            last = messages[-1]
            if isinstance(last, ToolMessage):
                try:
                    data = json.loads(str(last.content))
                    ans = data.get("answer") or str(last.content)
                    cits = data.get("citations") or []
                    if cits:
                        ans = f"{ans} [Source: {cits[0].get('documentTitle', 'Document')}]"
                except Exception:
                    ans = str(last.content)
                return ChatResult(generations=[ChatGeneration(message=AIMessage(content=ans))])
            text_q = str(getattr(last, "content", "")).lower()
            if "glucose" in text_q or "lab" in text_q or "document" in text_q:
                is_doc = any("Doctor AI Assistant" in str(m.content) for m in messages[:2])
                if is_doc:
                    tc = {"name": "query_patient_medical_documents", "args": {"patient_id": "browser-profile", "question": str(last.content)}, "id": "tc_1", "type": "tool_call"}
                else:
                    tc = {"name": "search_my_medical_documents", "args": {"query": str(last.content)}, "id": "tc_1", "type": "tool_call"}
                return ChatResult(generations=[ChatGeneration(message=AIMessage(content="", tool_calls=[tc]))])
            if "leave" in text_q:
                tc = {"name": "apply_leave", "args": {"start_date": "2026-12-20", "end_date": "2026-12-21", "reason": "Conference"}, "id": "tc_leave", "type": "tool_call"}
                return ChatResult(generations=[ChatGeneration(message=AIMessage(content="", tool_calls=[tc]))])
            return ChatResult(generations=[ChatGeneration(message=AIMessage(content="I can help with your clinic records and schedules."))])

        async def _agenerate(self, messages, stop=None, run_manager=None, **kwargs):
            return self._generate(messages, stop=stop, run_manager=run_manager, **kwargs)

    agent_service.get_model = lambda provider="google": _BrowserChatModel()
    providers.get_model = lambda provider="google": _BrowserChatModel()
    rag_pipeline.get_model = lambda provider="google": _BrowserChatModel()


def main():
    raw = os.environ.get("QC_BROWSER_TEST_DATABASE_URL", "")
    url = make_url(raw) if raw else None
    if not url or url.host not in {"localhost", "127.0.0.1"} or url.database != "quickclinic_e2e_test":
        raise RuntimeError("Browser tests require a local disposable quickclinic_e2e_test database")
    raw = url.set(drivername="postgresql+asyncpg").render_as_string(hide_password=False)
    os.environ.update(
        DATABASE_URL=raw,
        NODE_ENV="test",
        JWT_SECRET="browser-isolated-signing-secret-at-least-32-characters",
        REDIS_URL="",
        RESEND_API_KEY="",
        RAZORPAY_KEY_ID="",
        RAZORPAY_KEY_SECRET="",
        SUPABASE_URL="",
        SUPABASE_SECRET_KEY="",
        DOCUMENT_STORAGE_BACKEND="local",
        FRONTEND_URL="http://localhost:3100",
        BACKEND_PUBLIC_URL="http://localhost:4100",
    )
    with TemporaryDirectory(prefix="quick-clinic-browser-") as directory:
        os.environ["DOCUMENT_STORAGE_DIR"] = str(Path(directory) / "documents")
        from app.features.ai_agent.persistence.checkpoints import initialize_checkpoint_schema

        async def _boot():
            await prepare(raw)
            await initialize_checkpoint_schema()

        asyncio.run(_boot())
        _install_deterministic_ai_if_no_keys()
        import uvicorn
        from app.main import app

        uvicorn.run(app, host="127.0.0.1", port=4100)


if __name__ == "__main__":
    main()
