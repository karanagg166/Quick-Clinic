"""Ingestion and normalization acceptance tests across diverse PDF document conditions."""

import pytest
from sqlalchemy import select

from app.features.documents.pipeline_runner import run_document_ingestion
from app.infrastructure.database import tables, utcnow

from .corpus_fixtures import (
    make_chart_pdf,
    make_diagram_pdf,
    make_image_pdf,
    make_lab_report_pdf,
    make_line_chart_pdf,
    make_multipage_table_pdf,
    make_multipage_text_pdf,
    make_partially_unreadable_pdf,
    make_pie_chart_pdf,
    make_scanned_ocr_pdf,
    make_simple_text_pdf,
    make_text_and_tables_pdf,
)


async def _mock_embed_coro(texts: list[str]):
    return ("cohere", "embed-english-light-v3.0", [[0.0] * 384 for _ in texts])


async def _seed_corpus_doc(db, doc_id: str, title: str, doc_type: str = "OTHER"):
    now = utcnow()
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
async def test_simple_text_and_structured_lab_report_content(db, monkeypatch):
    """Test Condition 1 (Simple Text) and Condition 3 (Structured Lab Report) with content assertions."""
    monkeypatch.setattr("app.features.documents.embeddings.embed_texts", lambda texts: _mock_embed_coro(texts))

    await _seed_corpus_doc(db, "doc_c1_simple", "Alice Outpatient")
    res1 = await run_document_ingestion(db, document_id="doc_c1_simple", data=make_simple_text_pdf())
    assert res1["status"] == "COMPLETED"
    chunks1 = (
        await db.execute(
            select(tables["MedicalDocumentChunk"]).where(tables["MedicalDocumentChunk"].c.versionId == res1["versionId"])
        )
    ).mappings().all()
    c1_text = " ".join(c["content"] for c in chunks1)
    assert "Alice Walker" in c1_text
    assert "Allergic rhinitis" in c1_text
    assert "Cetirizine 10mg" in c1_text

    await _seed_corpus_doc(db, "doc_c3_lab", "Comprehensive Metabolic Panel", "LAB_REPORT")
    res3 = await run_document_ingestion(db, document_id="doc_c3_lab", data=make_lab_report_pdf())
    assert res3["status"] == "COMPLETED"
    chunks3 = (
        await db.execute(
            select(tables["MedicalDocumentChunk"]).where(tables["MedicalDocumentChunk"].c.versionId == res3["versionId"])
        )
    ).mappings().all()
    c3_text = " ".join(c["content"] for c in chunks3)
    assert "Serum Glucose" in c3_text
    assert "94" in c3_text
    assert "mg/dL" in c3_text
    assert "Blood Urea Nitrogen" in c3_text
    assert "15" in c3_text
    assert "Serum Creatinine" in c3_text
    assert "0.92" in c3_text


@pytest.mark.integration
@pytest.mark.asyncio
async def test_multipage_narrative_and_table_continuations(db, monkeypatch):
    """Test Condition 2 (Multi-page text) and Condition 4 (Multi-page table continuations)."""
    monkeypatch.setattr("app.features.documents.embeddings.embed_texts", lambda texts: _mock_embed_coro(texts))

    # Condition 2: Multi-page text
    await _seed_corpus_doc(db, "doc_c2_multipage", "Multi-page Progress Notes")
    res2 = await run_document_ingestion(db, document_id="doc_c2_multipage", data=make_multipage_text_pdf(pages=3))
    assert res2["status"] == "COMPLETED"
    chunks2 = (
        await db.execute(
            select(tables["MedicalDocumentChunk"]).where(tables["MedicalDocumentChunk"].c.versionId == res2["versionId"])
        )
    ).mappings().all()
    all_pages2 = {p for c in chunks2 for p in c["pageNumbers"]}
    assert {1, 2, 3} <= all_pages2
    c2_text = " ".join(c["content"] for c in chunks2)
    assert "INPATIENT PROGRESS NOTE" in c2_text
    assert "Blood Pressure 122/78 mmHg" in c2_text
    assert "DAY 3" in c2_text

    # Condition 4: Multi-page table continuation
    await _seed_corpus_doc(db, "doc_c4_table", "Medication Administration Table")
    res4 = await run_document_ingestion(db, document_id="doc_c4_table", data=make_multipage_table_pdf())
    assert res4["status"] == "COMPLETED"
    chunks4 = (
        await db.execute(
            select(tables["MedicalDocumentChunk"]).where(tables["MedicalDocumentChunk"].c.versionId == res4["versionId"])
        )
    ).mappings().all()
    c4_text = " ".join(c["content"] for c in chunks4)
    assert "Metformin" in c4_text and "500mg" in c4_text
    assert "Atorvastatin" in c4_text and "Aspirin" in c4_text


