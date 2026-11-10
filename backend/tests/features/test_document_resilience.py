"""Medical document filtering, quotas, compensation and provider failure isolation."""

import io
from datetime import datetime
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException
from pypdf import PdfWriter
from sqlalchemy import insert, select

from app.core.security import issue_token
from app.features.documents import files, service
from app.features.documents.schemas import DocumentUpload
from app.infrastructure.database import new_id, tables


def pdf():
    stream = io.BytesIO()
    writer = PdfWriter()
    writer.add_blank_page(width=72, height=72)
    writer.write(stream)
    return stream.getvalue()


def auth(user):
    return {"Authorization": f"Bearer {issue_token(user)}"}


async def upload(client, patient, metadata=None, key=None):
    return await client.post(
        "/api/patients/me/medical-documents",
        headers={**auth(patient), **({"Idempotency-Key": key} if key else {})},
        data={"title": "Synthetic report", "type": "OTHER", "reportDate": "2030-01-01", **(metadata or {})},
        files={"file": ("report.pdf", pdf(), "application/pdf")},
    )


async def stored_row(db, patient, **fields):
    identifier = new_id()
    await db.execute(
        insert(tables["MedicalDocument"]).values(
            id=identifier,
            patientId=patient["patientId"],
            title="Synthetic record",
            type="OTHER",
            fileName="record.pdf",
            mimeType="application/pdf",
            fileSize=fields.pop("fileSize", 1),
            storagePath="local/synthetic/" + identifier,
            reportDate=datetime(2030, 1, 1),
            **fields,
        )
    )
    return identifier


@pytest.mark.parametrize(
    "metadata",
    [
        {"title": " "},
        {"title": "x" * 201},
        {"type": "CHATBOT"},
        {"reportDate": "invalid"},
        {"notes": "x" * 5001},
        {"hospitalOrDoctor": "x" * 301},
    ],
)
async def test_invalid_metadata_never_writes_storage(client, seed_user, monkeypatch, metadata):
    patient = await seed_user()
    write = AsyncMock()
    monkeypatch.setattr(files, "write_file", write)
    result = await upload(client, patient, metadata)
    assert result.status_code == 400
    write.assert_not_awaited()


@pytest.mark.parametrize("key", ["short", "contains spaces", "x" * 129, "../unsafe-key"])
async def test_invalid_idempotency_keys_never_write_storage(client, seed_user, monkeypatch, key):
    write = AsyncMock()
    monkeypatch.setattr(files, "write_file", write)
    assert (await upload(client, await seed_user(), key=key)).status_code == 400
    write.assert_not_awaited()


async def test_byte_quota_is_patient_scoped_and_checked_before_upload(client, db, seed_user, monkeypatch):
    patient, other = await seed_user(), await seed_user()
    await stored_row(db, patient, fileSize=100 * 1024 * 1024)
    write = AsyncMock()
    monkeypatch.setattr(files, "write_file", write)
    assert (await upload(client, patient)).status_code == 403
    write.assert_not_awaited()
    assert (await upload(client, other)).status_code == 201
    write.assert_awaited_once()


async def test_document_filters_are_patient_scoped_escape_wildcards_and_sort_by_report_date(
    client, seed_user
):
    patient, other = await seed_user(), await seed_user()
    await upload(client, patient, {"title": "100%_result", "type": "LAB_REPORT", "reportDate": "2030-01-02"})
    await upload(client, patient, {"title": "100XXresult", "type": "OTHER", "reportDate": "2030-01-01"})
    await upload(client, other, {"title": "100%_result", "type": "LAB_REPORT", "reportDate": "2030-01-02"})
    root = "/api/patients/me/medical-documents"
    response = await client.get(
        root,
        headers=auth(patient),
        params={"search": "100%_", "type": "LAB_REPORT", "fileType": "PDF", "reportDate": "2030-01-02"},
    )
    assert [row["title"] for row in response.json()["documents"]] == ["100%_result"]
    rows = (await client.get(root, headers=auth(patient), params={"sort": "oldest"})).json()["documents"]
    assert [row["title"] for row in rows] == ["100XXresult", "100%_result"]
    assert (await client.get(root, headers=auth(patient), params={"fileType": "IMAGE"})).json()[
        "documents"
    ] == []
    assert (
        await client.get(root, headers=auth(patient), params={"reportDate": "invalid"})
    ).status_code == 400


