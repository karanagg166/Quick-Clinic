"""Bounded image processing and public Supabase avatar persistence."""

import io
import logging
import secrets
import warnings
from urllib.parse import urlparse

from fastapi import HTTPException
from PIL import Image, ImageOps, UnidentifiedImageError
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncConnection
from starlette.concurrency import run_in_threadpool

from app.core.config import get_settings
from app.core.security import ensure_owner
from app.infrastructure import object_storage
from app.infrastructure.database import tables, utcnow

logger = logging.getLogger(__name__)
MAX_AVATAR_BYTES = 5 * 1024 * 1024
MAX_AVATAR_PIXELS = 20_000_000
AVATAR_FORMATS = {"image/jpeg": "JPEG", "image/png": "PNG", "image/webp": "WEBP", "image/gif": "GIF"}


def prepare_avatar(content: bytes, content_type: str) -> bytes:
    """Decode actual image bytes and remove metadata through bounded WebP encoding."""
    if content_type not in AVATAR_FORMATS:
        raise HTTPException(400, "File must be a JPEG, PNG, WebP or GIF image")
    if not content or len(content) > MAX_AVATAR_BYTES:
        raise HTTPException(400, "File size must be between 1 byte and 5MB")
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(content), formats=list(AVATAR_FORMATS.values())) as image:
                if image.format != AVATAR_FORMATS[content_type]:
                    raise ValueError("Image content does not match its media type")
                if image.width * image.height > MAX_AVATAR_PIXELS:
                    raise ValueError("Image dimensions exceed the avatar limit")
                image.verify()
            with Image.open(io.BytesIO(content)) as image:
                image.load()
                normalized = ImageOps.exif_transpose(image).convert("RGBA")
                normalized.thumbnail((512, 512), Image.Resampling.LANCZOS)
                output = io.BytesIO()
                normalized.save(output, format="WEBP", quality=85, method=4)
                return output.getvalue()
    except (
        UnidentifiedImageError,
        OSError,
        ValueError,
        Image.DecompressionBombError,
        Image.DecompressionBombWarning,
    ) as exc:
        raise HTTPException(400, "File is not a valid supported image within the size limits") from exc


def sanitize_avatar_url(url):
    if not isinstance(url, str):
        return None
    try:
        parsed = urlparse(url.strip())
        host = parsed.hostname or ""
    except ValueError:
        return None
    if (
        parsed.scheme != "https"
        or not host
        or host in {"localhost", "127.0.0.1", "::1"}
        or host.endswith(".local")
    ):
        return None
    return url.strip()


async def get_avatar(user_id: str, db: AsyncConnection):
    from app.features.accounts.service import get_account

    avatar = sanitize_avatar_url((await get_account(db, user_id)).get("profileImageUrl"))
    if not avatar:
        raise HTTPException(404, "Avatar not found")
    return {"avatarUrl": avatar}


async def update_avatar(user_id: str, body: dict, user: dict, db: AsyncConnection):
    ensure_owner(user, user_id, allow_admin=False)
    avatar = sanitize_avatar_url(body.get("avatarUrl") or body.get("url"))
    if not avatar:
        raise HTTPException(400, "Invalid avatar URL")
    await db.execute(
        update(tables["User"])
        .where(tables["User"].c.id == user_id)
        .values(profileImageUrl=avatar, updatedAt=utcnow())
    )
    return {"avatarUrl": avatar}


async def upload_avatar(user_id: str, uploaded_file, user: dict, db: AsyncConnection):
    ensure_owner(user, user_id, allow_admin=False)
    if uploaded_file is None or not hasattr(uploaded_file, "read"):
        raise HTTPException(400, "No file uploaded")
    if uploaded_file.content_type not in AVATAR_FORMATS:
        raise HTTPException(400, "File must be an image")
    content = await uploaded_file.read(MAX_AVATAR_BYTES + 1)
    prepared = await run_in_threadpool(prepare_avatar, content, uploaded_file.content_type)
    bucket = get_settings().supabase_avatar_bucket
    object_path = f"avatars/{user_id}/{secrets.token_hex(24)}.webp"
    avatar = object_storage.public_object_url(bucket, object_path)
    await object_storage.upload_object(
        bucket, object_path, prepared, "image/webp", max_bytes=MAX_AVATAR_BYTES
    )
    try:
        await db.execute(
            update(tables["User"])
            .where(tables["User"].c.id == user_id)
            .values(profileImageUrl=avatar, updatedAt=utcnow())
        )
    except BaseException:
        try:
            await object_storage.delete_object(bucket, object_path)
        except Exception:
            logger.warning("Could not remove avatar after an account persistence failure")
        raise
    return {"avatarUrl": avatar}
