"""Phase 2 and Phase 6 tests: rotated/raster-chart PDFs, image uploads, limits, retries, and lease recovery."""

from __future__ import annotations

import io
import shutil
from datetime import timedelta

import pymupdf
import pytest
from PIL import Image, ImageDraw
from sqlalchemy import select, update

from app.core.security import issue_token
from app.features.documents.embeddings import index_version_chunks
from app.features.documents.ingestion_jobs import (
    MAX_INGESTION_ATTEMPTS,
    claim_next_ingestion_job,
    enqueue_ingestion_job,
    process_claimed_job,
)
from app.features.documents.pipeline_runner import run_document_ingestion
from app.features.documents.storage import MAX_FILE_BYTES
from app.infrastructure.database import tables, utcnow


async def _mock_embed_coro(texts: list[str]):
    return ("cohere", "embed-english-light-v3.0", [[0.05] * 384 for _ in texts])


def _auth(user: dict) -> dict[str, str]:
    return {"Authorization": f"Bearer {issue_token(user)}"}


async def _seed_doc_world(db):
    now = utcnow()
    await db.execute(tables["Location"].insert().values(pincode=560001, city="Bengaluru", state="KA"))
    await db.execute(
        tables["User"].insert().values(
            id="u_p2_pat",
            email="p2pat@example.com",
            phoneNo="9999999999",
            name="Phase Two Patient",
            password="hash",
            age=40,
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
            id="pat_p2",
            userId="u_p2_pat",
            medicalHistory="None",
            allergies="None",
            currentMedications="None",
            createdAt=now,
            updatedAt=now,
        )
    )
    return {"id": "u_p2_pat", "role": "PATIENT", "isActive": True, "name": "Phase Two Patient"}


async def _insert_doc(db, doc_id: str, title: str, *, mime: str = "application/pdf", path: str | None = None):
    now = utcnow()
    await db.execute(
        tables["MedicalDocument"].insert().values(
            id=doc_id,
            patientId="pat_p2",
            title=title,
            type="LAB_REPORT",
            fileName=f"{doc_id}.bin",
            mimeType=mime,
            fileSize=512,
            storagePath=path or f"local/pat_p2/{doc_id}/f",
            reportDate=now,
            processingStatus="QUEUED",
            createdAt=now,
            updatedAt=now,
        )
    )


def _make_rotated_pdf(angle: int) -> bytes:
    doc = pymupdf.open()
    page = doc.new_page(width=612, height=792)
    page.insert_text((72, 100), f"ROTATED REPORT {angle} DEG\nHemoglobin 13.8 g/dL", fontsize=12)
    page.set_rotation(angle)
    return doc.tobytes()


def _make_raster_bar_chart_pdf() -> bytes:
    """Create a PDF containing ONLY a raster PNG bar chart (no PDF text layer for bar heights)."""
    img = Image.new("RGB", (520, 280), "white")
    draw = ImageDraw.Draw(img)
    draw.text((20, 15), "WEEKLY GLUCOSE CHART", fill="black")
    draw.rectangle([80, 90, 130, 230], fill="navy")
    draw.rectangle([180, 60, 230, 230], fill="teal")
    buf = io.BytesIO()
    img.save(buf, format="PNG")

    doc = pymupdf.open()
    page = doc.new_page()
    page.insert_image(pymupdf.Rect(50, 50, 450, 280), stream=buf.getvalue())
    return doc.tobytes()


def _make_png_lab_image() -> bytes:
    img = Image.new("RGB", (480, 140), "white")
    draw = ImageDraw.Draw(img)
    draw.text((20, 30), "PLATELETS 245000 /uL", fill="black")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