@pytest.mark.integration
@pytest.mark.asyncio
async def test_images_charts_and_diagrams(db, monkeypatch):
    """Test Condition 5 (Image), Condition 7 (Bar chart), and Condition 8 (Diagram)."""
    monkeypatch.setattr("app.features.documents.embeddings.embed_texts", lambda texts: _mock_embed_coro(texts))

    # Condition 5: Clinical image PDF
    await _seed_corpus_doc(db, "doc_c5_img", "Dermatology Scan")
    res5 = await run_document_ingestion(db, document_id="doc_c5_img", data=make_image_pdf())
    assert res5["status"] == "COMPLETED"
    chunks5 = (
        await db.execute(
            select(tables["MedicalDocumentChunk"]).where(tables["MedicalDocumentChunk"].c.versionId == res5["versionId"])
        )
    ).mappings().all()
    assert any("DERMATOLOGY" in c["content"] for c in chunks5)

    # Condition 7: Bar chart PDF
    await _seed_corpus_doc(db, "doc_c7_chart", "BP Monitoring Chart")
    res7 = await run_document_ingestion(db, document_id="doc_c7_chart", data=make_chart_pdf())
    assert res7["status"] == "COMPLETED"
    chunks7 = (
        await db.execute(
            select(tables["MedicalDocumentChunk"]).where(tables["MedicalDocumentChunk"].c.versionId == res7["versionId"])
        )
    ).mappings().all()
    c7_text = " ".join(c["content"] for c in chunks7)
    assert "BLOOD PRESSURE MONITORING LOG" in c7_text
    assert "135" in c7_text and "128" in c7_text and "122" in c7_text

    # Condition 7b & 7c: Line chart and Pie chart PDFs
    await _seed_corpus_doc(db, "doc_c7_line", "HbA1c Trend Line Chart")
    res7b = await run_document_ingestion(db, document_id="doc_c7_line", data=make_line_chart_pdf())
    assert res7b["status"] == "COMPLETED"
    chunks7b = (
        await db.execute(
            select(tables["MedicalDocumentChunk"]).where(tables["MedicalDocumentChunk"].c.versionId == res7b["versionId"])
        )
    ).mappings().all()
    assert "6.2%" in " ".join(c["content"] for c in chunks7b)

    await _seed_corpus_doc(db, "doc_c7_pie", "Macronutrient Pie Chart")
    res7c = await run_document_ingestion(db, document_id="doc_c7_pie", data=make_pie_chart_pdf())
    assert res7c["status"] == "COMPLETED"
    chunks7c = (
        await db.execute(
            select(tables["MedicalDocumentChunk"]).where(tables["MedicalDocumentChunk"].c.versionId == res7c["versionId"])
        )
    ).mappings().all()
    assert "Carbs 50%" in " ".join(c["content"] for c in chunks7c)

    # Condition 8: Diagram PDF
    await _seed_corpus_doc(db, "doc_c8_diag", "Chest Pain Pathway")
    res8 = await run_document_ingestion(db, document_id="doc_c8_diag", data=make_diagram_pdf())
    assert res8["status"] == "COMPLETED"
    chunks8 = (
        await db.execute(
            select(tables["MedicalDocumentChunk"]).where(tables["MedicalDocumentChunk"].c.versionId == res8["versionId"])
        )
    ).mappings().all()
    c8_text = " ".join(c["content"] for c in chunks8)
    assert "DIAGNOSTIC PATHWAY" in c8_text
    assert "Troponin" in c8_text