async def test_download_uses_attachment_sandbox_and_private_headers_and_audits_access(client, db, seed_user):
    patient = await seed_user()
    identifier = (await upload(client, patient)).json()["document"]["id"]
    result = await client.get(
        f"/api/patients/me/medical-documents/{identifier}/file?action=download", headers=auth(patient)
    )
    assert result.status_code == 200 and result.content == pdf()
    assert result.headers["content-disposition"].startswith("attachment;")
    assert result.headers["content-security-policy"] == "sandbox"
    assert result.headers["x-content-type-options"] == "nosniff"
    actions = set((await db.execute(select(tables["AccessLog"].c.action))).scalars())
    assert {"MEDICAL_DOCUMENT_UPLOAD", "MEDICAL_DOCUMENT_DOWNLOAD"} <= actions


async def test_idempotency_is_patient_scoped_and_retry_at_quota_does_not_rewrite_file(
    client, db, seed_user, monkeypatch
):
    patient, other = await seed_user(), await seed_user()
    write = AsyncMock()
    monkeypatch.setattr(files, "write_file", write)
    first = await upload(client, patient, key="synthetic-upload-key")
    second = await upload(client, other, key="synthetic-upload-key")
    assert first.json()["document"]["id"] != second.json()["document"]["id"]
    monkeypatch.setattr(service, "MAX_ACCOUNT_DOCUMENTS", 1)
    retry = await upload(client, patient, key="synthetic-upload-key")
    assert retry.status_code == 200
    assert write.await_count == 2


async def test_storage_write_failure_leaves_no_document_or_upload_audit(db, seed_user, monkeypatch):
    patient = await seed_user()
    monkeypatch.setattr(files, "write_file", AsyncMock(side_effect=HTTPException(502, "Storage unavailable")))
    metadata = DocumentUpload(title="Synthetic", type="OTHER", reportDate="2030-01-01")
    with pytest.raises(HTTPException):
        await service.upload_patient_document(
            db, patient, metadata, pdf(), "report.pdf", "application/pdf", None
        )
    assert not (await db.execute(select(tables["MedicalDocument"]))).first()
    assert not (await db.execute(select(tables["AccessLog"]))).first()


async def test_metadata_failure_compensates_private_file_and_propagates_original_error(
    db, seed_user, monkeypatch
):
    patient = await seed_user()
    write, remove = AsyncMock(), AsyncMock()
    monkeypatch.setattr(files, "write_file", write)
    monkeypatch.setattr(files, "remove_file", remove)
    monkeypatch.setattr(
        service, "record_access", AsyncMock(side_effect=RuntimeError("synthetic audit failure"))
    )
    metadata = DocumentUpload(title="Synthetic", type="OTHER", reportDate="2030-01-01")
    with pytest.raises(RuntimeError, match="synthetic audit failure"):
        await service.upload_patient_document(
            db, patient, metadata, pdf(), "report.pdf", "application/pdf", None
        )
    remove.assert_awaited_once_with(write.await_args.args[0])
    await db.rollback()


async def test_compensation_failure_logs_no_patient_or_storage_identifiers(
    db, seed_user, monkeypatch, caplog
):
    patient = await seed_user()
    monkeypatch.setattr(files, "write_file", AsyncMock())
    monkeypatch.setattr(files, "remove_file", AsyncMock(side_effect=RuntimeError("provider-secret-token")))
    monkeypatch.setattr(
        service, "record_access", AsyncMock(side_effect=RuntimeError("synthetic audit failure"))
    )
    metadata = DocumentUpload(title="Synthetic", type="OTHER", reportDate="2030-01-01")
    with pytest.raises(RuntimeError, match="synthetic audit failure"):
        await service.upload_patient_document(
            db, patient, metadata, pdf(), "report.pdf", "application/pdf", None
        )
    assert "Orphaned medical file" in caplog.text
    assert patient["id"] not in caplog.text and "provider-secret-token" not in caplog.text
    await db.rollback()


async def test_delete_provider_failure_preserves_metadata_and_no_delete_audit(db, seed_user, monkeypatch):
    patient = await seed_user()
    identifier = await stored_row(db, patient)
    monkeypatch.setattr(files, "check_managed_file", lambda key: None)
    monkeypatch.setattr(
        files, "remove_file", AsyncMock(side_effect=HTTPException(502, "Storage unavailable"))
    )
    with pytest.raises(HTTPException):
        await service.delete_patient_document(db, patient, identifier)
    assert (await db.execute(select(tables["MedicalDocument"].c.id))).scalar_one() == identifier
    assert not (await db.execute(select(tables["AccessLog"]))).first()
