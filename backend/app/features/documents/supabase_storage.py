"""Private medical-document bucket adapter; object keys never become public URLs."""

import re

from fastapi import HTTPException

from app.core.config import get_settings
from app.infrastructure import object_storage
from .storage import MAX_FILE_BYTES

KEY_PREFIX = "supabase/"
ASSET_FOLDER = "quickclinic/medical-documents/"


def asset_id(key: str) -> str:
    if (
        not isinstance(key, str)
        or not key.startswith(KEY_PREFIX + ASSET_FOLDER)
        or len(key) > 500
        or not re.fullmatch(r"[A-Za-z0-9_/-]+", key)
        or any(part in ("", ".", "..") for part in key.split("/"))
    ):
        raise HTTPException(404, "Document file not found")
    return key.removeprefix(KEY_PREFIX)


async def upload_document(data: bytes, identifier: str, file_name: str, mime_type: str) -> str:
    key = KEY_PREFIX + identifier
    asset_id(key)
    await object_storage.upload_object(
        get_settings().supabase_document_bucket, identifier, data, mime_type, max_bytes=MAX_FILE_BYTES
    )
    return key


async def download_document(key: str) -> bytes:
    return await object_storage.download_object(
        get_settings().supabase_document_bucket, asset_id(key), max_bytes=MAX_FILE_BYTES
    )


async def delete_document(key: str) -> None:
    await object_storage.delete_object(get_settings().supabase_document_bucket, asset_id(key))