@pytest.mark.integration
@pytest.mark.asyncio
async def test_scanned_ocr_mixed_text_and_partial_unreadable(db, monkeypatch):
    """Test Condition 6 (Scanned OCR), Condition 9 (Mixed text/tables), and Condition 10 (Partially unreadable)."""
    monkeypatch.setattr("app.features.documents.embeddings.embed_texts", lambda texts: _mock_embed_coro(texts))

    # Condition 6: Scanned OCR PDF
    # 6a. When OCR is unavailable, missing OCR must be explicitly reported as PARTIAL with issueCount >= 1
    monkeypatch.setattr("app.features.documents.pipeline_runner._build_ocr_provider", lambda: None)
    await _seed_corpus_doc(db, "doc_c6_no_ocr", "Scanned Pathology Without OCR")
    res6_no_ocr = await run_document_ingestion(db, document_id="doc_c6_no_ocr", data=make_scanned_ocr_pdf())
    assert res6_no_ocr["extractionStatus"] == "PARTIAL"
    assert res6_no_ocr["issueCount"] >= 1

    # 6b. When Tesseract OCR is available, verify actual recovered text from the image-only PDF
    monkeypatch.undo()
    monkeypatch.setattr("app.features.documents.embeddings.embed_texts", lambda texts: _mock_embed_coro(texts))
    import shutil
    if shutil.which("tesseract"):
        await _seed_corpus_doc(db, "doc_c6_ocr", "Scanned Pathology")
        res6 = await run_document_ingestion(db, document_id="doc_c6_ocr", data=make_scanned_ocr_pdf())
        assert res6["status"] == "COMPLETED"
        chunks6 = (
            await db.execute(
                select(tables["MedicalDocumentChunk"]).where(tables["MedicalDocumentChunk"].c.versionId == res6["versionId"])
            )
        ).mappings().all()
        c6_text = " ".join(c["content"] for c in chunks6).lower()
        assert "benign" in c6_text and "lymph" in c6_text

    # Condition 9: Narrative + Tables
    await _seed_corpus_doc(db, "doc_c9_mixed", "Discharge Summary & Meds")
    res9 = await run_document_ingestion(db, document_id="doc_c9_mixed", data=make_text_and_tables_pdf())
    assert res9["status"] == "COMPLETED"
    chunks9 = (
        await db.execute(
            select(tables["MedicalDocumentChunk"]).where(tables["MedicalDocumentChunk"].c.versionId == res9["versionId"])
        )
    ).mappings().all()
    c9_text = " ".join(c["content"] for c in chunks9)
    assert "DISCHARGE SUMMARY" in c9_text
    assert "acute gastroenteritis" in c9_text
    assert "Ondansetron" in c9_text and "4mg" in c9_text

    # Condition 10: Partially unreadable
    await _seed_corpus_doc(db, "doc_c10_partial", "Partially Unreadable Note")
    res10 = await run_document_ingestion(db, document_id="doc_c10_partial", data=make_partially_unreadable_pdf())
    assert res10["status"] in {"COMPLETED", "PARTIAL"}
    chunks10 = (
        await db.execute(
            select(tables["MedicalDocumentChunk"]).where(tables["MedicalDocumentChunk"].c.versionId == res10["versionId"])
        )
    ).mappings().all()
    c10_text = " ".join(c["content"] for c in chunks10)
    assert "valid medical notes" in c10_text
