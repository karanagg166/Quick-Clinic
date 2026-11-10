"""A small storage boundary supporting local development and private cloud assets."""

from urllib.parse import quote
from fastapi import HTTPException
from fastapi.responses import FileResponse, Response
from app.core.config import get_settings
from . import cloudinary_storage
from .storage import MAX_FILE_BYTES, storage_path


def upload_key(patient_id: str, document_id: str, fingerprint: str) -> str:
    suffix = f"{patient_id}/{document_id}/{fingerprint}"
    if get_settings().document_storage_backend == "cloudinary":
        return f"cloudinary/quickclinic/medical-documents/{suffix}"
    return f"local/{suffix}"


def check_managed_file(key: str):
    if key.startswith("cloudinary/"):
        cloudinary_storage.asset_id(key)
        return
    path = storage_path(key)
    if not path.is_file():
        raise HTTPException(404, "Document file not found")


async def write_file(key: str, data: bytes, filename: str, mime_type: str):
    if key.startswith("cloudinary/"):
        return await cloudinary_storage.upload_document(
            data, key.removeprefix("cloudinary/"), filename, mime_type
        )
    path = storage_path(key)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    with path.open("xb") as target:
        target.write(data)
    path.chmod(0o600)
    return key


async def remove_file(key: str):
    if key.startswith("cloudinary/"):
        await cloudinary_storage.delete_document(key)
    else:
        storage_path(key).unlink(missing_ok=True)


async def file_response(document, action: str):
    key = document["storagePath"]
    check_managed_file(key)
    disposition = "attachment" if action == "download" else "inline"
    headers = {
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "sandbox",
    }
    if key.startswith("cloudinary/"):
        data = await cloudinary_storage.download_document(key)
        if not data or len(data) != document["fileSize"] or len(data) > MAX_FILE_BYTES:
            raise HTTPException(502, "Stored document size does not match its metadata")
        headers["Content-Disposition"] = f"{disposition}; filename*=UTF-8''{quote(document['fileName'])}"
        return Response(content=data, media_type=document["mimeType"], headers=headers)
    return FileResponse(
        storage_path(key),
        media_type=document["mimeType"],
        filename=document["fileName"],
        content_disposition_type=disposition,
        headers=headers,
    )
