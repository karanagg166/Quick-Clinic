"""Private cloud storage is tested without sending any file to an external account."""

import io
from unittest.mock import Mock
import pytest
import httpx
from fastapi import HTTPException
from pypdf import PdfWriter
from app.core.config import get_settings
from app.core.security import issue_token
from app.features.documents import cloudinary_storage as storage


@pytest.fixture
async def configured(db, monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "cloudinary_cloud_name", "isolated-cloud")
    monkeypatch.setattr(settings, "cloudinary_api_key", "isolated-key")
    monkeypatch.setattr(settings, "cloudinary_api_secret", "isolated-secret")
    return settings


async def test_upload_is_authenticated_raw_and_never_overwrites(configured, monkeypatch):
    public_id = "quickclinic/medical-documents/patient/document/fingerprint"
    upload = Mock(return_value={"public_id": public_id, "resource_type": "raw", "type": "authenticated"})
    monkeypatch.setattr(storage.cloudinary.uploader, "upload", upload)
    key = await storage.upload_document(b"private bytes", public_id, "report.pdf", "application/pdf")
    assert key == "cloudinary/" + public_id
    assert upload.call_args.kwargs["type"] == "authenticated"
    assert upload.call_args.kwargs["resource_type"] == "raw"
    assert upload.call_args.kwargs["overwrite"] is False
    assert upload.call_args.kwargs["api_secret"] == "isolated-secret"


async def test_download_uses_short_expiry_and_bounded_server_side_fetch(configured, monkeypatch):
    public_id = "quickclinic/medical-documents/patient/document/fingerprint"
    build_url = Mock(
        return_value="https://api.cloudinary.com/v1_1/isolated-cloud/raw/download?signature=private"
    )
    monkeypatch.setattr(storage.cloudinary.utils, "private_download_url", build_url)
    original_client = httpx.AsyncClient
    transport = httpx.MockTransport(lambda request: httpx.Response(200, content=b"private bytes"))
    monkeypatch.setattr(
        storage.httpx, "AsyncClient", lambda **kwargs: original_client(transport=transport, **kwargs)
    )
    result = await storage.download_document("cloudinary/" + public_id)
    assert result == b"private bytes"
    params = build_url.call_args.kwargs
    assert params["type"] == "authenticated" and params["resource_type"] == "raw"
    import time

    assert 0 < params["expires_at"] - time.time() <= 60


async def test_storage_errors_do_not_expose_provider_details(configured, monkeypatch):
    monkeypatch.setattr(
        storage.cloudinary.uploader, "upload", Mock(side_effect=ValueError("secret/provider/details"))
    )
    with pytest.raises(HTTPException) as error:
        await storage.upload_document(
            b"bytes", "quickclinic/medical-documents/p/d/f", "a.pdf", "application/pdf"
        )
    assert error.value.status_code == 502 and "secret" not in error.value.detail
    for key in (
        "https://example.test/file",
        "cloudinary/avatars/user",
        "cloudinary/quickclinic/medical-documents/../avatar",
    ):
        with pytest.raises(HTTPException):
            storage.asset_id(key)


async def test_cloud_document_http_lifecycle_stays_private(client, seed_user, configured, monkeypatch):
    monkeypatch.setattr(configured, "document_storage_backend", "cloudinary")
    files = {}

    async def store(data, public_id, filename, mime_type):
        files["cloudinary/" + public_id] = data
        return "cloudinary/" + public_id

    async def download(key):
        return files[key]

    async def destroy(key):
        files.pop(key, None)

    monkeypatch.setattr(storage, "upload_document", store)
    monkeypatch.setattr(storage, "download_document", download)
    monkeypatch.setattr(storage, "delete_document", destroy)
    patient = await seed_user()
    stranger = await seed_user()
    headers = {"Authorization": "Bearer " + issue_token(patient)}
    content = io.BytesIO()
    writer = PdfWriter()
    writer.add_blank_page(width=72, height=72)
    writer.write(content)
    payload = dict(
        data={"title": "Private report", "type": "LAB_REPORT", "reportDate": "2026-11-10"},
        files={"file": ("report.pdf", content.getvalue(), "application/pdf")},
    )
    created = await client.post("/api/patients/me/medical-documents", headers=headers, **payload)
    assert created.status_code == 201, created.text
    identifier = created.json()["document"]["id"]
    assert "storagePath" not in created.json()["document"] and len(files) == 1
    path = f"/api/patients/me/medical-documents/{identifier}"
    access = await client.get(path + "/access", headers=headers)
    assert access.json()["url"].startswith("/api/")
    assert (await client.get(access.json()["url"], headers=headers)).content == content.getvalue()
    other = {"Authorization": "Bearer " + issue_token(stranger)}
    assert (await client.get(access.json()["url"], headers=other)).status_code == 404
    assert (await client.delete(path, headers=headers)).status_code == 200
    assert not files
