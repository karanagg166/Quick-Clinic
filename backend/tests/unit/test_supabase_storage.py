"""Private object storage requests, bounded downloads and provider failure handling."""

import json

import httpx
import pytest
from fastapi import HTTPException
from unittest.mock import AsyncMock

from app.core.config import get_settings
from app.features.documents import files, supabase_storage
from app.infrastructure import object_storage


@pytest.fixture
def configured(monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "supabase_url", "https://isolated.supabase.co")
    monkeypatch.setattr(settings, "supabase_secret_key", "sb_secret_isolated_backend_secret")
    monkeypatch.setattr(settings, "document_storage_backend", "supabase")
    return settings


@pytest.mark.parametrize(
    "url",
    [
        "",
        "http://isolated.supabase.co",
        "https://attacker.test",
        "https://isolated.supabase.co@attacker.test",
        "https://isolated.supabase.co/private",
        "https://isolated.supabase.co?secret=1",
        "https://isolated.supabase.co#fragment",
        "https://isolated.supabase.co:443",
        "https://[invalid",
    ],
)
def test_storage_configuration_rejects_unsafe_endpoints(monkeypatch, configured, url):
    monkeypatch.setattr(configured, "supabase_url", url)
    with pytest.raises(HTTPException) as error:
        object_storage.configuration()
    assert error.value.status_code == 503


@pytest.mark.parametrize(
    "key", ["", "publishable-key", "sb_publishable_test", "sb_secret_key\n", "sb_secret_key with space"]
)
def test_storage_requires_backend_secret_key(monkeypatch, configured, key):
    monkeypatch.setattr(configured, "supabase_secret_key", key)
    with pytest.raises(HTTPException) as error:
        object_storage.configuration()
    assert error.value.status_code == 503


@pytest.mark.parametrize(
    "bucket,path",
    [
        ("../private", "a"),
        ("valid", "../private"),
        ("valid", "a/../b"),
        ("valid", "a//b"),
        ("valid", "/a"),
        ("valid", "https://attacker.test"),
        ("valid", "a%2Fb"),
        ("valid", "a?key"),
        ("", "a"),
        ("valid", ""),
    ],
)
def test_object_paths_cannot_escape_bucket(bucket, path):
    with pytest.raises(HTTPException) as error:
        object_storage.object_path(bucket, path)
    assert error.value.status_code == 404


@pytest.mark.parametrize(
    "key",
    [
        "cloudinary/quickclinic/medical-documents/a",
        "supabase/../secret",
        "supabase/quickclinic/medical-documents/a//b",
        "local/a",
        "supabase/quickclinic/medical-documents/a.pdf",
        None,
    ],
)
def test_private_document_key_validation_rejects_legacy_and_malformed_paths(key):
    with pytest.raises(HTTPException) as error:
        supabase_storage.asset_id(key)
    assert error.value.status_code == 404


async def test_upload_download_delete_use_authenticated_requests_without_public_medical_urls(
    monkeypatch, configured
):
    calls = []

    def handle(request):
        calls.append(request)
        return httpx.Response(200, content=b"synthetic" if request.method == "GET" else b"{}")

    original = httpx.AsyncClient
    monkeypatch.setattr(
        object_storage.httpx,
        "AsyncClient",
        lambda **kwargs: original(transport=httpx.MockTransport(handle), **kwargs),
    )
    key = await files.write_file(
        "supabase/quickclinic/medical-documents/patient/document/hash",
        b"synthetic",
        "document.pdf",
        "application/pdf",
    )
    assert key.startswith("supabase/")
    response = await files.file_response(
        {"storagePath": key, "fileSize": 9, "fileName": "report.pdf", "mimeType": "application/pdf"},
        "download",
    )
    assert response.body == b"synthetic"
    assert response.headers["cache-control"] == "private, no-store"
    assert response.headers["content-security-policy"] == "sandbox"
    assert response.headers["content-disposition"].startswith("attachment;")
    await files.remove_file(key)
    assert [call.method for call in calls] == ["POST", "GET", "DELETE"]
    assert all(call.headers["apikey"] == configured.supabase_secret_key for call in calls)
    assert all("/public/" not in str(call.url) for call in calls)
    assert "/object/authenticated/quick-clinic-medical-documents/" in str(calls[1].url)
    assert json.loads(calls[2].content) == {"prefixes": [key.removeprefix("supabase/")]}


