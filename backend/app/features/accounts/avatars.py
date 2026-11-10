"""Avatar validation and signed uploads to the image storage provider."""

import hashlib
import time
from urllib.parse import urlparse
import httpx
from fastapi import HTTPException
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncConnection
from app.core.config import get_settings
from app.core.security import ensure_owner
from app.infrastructure.database import tables, utcnow


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
    if uploaded_file.content_type not in {"image/jpeg", "image/png", "image/webp", "image/gif"}:
        raise HTTPException(400, "File must be an image")
    content = await uploaded_file.read(5 * 1024 * 1024 + 1)
    if not content or len(content) > 5 * 1024 * 1024:
        raise HTTPException(400, "File size must be less than 5MB")
    settings = get_settings()
    cloud, key, secret = (
        settings.cloudinary_cloud_name,
        settings.cloudinary_api_key,
        settings.cloudinary_api_secret,
    )
    if not all((cloud, key, secret)):
        raise HTTPException(503, "Image storage is not configured")
    params = {
        "folder": "quickclinic/avatars",
        "public_id": f"user_{user_id}_{int(time.time())}",
        "timestamp": str(int(time.time())),
        "transformation": "c_fill,g_face,h_400,w_400/q_auto/f_auto",
    }
    signing = "&".join((f"{name}={value}" for name, value in sorted(params.items()))) + secret
    signature = hashlib.sha1(signing.encode()).hexdigest()
    async with httpx.AsyncClient(timeout=30) as client:
        uploaded = await client.post(
            f"https://api.cloudinary.com/v1_1/{cloud}/image/upload",
            data={**params, "api_key": key, "signature": signature},
            files={"file": (uploaded_file.filename, content, uploaded_file.content_type)},
        )
    if uploaded.is_error:
        raise HTTPException(502, "Avatar upload failed")
    avatar = sanitize_avatar_url(uploaded.json().get("secure_url"))
    if not avatar:
        raise HTTPException(502, "Image storage returned an invalid URL")
    await db.execute(
        update(tables["User"])
        .where(tables["User"].c.id == user_id)
        .values(profileImageUrl=avatar, updatedAt=utcnow())
    )
    return {"avatarUrl": avatar}
