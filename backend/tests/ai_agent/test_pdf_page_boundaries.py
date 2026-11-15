"""Tests for large PDF page boundaries (199, 200, 201 pages) and bounded ingestion."""

import pytest
import pymupdf
from fastapi import HTTPException
from sqlalchemy import select

from app.features.documents.pipeline_runner import run_document_ingestion
from app.features.documents.storage import validate_file
from app.infrastructure.database import tables, utcnow


def _make_boundary_pdf(page_count: int) -> bytes:
    """Generate minimal PDF with exact page count for boundary testing."""
    doc = pymupdf.open()
    for i in range(page_count):
        p = doc.new_page()
        p.insert_text(
            (72, 72),
            f"LONGITUDINAL CLINICAL ENCOUNTER - EPISODE {i + 1}\n"
            f"Recorded page index {i + 1} of {page_count}.\n"
            f"Clinical status: Stable under routine outpatient observation.\n",
            fontsize=10,
        )
    return doc.tobytes()


async def _mock_embed_coro(texts: list[str]):
    return ("cohere", "embed-english-light-v3.0", [[0.0] * 384 for _ in texts])


async def _seed_boundary_patient_and_doc(db, doc_id: str, title: str):
    now = utcnow()
    existing = (
        await db.execute(select(tables["Patient"]).where(tables["Patient"].c.id == "pat_boundary"))
    ).first()
    if not existing:
        await db.execute(tables["Location"].insert().values(pincode=560001, city="Bengaluru", state="KA"))
        await db.execute(
            tables["User"].insert().values(
                id="u_boundary", email="boundary@example.com", phoneNo="9555555551", name="Boundary Pat",
                password="hash", age=45, gender="FEMALE", role="PATIENT", address="Addr",
                pinCode=560001, isActive=True, createdAt=now, updatedAt=now,
            )
        )
        await db.execute(
            tables["Patient"].insert().values(
                id="pat_boundary", userId="u_boundary", medicalHistory="None",
                allergies="None", currentMedications="None", createdAt=now, updatedAt=now,
            )
        )

    await db.execute(
        tables["MedicalDocument"].insert().values(
            id=doc_id, patientId="pat_boundary", title=title, type="OTHER",
            fileName=f"{doc_id}.pdf", mimeType="application/pdf", fileSize=100000,
            storagePath=f"local/pat_boundary/{doc_id}.pdf", reportDate=now,
            processingStatus="PENDING", createdAt=now, updatedAt=now,
        )
    )


@pytest.mark.integration
def test_page_count_validation_boundaries():
    """Verify upload validation boundary conditions: 199 & 200 pass; 201 is rejected."""
    # 201 pages rejected with 400
    pdf_201 = _make_boundary_pdf(201)
    with pytest.raises(HTTPException) as exc:
        validate_file(pdf_201, "application/pdf")
    assert exc.value.status_code == 400
    assert "Invalid, encrypted, or active PDF document" in exc.value.detail

    # 199 pages validated
    pdf_199 = _make_boundary_pdf(199)
    mime_199 = validate_file(pdf_199, "application/pdf")
    assert mime_199 == "application/pdf"

    # 200 pages validated (exact upper bound)
    pdf_200 = _make_boundary_pdf(200)
    mime_200 = validate_file(pdf_200, "application/pdf")
    assert mime_200 == "application/pdf"


@pytest.mark.integration
@pytest.mark.asyncio
async def test_bounded_ingestion_at_200_page_limit(db, monkeypatch):
    """Verify 200-page document processes via bounded 25-page ranges and preserves pages 1 to 200."""
    monkeypatch.setattr("app.features.documents.embeddings.embed_texts", lambda texts: _mock_embed_coro(texts))

    doc_id = "doc_boundary_200"
    await _seed_boundary_patient_and_doc(db, doc_id, "200 Page Longitudinal Medical Record")

    pdf_200 = _make_boundary_pdf(200)
    res = await run_document_ingestion(db, document_id=doc_id, data=pdf_200)

    assert res["status"] == "COMPLETED"
    assert res["chunkCount"] >= 8

    # Query all persisted chunks to verify page range coverage and continuity
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
    assert max(last_pages) == 200

    # Verify no content loss: key episode markers present in chunks
    all_content = " ".join(c["content"] for c in chunks)
    assert "EPISODE 1" in all_content
    assert "EPISODE 100" in all_content
    assert "EPISODE 200" in all_content
