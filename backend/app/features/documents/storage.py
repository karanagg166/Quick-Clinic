"""Private file storage and binary validation; never publishes the storage directory."""

import io
import re
import warnings
from pathlib import Path
from fastapi import HTTPException
from PIL import Image
from pypdf import PdfReader
from app.core.config import get_settings

MAX_FILE_BYTES = 10 * 1024 * 1024
MAX_ACCOUNT_BYTES = 100 * 1024 * 1024
MAX_ACCOUNT_DOCUMENTS = 100


def validate_file(data: bytes, reported_type: str) -> str:
    if not data or len(data) > MAX_FILE_BYTES:
        raise HTTPException(400, "File must be between 1 byte and 10 MB")
    mime = None
    if data.startswith(b"%PDF-"):
        mime = "application/pdf"
        try:
            reader = PdfReader(io.BytesIO(data), strict=True)
            if reader.is_encrypted or not 1 <= len(reader.pages) <= 200:
                raise ValueError("Invalid PDF")
            # Medical uploads have no need for executable PDF actions or attachments.
            root = reader.trailer["/Root"]
            if any(key in root for key in ("/OpenAction", "/AA")):
                raise ValueError("Active PDF")
            names = root.get("/Names", {})
            if hasattr(names, "get_object"):
                names = names.get_object()
            if any(key in names for key in ("/JavaScript", "/EmbeddedFiles")):
                raise ValueError("Active PDF")
            for page in reader.pages:
                if "/AA" in page:
                    raise ValueError("Active PDF")
                for annotation in page.get("/Annots", []):
                    item = annotation.get_object()
                    if "/A" in item or "/AA" in item:
                        raise ValueError("Active PDF")
        except Exception as exc:
            raise HTTPException(400, "Invalid, encrypted, or active PDF document") from exc
    else:
        try:
            with warnings.catch_warnings():
                warnings.simplefilter("error", Image.DecompressionBombWarning)
                with Image.open(io.BytesIO(data)) as image:
                    mime = {"JPEG": "image/jpeg", "PNG": "image/png", "WEBP": "image/webp"}.get(image.format)
                    image.verify()
        except Exception as exc:
            raise HTTPException(400, "Invalid image document") from exc
    if not mime or reported_type.lower().replace("image/jpg", "image/jpeg") != mime:
        raise HTTPException(400, "Unsupported file type or file signature mismatch")
    return mime


def safe_filename(value: str) -> str:
    value = value.replace("\\", "/").split("/")[-1]
    return re.sub(r"[^A-Za-z0-9_.-]", "_", value)[:120] or "document"


def storage_path(key: str) -> Path:
    root = get_settings().document_storage_dir.resolve()
    if not key.startswith("local/"):
        raise HTTPException(
            409,
            {
                "code": "LEGACY_DOCUMENT_REQUIRES_IMPORT",
                "error": "This document must be imported into the new storage before it can be opened",
            },
        )
    path = (root / key.removeprefix("local/")).resolve()
    if not path.is_relative_to(root) or path == root:
        raise HTTPException(404, "Document file not found")
    return path


def document_metadata(row) -> dict:
    return {key: value for key, value in dict(row).items() if key != "storagePath"}