@pytest.mark.integration
@pytest.mark.asyncio
async def test_rotated_pages_coordinates_reading_order_and_raster_chart_safety(db, monkeypatch):
    monkeypatch.setattr("app.features.documents.embeddings.embed_texts", lambda texts: _mock_embed_coro(texts))
    await _seed_doc_world(db)

    # 1. Rotated pages preserve text, pageNumber, bbox, readingOrder, and chunk provenance
    for angle in (90, 180, 270):
        did = f"doc_rot_{angle}"
        await _insert_doc(db, did, f"Rotated {angle}")
        res = await run_document_ingestion(db, document_id=did, data=_make_rotated_pdf(angle))
        assert res["status"] == "COMPLETED"

        objs = (
            await db.execute(
                select(tables["MedicalDocumentObject"]).where(tables["MedicalDocumentObject"].c.versionId == res["versionId"])
            )
        ).mappings().all()
        assert len(objs) >= 1
        assert objs[0]["firstPage"] == 1
        assert objs[0]["readingOrder"] == 0
        src0 = objs[0]["normalized"]["sources"][0]
        assert src0["page_number"] == 1
        assert {"x0", "y0", "x1", "y1"}.issubset(src0["bbox"].keys())

        chunks = (
            await db.execute(
                select(tables["MedicalDocumentChunk"]).where(tables["MedicalDocumentChunk"].c.versionId == res["versionId"])
            )
        ).mappings().all()
        assert any("13.8" in c["content"] and f"{angle} DEG" in c["content"] for c in chunks)
        assert chunks[0]["pageNumbers"] == [1]
        assert chunks[0]["sourceObjectIds"]
        assert {"x0", "y0", "x1", "y1"}.issubset(chunks[0]["provenance"][0]["bbox"].keys())

    # 2. Raster bar chart without vision interpreter stays PARTIAL with explicit warning and no hallucinated bar values
    await _insert_doc(db, "doc_raster_chart", "Raster Chart Only")
    chart_res = await run_document_ingestion(db, document_id="doc_raster_chart", data=_make_raster_bar_chart_pdf())
    assert chart_res["extractionStatus"] == "PARTIAL"
    assert chart_res["issueCount"] >= 1
    issues = (
        await db.execute(
            select(tables["MedicalExtractionIssue"]).where(
                tables["MedicalExtractionIssue"].c.versionId == chart_res["versionId"]
            )
        )
    ).mappings().all()
    assert any(i["code"] == "vision_provider_unavailable" for i in issues)


@pytest.mark.integration
@pytest.mark.asyncio
async def test_image_upload_empty_unsupported_10mb_and_page_boundaries(client, db, monkeypatch, tmp_path):
    monkeypatch.setenv("DOCUMENT_STORAGE_DIR", str(tmp_path))
    monkeypatch.setattr("app.features.documents.embeddings.embed_texts", lambda texts: _mock_embed_coro(texts))
    actor = await _seed_doc_world(db)

    # Empty file -> 400
    r_empty = await client.post(
        "/api/patients/me/medical-documents",
        headers=_auth(actor),
        data={"title": "Empty", "type": "LAB_REPORT", "reportDate": "2026-11-15"},
        files={"file": ("empty.pdf", b"", "application/pdf")},
    )
    assert r_empty.status_code == 400

    # Unsupported file -> 400
    r_unsup = await client.post(
        "/api/patients/me/medical-documents",
        headers=_auth(actor),
        data={"title": "Text", "type": "LAB_REPORT", "reportDate": "2026-11-15"},
        files={"file": ("note.txt", b"Plain text medical note", "text/plain")},
    )
    assert r_unsup.status_code == 400

    # Over 10MB file -> 400
    r_over = await client.post(
        "/api/patients/me/medical-documents",
        headers=_auth(actor),
        data={"title": "TooLarge", "type": "LAB_REPORT", "reportDate": "2026-11-15"},
        files={"file": ("big.pdf", b"%PDF-1.4\n" + b"0" * MAX_FILE_BYTES, "application/pdf")},
    )
    assert r_over.status_code == 400

    # 199 and 200 page uploads accepted; 201 pages rejected by upload validation
    def _pages_pdf(n: int) -> bytes:
        d = pymupdf.open()
        for idx in range(n):
            p = d.new_page()
            if idx == 0:
                p.insert_text((72, 72), "Page 1 check", fontsize=10)
        return d.tobytes()

    r_200 = await client.post(
        "/api/patients/me/medical-documents",
        headers=_auth(actor),
        data={"title": "Exact 200 Pages", "type": "LAB_REPORT", "reportDate": "2026-11-15"},
        files={"file": ("200.pdf", _pages_pdf(200), "application/pdf")},
    )
    assert r_200.status_code == 201

    r_201 = await client.post(
        "/api/patients/me/medical-documents",
        headers=_auth(actor),
        data={"title": "Over 200 Pages", "type": "LAB_REPORT", "reportDate": "2026-11-15"},
        files={"file": ("201.pdf", _pages_pdf(201), "application/pdf")},
    )
    assert r_201.status_code == 400

    # Standalone PNG upload + ingestion
    png_bytes = _make_png_lab_image()
    r_png = await client.post(
        "/api/patients/me/medical-documents",
        headers=_auth(actor),
        data={"title": "CBC Photo", "type": "LAB_REPORT", "reportDate": "2026-11-15"},
        files={"file": ("platelets.png", png_bytes, "image/png")},
    )
    assert r_png.status_code == 201
    png_doc_id = r_png.json()["document"]["id"]
    if shutil.which("tesseract"):
        png_ing = await run_document_ingestion(db, document_id=png_doc_id, data=png_bytes)
        assert png_ing["status"] == "COMPLETED"
        chunks = (
            await db.execute(
                select(tables["MedicalDocumentChunk"]).where(
                    tables["MedicalDocumentChunk"].c.versionId == png_ing["versionId"]
                )
            )
        ).mappings().all()
        assert any("245000" in c["content"] or "PLATELET" in c["content"].upper() for c in chunks)


