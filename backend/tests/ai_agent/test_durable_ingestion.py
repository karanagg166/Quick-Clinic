"""Tests for durable ingestion job queueing, lease claiming, and storage-backed recovery."""

import fitz
import pytest
from sqlalchemy import select

from app.features.documents import files
from app.features.documents.ingestion_jobs import (
    claim_next_ingestion_job,
    enqueue_ingestion_job,
    process_claimed_job,
)
from app.infrastructure.database import tables, utcnow


def _sample_pdf() -> bytes:
    doc = fitz.open()
    page = doc.new_page()
    page.insert_text((72, 72), "Discharge Summary: Blood Pressure 120/80 mmHg", fontsize=12)
    return doc.tobytes()


async def _none_coro():
    return None


async def _mock_embed_coro(texts: list[str]):
    return ("cohere", "embed-english-light-v3.0", [[0.0] * 384 for _ in texts])


@pytest.mark.integration
@pytest.mark.asyncio
async def test_durable_ingestion_job_recovers_from_storage(db, tmp_path, monkeypatch):
    monkeypatch.setenv("DOCUMENT_STORAGE_DIR", str(tmp_path))
    from app.core.config import get_settings

    get_settings.cache_clear()
    try:
        now = utcnow()
        await db.execute(tables["Location"].insert().values(pincode=560001, city="Bengaluru", state="KA"))
        await db.execute(
            tables["User"].insert().values(
                id="u_pat_dur",
                email="patdur@example.com",
                phoneNo="9999999999",
                name="Pat Dur",
                password="hash",
                age=30,
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
                id="pat_dur", userId="u_pat_dur", medicalHistory="None", allergies="None", currentMedications="None", createdAt=now, updatedAt=now
            )
        )
        pdf_bytes = _sample_pdf()
        storage_key = "local/pat_dur/doc_dur_1/hash123"
        await files.write_file(storage_key, pdf_bytes, "summary.pdf", "application/pdf")

        await db.execute(
            tables["MedicalDocument"].insert().values(
                id="doc_dur_1",
                patientId="pat_dur",
                title="Discharge Summary",
                type="DISCHARGE_SUMMARY",
                fileName="summary.pdf",
                mimeType="application/pdf",
                fileSize=len(pdf_bytes),
                storagePath=storage_key,
                reportDate=now,
                processingStatus="READY",
                createdAt=now,
                updatedAt=now,
            )
        )

        queued = await enqueue_ingestion_job(db, document_id="doc_dur_1")
        assert queued["status"] == "QUEUED"

        claimed = await claim_next_ingestion_job(db, document_id="doc_dur_1")
        assert claimed is not None
        assert claimed["status"] == "RUNNING"
        assert claimed["attempts"] == 1

        # First attempt: embeddings fail/retryable
        monkeypatch.setattr("app.features.documents.embeddings.embed_texts", lambda texts: _none_coro())
        result = await process_claimed_job(db, claimed)
        assert result["status"] == "RETRYABLE"
        assert result["indexStatus"] == "RETRYABLE"

        job_row = (
            await db.execute(
                select(tables["MedicalIngestionJob"]).where(tables["MedicalIngestionJob"].c.id == queued["id"])
            )
        ).mappings().first()
        assert job_row["status"] == "RETRYABLE"
        assert job_row["stage"] == "embedding_retry_scheduled"

        # Version must NOT be published while embedding is retryable
        ver_row = (
            await db.execute(
                select(tables["MedicalDocumentVersion"]).where(tables["MedicalDocumentVersion"].c.id == job_row["versionId"])
            )
        ).mappings().first()
        assert ver_row["isPublished"] is False
        assert ver_row["indexStatus"] == "RETRYABLE"

        # Retry stage: embeddings now succeed
        monkeypatch.setattr("app.features.documents.embeddings.embed_texts", lambda texts: _mock_embed_coro(texts))
        retry_result = await process_claimed_job(db, dict(job_row))
        assert retry_result["status"] == "COMPLETED"
        assert retry_result["indexStatus"] == "COMPLETED"

        job_row_done = (
            await db.execute(
                select(tables["MedicalIngestionJob"]).where(tables["MedicalIngestionJob"].c.id == queued["id"])
            )
        ).mappings().first()
        assert job_row_done["status"] == "COMPLETED"
        assert job_row_done["stage"] == "published"

        ver_row_done = (
            await db.execute(
                select(tables["MedicalDocumentVersion"]).where(tables["MedicalDocumentVersion"].c.id == job_row["versionId"])
            )
        ).mappings().first()
        assert ver_row_done["isPublished"] is True
        assert ver_row_done["indexStatus"] == "COMPLETED"

        doc_row = (
            await db.execute(
                select(tables["MedicalDocument"]).where(tables["MedicalDocument"].c.id == "doc_dur_1")
            )
        ).mappings().first()
        assert doc_row["processingStatus"] == "READY"
    finally:
        get_settings.cache_clear()
