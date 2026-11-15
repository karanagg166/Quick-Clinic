"""Ingestion and normalization acceptance tests across diverse PDF document conditions."""

import pytest
from sqlalchemy import select

from app.features.documents.pipeline_runner import run_document_ingestion
from app.infrastructure.database import tables, utcnow

from .corpus_fixtures import (
    make_chart_pdf,
    make_diagram_pdf,
    make_image_pdf,
    make_multipage_table_pdf,
    make_multipage_text_pdf,
    make_partially_unreadable_pdf,
    make_scanned_ocr_pdf,
    make_text_and_tables_pdf,
)


async def _mock_embed_coro(texts: list[str]):
    return ("cohere", "embed-english-light-v3.0", [[0.0] * 384 for _ in texts])


async def _seed_corpus_doc(db, doc_id: str, title: str, doc_type: str = "OTHER"):
    now = utcnow()
    # Ensure patient exists
    existing = (
        await db.execute(select(tables["Patient"]).where(tables["Patient"].c.id == "pat_corp_ext"))
    ).first()
    if not existing:
        await db.execute(tables["Location"].insert().values(pincode=560001, city="Bengaluru", state="KA"))
        await db.execute(
            tables["User"].insert().values(
                id="u_corp_ext", email="corpext@example.com", phoneNo="9666666661", name="Corpus Ext",
                password="hash", age=40, gender="MALE", role="PATIENT", address="Addr",
                pinCode=560001, isActive=True, createdAt=now, updatedAt=now,
            )
        )
        await db.execute(
            tables["Patient"].insert().values(
                id="pat_corp_ext", userId="u_corp_ext", medicalHistory="None",
                allergies="None", currentMedications="None", createdAt=now, updatedAt=now,
            )
        )

    await db.execute(
        tables["MedicalDocument"].insert().values(
            id=doc_id, patientId="pat_corp_ext", title=title, type=doc_type,
            fileName=f"{doc_id}.pdf", mimeType="application/pdf", fileSize=2048,
            storagePath=f"local/pat_corp_ext/{doc_id}.pdf", reportDate=now,
            processingStatus="PENDING", createdAt=now, updatedAt=now,
        )
    )


@pytest.mark.integration
@pytest.mark.asyncio
async def test_multipage_narrative_and_table_continuations(db, monkeypatch):
    """Test multi-page text and multi-page table PDF extraction and chunking."""
    monkeypatch.setattr("app.features.documents.embeddings.embed_texts", lambda texts: _mock_embed_coro(texts))

    # Condition 2: Multi-page text
    await _seed_corpus_doc(db, "doc_c2_multipage", "Multi-page Progress Notes")
    res2 = await run_document_ingestion(db, document_id="doc_c2_multipage", data=make_multipage_text_pdf(pages=3))
    assert res2["status"] == "COMPLETED"
    assert res2["chunkCount"] >= 1

    chunks2 = (
        await db.execute(
            select(tables["MedicalDocumentChunk"]).where(tables["MedicalDocumentChunk"].c.versionId == res2["versionId"])
        )
    ).mappings().all()
    all_pages2 = {p for c in chunks2 for p in c["pageNumbers"]}
    assert {1, 2, 3} <= all_pages2

    # Condition 4: Multi-page table
    await _seed_corpus_doc(db, "doc_c4_table", "Medication Administration Table")
    res4 = await run_document_ingestion(db, document_id="doc_c4_table", data=make_multipage_table_pdf())
    assert res4["status"] == "COMPLETED"
    assert res4["chunkCount"] >= 1


@pytest.mark.integration
@pytest.mark.asyncio
async def test_images_charts_and_diagrams(db, monkeypatch):
    """Test clinical image, bar chart, and diagnostic diagram PDFs."""
    monkeypatch.setattr("app.features.documents.embeddings.embed_texts", lambda texts: _mock_embed_coro(texts))

    # Condition 5: Clinical image PDF
    await _seed_corpus_doc(db, "doc_c5_img", "Dermatology Scan")
    res5 = await run_document_ingestion(db, document_id="doc_c5_img", data=make_image_pdf())
    assert res5["status"] == "COMPLETED"

    # Condition 7: Bar chart PDF
    await _seed_corpus_doc(db, "doc_c7_chart", "BP Monitoring Chart")
    res7 = await run_document_ingestion(db, document_id="doc_c7_chart", data=make_chart_pdf())
    assert res7["status"] == "COMPLETED"
    assert res7["chunkCount"] >= 1

    # Condition 8: Diagram PDF
    await _seed_corpus_doc(db, "doc_c8_diag", "Chest Pain Pathway")
    res8 = await run_document_ingestion(db, document_id="doc_c8_diag", data=make_diagram_pdf())
    assert res8["status"] == "COMPLETED"


@pytest.mark.integration
@pytest.mark.asyncio
async def test_scanned_ocr_mixed_text_and_partial_unreadable(db, monkeypatch):
    """Test scanned OCR page, narrative+tables, and partially noisy documents."""
    monkeypatch.setattr("app.features.documents.embeddings.embed_texts", lambda texts: _mock_embed_coro(texts))

    # Condition 6: Scanned OCR PDF
    await _seed_corpus_doc(db, "doc_c6_ocr", "Scanned Pathology")
    res6 = await run_document_ingestion(db, document_id="doc_c6_ocr", data=make_scanned_ocr_pdf())
    assert res6["status"] in {"COMPLETED", "PARTIAL"}

    # Condition 9: Narrative + Tables
    await _seed_corpus_doc(db, "doc_c9_mixed", "Discharge Summary & Meds")
    res9 = await run_document_ingestion(db, document_id="doc_c9_mixed", data=make_text_and_tables_pdf())
    assert res9["status"] == "COMPLETED"
    assert res9["chunkCount"] >= 1

    # Condition 10: Partially unreadable
    await _seed_corpus_doc(db, "doc_c10_partial", "Partially Unreadable Note")
    res10 = await run_document_ingestion(db, document_id="doc_c10_partial", data=make_partially_unreadable_pdf())
    assert res10["status"] in {"COMPLETED", "PARTIAL"}
    assert res10["chunkCount"] >= 1
