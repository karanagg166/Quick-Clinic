"""Adversarial synthetic documents and private storage boundary contracts."""

import io
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException
from PIL import Image
from pydantic import ValidationError
from pypdf import PdfWriter
from pypdf.generic import ArrayObject, DictionaryObject, NameObject, TextStringObject

from app.core.config import get_settings
from app.features.documents import files, storage
from app.features.documents.schemas import DocumentRename, DocumentUpload


def make_pdf(kind="plain"):
    writer = PdfWriter()
    if kind != "empty":
        writer.add_blank_page(width=72, height=72)
    action = DictionaryObject(
        {
            NameObject("/S"): NameObject("/JavaScript"),
            NameObject("/JS"): TextStringObject("synthetic test action"),
        }
    )
    if kind == "encrypted":
        writer.encrypt("synthetic-only-password")
    elif kind in ("OpenAction", "AA"):
        writer._root_object[NameObject("/" + kind)] = action
    elif kind in ("JavaScript", "EmbeddedFiles"):
        writer._root_object[NameObject("/Names")] = DictionaryObject(
            {NameObject("/" + kind): DictionaryObject()}
        )
    elif kind == "page_action":
        writer.pages[0][NameObject("/AA")] = action
    elif kind == "annotation_action":
        writer.pages[0][NameObject("/Annots")] = ArrayObject([DictionaryObject({NameObject("/A"): action})])
    stream = io.BytesIO()
    writer.write(stream)
    return stream.getvalue()


@pytest.mark.parametrize(
    "kind",
    [
        "empty",
        "encrypted",
        "OpenAction",
        "AA",
        "JavaScript",
        "EmbeddedFiles",
        "page_action",
        "annotation_action",
    ],
)
def test_pdf_rejects_active_encrypted_or_pageless_content(kind):
    with pytest.raises(HTTPException) as error:
        storage.validate_file(make_pdf(kind), "application/pdf")
    assert error.value.status_code == 400


def test_pdf_rejects_more_than_two_hundred_pages():
    writer = PdfWriter()
    for _ in range(201):
        writer.add_blank_page(width=1, height=1)
    stream = io.BytesIO()
    writer.write(stream)
    with pytest.raises(HTTPException):
        storage.validate_file(stream.getvalue(), "application/pdf")


@pytest.mark.parametrize("format,mime", [("JPEG", "image/jpg"), ("PNG", "image/png"), ("WEBP", "image/webp")])
def test_supported_image_formats_are_verified(format, mime):
    stream = io.BytesIO()
    Image.new("RGB", (2, 2)).save(stream, format=format)
    assert storage.validate_file(stream.getvalue(), mime) == mime.replace("image/jpg", "image/jpeg")


def test_valid_but_unsupported_image_format_is_rejected():
    stream = io.BytesIO()
    Image.new("RGB", (2, 2)).save(stream, format="GIF")
    with pytest.raises(HTTPException):
        storage.validate_file(stream.getvalue(), "image/gif")


def test_image_decompression_bomb_is_rejected(monkeypatch):
    stream = io.BytesIO()
    Image.new("RGB", (4, 4)).save(stream, format="PNG")
    monkeypatch.setattr(Image, "MAX_IMAGE_PIXELS", 10)
    with pytest.raises(HTTPException):
        storage.validate_file(stream.getvalue(), "image/png")


@pytest.mark.parametrize("data", [b"", b"x" * (storage.MAX_FILE_BYTES + 1)])
def test_file_size_boundaries_fail_before_parsing(data):
    with pytest.raises(HTTPException):
        storage.validate_file(data, "application/pdf")


@pytest.mark.parametrize(
    "name,expected",
    [
        ("..\\private\\scan.pdf", "scan.pdf"),
        ("../../scan.pdf", "scan.pdf"),
        ("", "document"),
        ("a\nreport?.pdf", "a_report_.pdf"),
        ("x" * 150, "x" * 120),
    ],
)
def test_filename_strips_paths_controls_and_overlong_names(name, expected):
    assert storage.safe_filename(name) == expected


@pytest.mark.parametrize("key", ["local/../outside", "local/", "local/../../credentials"])
def test_storage_paths_cannot_escape_private_root(db, key):
    with pytest.raises(HTTPException) as error:
        storage.storage_path(key)
    assert error.value.status_code == 404


def test_storage_symlinks_cannot_escape_private_root(db, tmp_path):
    root = get_settings().document_storage_dir
    root.mkdir()
    (root / "escape").symlink_to(tmp_path)
    with pytest.raises(HTTPException):
        storage.storage_path("local/escape/outside")


def test_metadata_hides_storage_and_normalizes_report_timezone():
    metadata = DocumentUpload(title="  Synthetic report  ", type="OTHER", reportDate="2030-01-01T09:00+05:30")
    assert metadata.title == "Synthetic report"
    assert metadata.reportDate.isoformat() == "2030-01-01T03:30:00"
    assert storage.document_metadata({"id": "doc", "storagePath": "private", "fileName": "a.pdf"}) == {
        "id": "doc",
        "fileName": "a.pdf",
    }


@pytest.mark.parametrize(
    "payload", [{"title": " "}, {"title": "x" * 201}, {"title": "Valid", "storagePath": "evil"}]
)
def test_rename_accepts_only_a_nonempty_bounded_title(payload):
    with pytest.raises(ValidationError):
        DocumentRename(**payload)


@pytest.mark.parametrize("data", [b"", b"short", b"x" * (storage.MAX_FILE_BYTES + 1)])
async def test_private_cloud_download_rejects_missing_truncated_and_oversize_bytes(monkeypatch, data):
    monkeypatch.setattr(files, "check_managed_file", lambda key: None)
    monkeypatch.setattr(files.supabase_storage, "download_document", AsyncMock(return_value=data))
    document = dict(
        storagePath="supabase/quickclinic/medical-documents/test",
        fileSize=6,
        fileName="report.pdf",
        mimeType="application/pdf",
    )
    with pytest.raises(HTTPException) as error:
        await files.file_response(document, "download")
    assert error.value.status_code == 502


async def test_local_storage_is_exclusive_and_file_permissions_are_private(db):
    key = "local/patient/document/file"
    await files.write_file(key, b"synthetic", "report.pdf", "application/pdf")
    path = storage.storage_path(key)
    assert path.read_bytes() == b"synthetic"
    assert path.stat().st_mode & 0o777 == 0o600
    with pytest.raises(FileExistsError):
        await files.write_file(key, b"overwrite", "report.pdf", "application/pdf")
    assert path.read_bytes() == b"synthetic"
