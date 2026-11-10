"""Avatar ownership, real image validation and isolated Supabase persistence."""

import io
from unittest.mock import AsyncMock

import httpx
import pytest
from PIL import Image
from sqlalchemy import select

from app.core.config import get_settings
from app.core.security import issue_token
from app.features.accounts import avatars
from app.infrastructure import object_storage
from app.infrastructure.database import tables


def auth(user):
    return {"Authorization": "Bearer " + issue_token(user)}


def picture(format="PNG", size=(20, 20)):
    stream = io.BytesIO()
    Image.new("RGB", size, "white").save(stream, format=format)
    return stream.getvalue()


@pytest.fixture
def storage_settings(monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "supabase_url", "https://isolated.supabase.co")
    monkeypatch.setattr(settings, "supabase_secret_key", "sb_secret_isolated_backend_secret")
    return settings


async def test_public_avatar_returns_safe_url_and_missing_avatar_404(client, seed_user):
    user = await seed_user()
    url = f"/api/user/{user['id']}/avatar"
    assert (await client.get(url)).status_code == 404
    avatar = "https://images.example.test/avatar.png"
    updated = await client.post(url, headers=auth(user), json={"url": avatar})
    assert updated.status_code == 200 and updated.json() == {"avatarUrl": avatar}
    assert (await client.get(url)).json() == {"avatarUrl": avatar}
    assert (await client.get("/api/user/missing/avatar")).status_code == 404


@pytest.mark.parametrize("role", ["PATIENT", "ADMIN"])
async def test_avatar_update_and_upload_cannot_target_another_user_even_as_admin(client, seed_user, role):
    owner, actor = await seed_user(), await seed_user(role)
    url = f"/api/user/{owner['id']}/avatar"
    assert (
        await client.post(url, headers=auth(actor), json={"avatarUrl": "https://images.example.test/a.png"})
    ).status_code == 403
    assert (
        await client.post(
            url + "/upload", headers=auth(actor), files={"file": ("a.png", picture(), "image/png")}
        )
    ).status_code == 403


@pytest.mark.parametrize(
    "payload", [{}, {"url": "http://images.example.test/a.png"}, {"avatarUrl": "https://localhost/a.png"}]
)
async def test_invalid_avatar_payload_cannot_replace_existing_url(client, db, seed_user, payload):
    avatar = "https://images.example.test/original.png"
    user = await seed_user(profileImageUrl=avatar)
    response = await client.post(f"/api/user/{user['id']}/avatar", headers=auth(user), json=payload)
    assert response.status_code == 400
    assert (
        await db.execute(select(tables["User"].c.profileImageUrl).where(tables["User"].c.id == user["id"]))
    ).scalar_one() == avatar


@pytest.mark.parametrize(
    "content,mime,status",
    [
        (b"", "image/png", 400),
        (b"document", "application/pdf", 400),
        (b"x" * (5 * 1024 * 1024 + 1), "image/png", 400),
        (b"not an image", "image/png", 400),
        (picture(), "image/jpeg", 400),
        (picture(), "image/png", 503),
    ],
)
async def test_avatar_upload_validates_content_and_storage_configuration(
    client, seed_user, content, mime, status
):
    user = await seed_user()
    response = await client.post(
        f"/api/user/{user['id']}/avatar/upload", headers=auth(user), files={"file": ("upload", content, mime)}
    )
    assert response.status_code == status