@pytest.mark.parametrize(
    "status,expected", [(401, 502), (403, 502), (404, 404), (429, 502), (500, 502), (302, 502)]
)
async def test_download_provider_errors_do_not_disclose_body_or_follow_redirects(
    monkeypatch, configured, status, expected
):
    calls = []

    def handle(request):
        calls.append(request)
        return httpx.Response(
            status, text=configured.supabase_secret_key, headers={"Location": "https://attacker.test"}
        )

    original = httpx.AsyncClient
    monkeypatch.setattr(
        object_storage.httpx,
        "AsyncClient",
        lambda **kwargs: original(transport=httpx.MockTransport(handle), **kwargs),
    )
    with pytest.raises(HTTPException) as error:
        await object_storage.download_object(configured.supabase_document_bucket, "a")
    assert error.value.status_code == expected
    assert configured.supabase_secret_key not in str(error.value.detail)
    assert len(calls) == 1


@pytest.mark.parametrize("length", ["10000000", "-1", "invalid"])
async def test_download_rejects_invalid_or_oversized_declared_length(monkeypatch, configured, length):
    original = httpx.AsyncClient
    monkeypatch.setattr(
        object_storage.httpx,
        "AsyncClient",
        lambda **kwargs: original(
            transport=httpx.MockTransport(
                lambda request: httpx.Response(200, content=b"synthetic", headers={"Content-Length": length})
            ),
            **kwargs,
        ),
    )
    with pytest.raises(HTTPException) as error:
        await object_storage.download_object(configured.supabase_document_bucket, "a", max_bytes=10)
    assert error.value.status_code == 502


async def test_download_checks_actual_bytes_even_without_content_length(monkeypatch, configured):
    class Stream(httpx.AsyncByteStream):
        async def __aiter__(self):
            yield b"123456"
            yield b"789012"

    original = httpx.AsyncClient
    monkeypatch.setattr(
        object_storage.httpx,
        "AsyncClient",
        lambda **kwargs: original(
            transport=httpx.MockTransport(lambda request: httpx.Response(200, stream=Stream())), **kwargs
        ),
    )
    with pytest.raises(HTTPException) as error:
        await object_storage.download_object(configured.supabase_document_bucket, "a", max_bytes=10)
    assert error.value.status_code == 502


async def test_storage_timeout_is_sanitized(monkeypatch, configured):
    def fail(request):
        raise httpx.ReadTimeout(configured.supabase_secret_key, request=request)

    original = httpx.AsyncClient
    monkeypatch.setattr(
        object_storage.httpx,
        "AsyncClient",
        lambda **kwargs: original(transport=httpx.MockTransport(fail), **kwargs),
    )
    with pytest.raises(HTTPException) as error:
        await object_storage.download_object(configured.supabase_document_bucket, "a")
    assert error.value.status_code == 502 and configured.supabase_secret_key not in str(error.value.detail)


async def test_deleting_already_missing_object_is_idempotent(monkeypatch, configured):
    original = httpx.AsyncClient
    monkeypatch.setattr(
        object_storage.httpx,
        "AsyncClient",
        lambda **kwargs: original(
            transport=httpx.MockTransport(lambda request: httpx.Response(404)), **kwargs
        ),
    )
    await object_storage.delete_object(configured.supabase_document_bucket, "a")


@pytest.mark.parametrize(
    "data,mime",
    [(b"", "image/png"), (b"123456", "image/png"), (b"123", "image/png\r\nsecret"), ("123", "image/png")],
)
async def test_invalid_upload_is_rejected_before_network(configured, data, mime):
    with pytest.raises(HTTPException) as error:
        await object_storage.upload_object(configured.supabase_document_bucket, "a", data, mime, max_bytes=5)
    assert error.value.status_code == 400


def test_public_url_is_allowed_only_for_the_avatar_bucket(configured):
    assert object_storage.public_object_url(
        configured.supabase_avatar_bucket, "avatars/random.webp"
    ).startswith("https://isolated.supabase.co/storage/v1/object/public/")
    for bucket in [configured.supabase_document_bucket, "unknown"]:
        with pytest.raises(HTTPException) as error:
            object_storage.public_object_url(bucket, "a")
        assert error.value.status_code == 403


def test_new_medical_keys_use_supabase_only(configured):
    key = files.upload_key("patient", "document", "hash")
    assert key == "supabase/quickclinic/medical-documents/patient/document/hash"
    files.check_managed_file(key)
    for legacy in ["cloudinary/quickclinic/medical-documents/legacy", "medical-documents/legacy"]:
        with pytest.raises(HTTPException) as error:
            files.check_managed_file(legacy)
        assert error.value.status_code == 409


async def test_document_metadata_size_must_match_download(monkeypatch, configured):
    monkeypatch.setattr(supabase_storage, "download_document", AsyncMock(return_value=b"different"))
    with pytest.raises(HTTPException) as error:
        await files.file_response(
            {
                "storagePath": files.upload_key("p", "d", "h"),
                "fileSize": 2,
                "fileName": "report.pdf",
                "mimeType": "application/pdf",
            },
            "view",
        )
    assert error.value.status_code == 502