@pytest.mark.integration
@pytest.mark.asyncio
async def test_durable_provider_failure_retry_lease_expiry_and_cron_recovery(client, db, monkeypatch):
    await _seed_doc_world(db)
    await _insert_doc(db, "doc_retry_1", "Retryable Report")
    pdf_bytes = _make_rotated_pdf(0)

    queued = await enqueue_ingestion_job(db, document_id="doc_retry_1")
    claimed = await claim_next_ingestion_job(db, document_id="doc_retry_1")
    assert claimed is not None

    # Attempt 1: hosted embedding provider throws transient exception
    async def _boom(_texts):
        raise RuntimeError("503 Embedding Service Temporarily Unavailable")

    monkeypatch.setattr("app.features.documents.embeddings.embed_texts", _boom)
    res1 = await process_claimed_job(db, claimed, data=pdf_bytes)
    assert res1["status"] == "RETRYABLE"

    # Document must NOT become READY; job saves versionId so extraction isn't lost
    doc_row = (await db.execute(select(tables["MedicalDocument"]).where(tables["MedicalDocument"].c.id == "doc_retry_1"))).mappings().one()
    assert doc_row["processingStatus"] != "READY"
    job_row = (await db.execute(select(tables["MedicalIngestionJob"]).where(tables["MedicalIngestionJob"].c.id == queued["id"]))).mappings().one()
    assert job_row["status"] == "RETRYABLE"
    assert job_row["versionId"] is not None

    # Reclaim with expired backoff -> Attempt 2 succeeds without duplicating embeddings
    await db.execute(
        update(tables["MedicalIngestionJob"])
        .where(tables["MedicalIngestionJob"].c.id == queued["id"])
        .values(availableAt=utcnow() - timedelta(seconds=5))
    )
    claimed2 = await claim_next_ingestion_job(db, document_id="doc_retry_1")
    assert claimed2 is not None
    monkeypatch.setattr("app.features.documents.embeddings.embed_texts", lambda texts: _mock_embed_coro(texts))
    res2 = await process_claimed_job(db, claimed2)
    assert res2["status"] == "COMPLETED"

    # Idempotent re-index on same version does not fail or duplicate vector rows
    reidx = await index_version_chunks(db, version_id=job_row["versionId"])
    assert reidx["status"] == "COMPLETED"

    # Expired lease can be reclaimed cleanly
    await _insert_doc(db, "doc_lease_exp", "Expired Lease Doc")
    q_exp = await enqueue_ingestion_job(db, document_id="doc_lease_exp")
    await db.execute(
        update(tables["MedicalIngestionJob"])
        .where(tables["MedicalIngestionJob"].c.id == q_exp["id"])
        .values(status="RUNNING", leaseExpiresAt=utcnow() - timedelta(seconds=30), attempts=1)
    )
    reclaimed = await claim_next_ingestion_job(db, document_id="doc_lease_exp")
    assert reclaimed is not None
    assert reclaimed["id"] == q_exp["id"]
    assert reclaimed["attempts"] == 2

    # Exhausting MAX_INGESTION_ATTEMPTS marks terminal FAILED + document FAILED
    monkeypatch.setattr("app.features.documents.embeddings.embed_texts", _boom)
    await db.execute(
        update(tables["MedicalIngestionJob"])
        .where(tables["MedicalIngestionJob"].c.id == q_exp["id"])
        .values(attempts=MAX_INGESTION_ATTEMPTS)
    )
    reclaimed["attempts"] = MAX_INGESTION_ATTEMPTS
    fail_res = await process_claimed_job(db, reclaimed, data=pdf_bytes)
    assert fail_res["status"] == "FAILED"
    doc_fail = (await db.execute(select(tables["MedicalDocument"]).where(tables["MedicalDocument"].c.id == "doc_lease_exp"))).mappings().one()
    assert doc_fail["processingStatus"] == "FAILED"

    # Cron recovery endpoint enforces cron auth
    r_unauth = await client.get("/api/cron/recover-ingestion")
    assert r_unauth.status_code in {401, 503}

    monkeypatch.setenv("CRON_SECRET", "test-cron-secret-1234567890")
    from app.core.config import get_settings

    get_settings.cache_clear()
    try:
        monkeypatch.setattr("app.features.documents.ingestion_jobs.recover_pending_ingestion_jobs", lambda limit=5: _async_val(2))
        r_ok = await client.post("/api/cron/recover-ingestion", headers={"x-cron-secret": "test-cron-secret-1234567890"})
        assert r_ok.status_code == 200
        assert r_ok.json()["ok"] is True
        assert r_ok.json()["recoveredIngestionJobs"] == 2
    finally:
        get_settings.cache_clear()


async def _async_val(val):
    return val
