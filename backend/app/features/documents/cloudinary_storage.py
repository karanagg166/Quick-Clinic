"""Authenticated external storage for documents on ephemeral free hosting."""

import re
import time
from urllib.parse import urlsplit
import cloudinary.uploader
import cloudinary.utils
import httpx
from fastapi import HTTPException
from starlette.concurrency import run_in_threadpool
from app.core.config import get_settings
from .storage import MAX_FILE_BYTES

KEY_PREFIX = "cloudinary/"
ASSET_FOLDER = "quickclinic/medical-documents/"


def credentials() -> dict:
    settings = get_settings()
    values = dict(
        cloud_name=settings.cloudinary_cloud_name,
        api_key=settings.cloudinary_api_key,
        api_secret=settings.cloudinary_api_secret,
        secure=True,
    )
    if not all(values.values()):
        raise HTTPException(503, "Private document storage is not configured")
    return values


def asset_id(key: str) -> str:
    identifier = key.removeprefix(KEY_PREFIX)
    if (
        not key.startswith(KEY_PREFIX + ASSET_FOLDER)
        or len(identifier) > 500
        or not re.fullmatch(r"[A-Za-z0-9_/-]+", identifier)
        or any(part in ("", ".", "..") for part in identifier.split("/"))
    ):
        raise HTTPException(404, "Document file not found")
    return identifier


async def upload_document(data: bytes, public_id: str, file_name: str, mime_type: str) -> str:
    key = KEY_PREFIX + public_id
    asset_id(key)
    options = credentials()
    try:
        result = await run_in_threadpool(
            cloudinary.uploader.upload,
            data,
            public_id=public_id,
            resource_type="raw",
            type="authenticated",
            overwrite=False,
            timeout=30,
            unique_filename=False,
            filename_override=file_name,
            **options,
        )
    except Exception as exc:
        raise HTTPException(502, "Private document upload failed") from exc
    if (
        result.get("public_id") != public_id
        or result.get("resource_type") != "raw"
        or result.get("type") != "authenticated"
    ):
        raise HTTPException(502, "Private document storage returned an invalid result")
    return key


async def download_document(key: str) -> bytes:
    identifier = asset_id(key)
    options = credentials()
    url = cloudinary.utils.private_download_url(
        identifier, "", resource_type="raw", type="authenticated", expires_at=int(time.time()) + 60, **options
    )
    target = urlsplit(url)
    if target.scheme != "https" or target.hostname != "api.cloudinary.com":
        raise HTTPException(502, "Private document storage returned an invalid download location")
    try:
        async with httpx.AsyncClient(timeout=30, follow_redirects=False) as client:
            async with client.stream("GET", url) as response:
                if response.status_code == 404:
                    raise HTTPException(404, "Document file not found")
                response.raise_for_status()
                chunks = []
                total = 0
                async for chunk in response.aiter_bytes():
                    total += len(chunk)
                    if total > MAX_FILE_BYTES:
                        raise HTTPException(502, "Stored document exceeds the permitted file size")
                    chunks.append(chunk)
                return b"".join(chunks)
    except httpx.HTTPError as exc:
        # Signed URLs contain credentials; do not log exception strings or URLs.
        raise HTTPException(502, "Private document download failed") from exc


async def delete_document(key: str) -> None:
    identifier = asset_id(key)
    options = credentials()
    try:
        result = await run_in_threadpool(
            cloudinary.uploader.destroy,
            identifier,
            resource_type="raw",
            type="authenticated",
            invalidate=True,
            timeout=30,
            **options,
        )
    except Exception as exc:
        raise HTTPException(502, "Private document deletion failed") from exc
    if result.get("result") not in ("ok", "not found"):
        raise HTTPException(502, "Private document deletion failed")