@pytest.mark.parametrize(
    "format,mime",
    [("PNG", "image/png"), ("JPEG", "image/jpeg"), ("WEBP", "image/webp"), ("GIF", "image/gif")],
)
async def test_avatar_is_normalized_and_stored_in_separate_public_bucket(
    client, db, seed_user, monkeypatch, storage_settings, format, mime
):
    user = await seed_user()
    requests = []

    def upload(request):
        requests.append(request)
        return httpx.Response(200, json={"Key": request.url.path.removeprefix("/storage/v1/object/")})

    original = httpx.AsyncClient
    monkeypatch.setattr(
        object_storage.httpx,
        "AsyncClient",
        lambda **kwargs: original(transport=httpx.MockTransport(upload), **kwargs),
    )
    response = await client.post(
        f"/api/user/{user['id']}/avatar/upload",
        headers=auth(user),
        files={"file": ("photo", picture(format, (1024, 600)), mime)},
    )
    assert response.status_code == 200
    avatar = response.json()["avatarUrl"]
    assert avatar.startswith(
        "https://isolated.supabase.co/storage/v1/object/public/quick-clinic-avatars/avatars/"
    )
    assert "sb_secret" not in avatar
    (request,) = requests
    assert request.headers["apikey"] == storage_settings.supabase_secret_key
    assert request.headers["x-upsert"] == "false"
    assert request.headers["content-type"] == "image/webp"
    with Image.open(io.BytesIO(request.content)) as image:
        assert image.format == "WEBP" and max(image.size) <= 512
        assert not image.getexif()
    stored = (
        await db.execute(select(tables["User"].c.profileImageUrl).where(tables["User"].c.id == user["id"]))
    ).scalar_one()
    assert stored == avatar


@pytest.mark.parametrize("failure", ["timeout", "server-error", "redirect"])
async def test_avatar_provider_failure_is_sanitized_and_preserves_original(
    client, db, seed_user, monkeypatch, storage_settings, failure
):
    old = "https://images.example.test/old.png"
    user = await seed_user(profileImageUrl=old)

    def fail(request):
        if failure == "timeout":
            raise httpx.ReadTimeout(storage_settings.supabase_secret_key, request=request)
        return httpx.Response(
            500 if failure == "server-error" else 302,
            headers={"Location": "https://attacker.test"},
            text=storage_settings.supabase_secret_key,
        )

    original = httpx.AsyncClient
    monkeypatch.setattr(
        object_storage.httpx,
        "AsyncClient",
        lambda **kwargs: original(transport=httpx.MockTransport(fail), **kwargs),
    )
    response = await client.post(
        f"/api/user/{user['id']}/avatar/upload",
        headers=auth(user),
        files={"file": ("photo.png", picture(), "image/png")},
    )
    assert response.status_code == 502 and storage_settings.supabase_secret_key not in response.text
    assert (
        await db.execute(select(tables["User"].c.profileImageUrl).where(tables["User"].c.id == user["id"]))
    ).scalar_one() == old


async def test_avatar_write_failure_removes_only_new_object(seed_user, db, monkeypatch, storage_settings):
    from fastapi import UploadFile

    user = await seed_user()
    uploaded, removed = AsyncMock(), AsyncMock()
    monkeypatch.setattr(object_storage, "upload_object", uploaded)
    monkeypatch.setattr(object_storage, "delete_object", removed)
    failing_db = AsyncMock()
    failing_db.execute.side_effect = RuntimeError("synthetic database failure")
    file = UploadFile(io.BytesIO(picture()), filename="photo.png", headers={"content-type": "image/png"})
    with pytest.raises(RuntimeError, match="synthetic database failure"):
        await avatars.upload_avatar(user["id"], file, user, failing_db)
    uploaded.assert_awaited_once()
    removed.assert_awaited_once_with(*uploaded.await_args.args[:2])


@pytest.mark.parametrize(
    "format,mime",
    [("PNG", "image/png"), ("JPEG", "image/jpeg"), ("GIF", "image/gif"), ("WEBP", "image/webp")],
)
def test_avatar_preparation_accepts_only_matching_real_formats(format, mime):
    result = avatars.prepare_avatar(picture(format), mime)
    assert result.startswith(b"RIFF")


def test_avatar_dimension_budget_rejects_valid_but_oversized_picture(monkeypatch):
    monkeypatch.setattr(avatars, "MAX_AVATAR_PIXELS", 20)
    with pytest.raises(Exception) as error:
        avatars.prepare_avatar(picture(), "image/png")
    assert error.value.status_code == 400
