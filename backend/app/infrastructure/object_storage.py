"""Bounded Supabase Storage HTTP operations using backend-only credentials.

Medical objects remain in a private bucket and are served by authorized clinic
routes. Public URLs are used only for the separate avatar bucket.
"""

import re
from urllib.parse import quote, urlsplit

import httpx
from fastapi import HTTPException

from app.core.config import get_settings

DEFAULT_MAX_BYTES = 10 * 1024 * 1024
MAX_RESPONSE_BYTES = 64 * 1024


def configuration():
    settings = get_settings()
    raw = settings.supabase_url
    secret = settings.supabase_secret_key
    try:
        target = urlsplit(raw)
        valid = (
            target.scheme == "https"
            and target.hostname is not None
            and re.fullmatch(r"[a-z0-9-]+\.supabase\.co", target.hostname)
            and target.port is None
            and not target.username
            and not target.password
            and target.path in ("", "/")
            and not target.query
            and not target.fragment
        )
    except (ValueError, TypeError):
        valid = False
    if not valid or not secret or not secret.startswith("sb_secret_") or any(c.isspace() for c in secret):
        raise HTTPException(503, "Object storage is not configured")
    return raw.rstrip("/"), {"apikey": secret}


def object_path(bucket: str, path: str) -> str:
    if (
        not isinstance(bucket, str)
        or not re.fullmatch(r"[A-Za-z0-9_-]{1,100}", bucket)
        or not isinstance(path, str)
        or not 1 <= len(path) <= 500
        or not re.fullmatch(r"[A-Za-z0-9_./-]+", path)
        or any(part in ("", ".", "..") for part in path.split("/"))
    ):
        raise HTTPException(404, "Stored object not found")
    return quote(bucket, safe="") + "/" + quote(path, safe="/")


async def _request(method, suffix, *, max_bytes=MAX_RESPONSE_BYTES, missing_ok=False, **kwargs):
    base, credentials = configuration()
    headers = {**credentials, **kwargs.pop("headers", {})}
    try:
        async with httpx.AsyncClient(timeout=30, follow_redirects=False) as client:
            async with client.stream(
                method, base + "/storage/v1/" + suffix, headers=headers, **kwargs
            ) as response:
                if response.status_code == 404:
                    if missing_ok:
                        return b""
                    raise HTTPException(404, "Stored object not found")
                if not 200 <= response.status_code < 300:
                    raise HTTPException(502, "Object storage operation failed")
                length = response.headers.get("content-length")
                if length is not None:
                    try:
                        if int(length) < 0 or int(length) > max_bytes:
                            raise HTTPException(502, "Stored object exceeds the permitted size")
                    except ValueError as exc:
                        raise HTTPException(502, "Object storage returned an invalid response") from exc
                total, chunks = 0, []
                async for chunk in response.aiter_bytes():
                    total += len(chunk)
                    if total > max_bytes:
                        raise HTTPException(502, "Stored object exceeds the permitted size")
                    chunks.append(chunk)
                return b"".join(chunks)
    except httpx.HTTPError as exc:
        # Exception URLs and provider bodies may contain credentials or metadata.
        raise HTTPException(502, "Object storage operation failed") from exc


async def upload_object(bucket, path, data, content_type, *, max_bytes=DEFAULT_MAX_BYTES):
    target = object_path(bucket, path)
    if not isinstance(data, bytes) or not data or len(data) > max_bytes:
        raise HTTPException(400, "Stored object exceeds the permitted upload size")
    if not isinstance(content_type, str) or not re.fullmatch(r"[a-z0-9.+-]+/[a-z0-9.+-]+", content_type):
        raise HTTPException(400, "Invalid stored object content type")
    await _request(
        "POST",
        "object/" + target,
        content=data,
        headers={"Content-Type": content_type, "x-upsert": "false", "Cache-Control": "private, no-store"},
    )


async def download_object(bucket, path, *, max_bytes=DEFAULT_MAX_BYTES):
    return await _request("GET", "object/authenticated/" + object_path(bucket, path), max_bytes=max_bytes)


async def delete_object(bucket, path):
    object_path(bucket, path)
    await _request("DELETE", "object/" + quote(bucket, safe=""), json={"prefixes": [path]}, missing_ok=True)


def public_object_url(bucket, path):
    target = object_path(bucket, path)
    settings = get_settings()
    if bucket != settings.supabase_avatar_bucket or bucket == settings.supabase_document_bucket:
        raise HTTPException(403, "Public URLs are allowed only for avatars")
    base, _ = configuration()
    return base + "/storage/v1/object/public/" + target
