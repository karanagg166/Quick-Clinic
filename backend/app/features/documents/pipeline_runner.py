"""Search Sphere ingestion runner for Quick-Clinic medical documents."""

import logging
import shutil
from datetime import timedelta
from typing import Any

from search_sphere_ingest import DocumentPipeline, PipelineConfig
from search_sphere_ingest.errors import CapabilityUnavailable
from search_sphere_ingest.models import NormalizedDocument
from search_sphere_ingest.tables import merge_continuations
from search_sphere_ingest.tesseract import TesseractOCRProvider
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncConnection
from starlette.concurrency import run_in_threadpool

from app.infrastructure.database import tables, utcnow

from .embeddings import index_version_chunks
from .ingestion_persistence import create_ingestion_job, persist_normalized_document
from .publishing import publish_document_version
from .storage import MAX_FILE_BYTES

logger = logging.getLogger(__name__)


class _OfflineSafeTokenizer:
    name = "quick-clinic:cl100k_or_approx"
    _encoding: Any = None
    _checked = False

    def count(self, text: str) -> int:
        if not self._checked:
            self.__class__._checked = True
            try:
                import tiktoken

                self.__class__._encoding = tiktoken.get_encoding("cl100k_base")
            except Exception:
                self.__class__._encoding = None
        if self._encoding is not None:
            return len(self._encoding.encode(text, disallowed_special=()))
        return max(1, (len(text) + 3) // 4)


def _build_ocr_provider() -> TesseractOCRProvider | None:
    if not shutil.which("tesseract"):
        return None
    try:
        return TesseractOCRProvider()
    except CapabilityUnavailable:
        return None


def _build_pipeline() -> DocumentPipeline:
    config = PipelineConfig(
        max_file_bytes=MAX_FILE_BYTES,
        max_pages=35,
        target_tokens=320,
        max_tokens=480,
        overlap_sentences=1,
        use_opencv=False,
    )
    return DocumentPipeline(
        config=config,
        tokenizer=_OfflineSafeTokenizer(),
        ocr=_build_ocr_provider(),
    )


def _remap_batch_offset(batch_norm: NormalizedDocument, offset: int) -> NormalizedDocument:
    if offset == 0:
        return batch_norm
    for p in batch_norm.pages:
        p.page_number += offset
    for s in batch_norm.sections:
        if s.source and hasattr(s.source, "page_number"):
            s.source.page_number += offset
    for o in batch_norm.objects:
        if hasattr(o, "sources") and o.sources:
            for src in o.sources:
                if hasattr(src, "page_number"):
                    src.page_number += offset
        if hasattr(o, "row_pages") and o.row_pages:
            o.row_pages = [rp + offset for rp in o.row_pages]
        if hasattr(o, "cells") and o.cells:
            for cell in o.cells:
                if getattr(cell, "source", None) and hasattr(cell.source, "page_number"):
                    cell.source.page_number += offset
    for issue in batch_norm.issues:
        if hasattr(issue, "page_number") and issue.page_number is not None:
            issue.page_number += offset
    return batch_norm


def _slice_pdf(doc: Any, start: int, end: int) -> bytes:
    import pymupdf

    sub = pymupdf.open()
    sub.insert_pdf(doc, from_page=start, to_page=end - 1)
    return sub.tobytes()


def _extract_and_chunk_bounded(data: bytes) -> tuple[Any, list[Any]]:
    pipeline = _build_pipeline()
    if not data.startswith(b"%PDF-"):
        norm = pipeline.extract(data)
        return norm, pipeline.chunk(norm)

    import pymupdf

    doc = pymupdf.open("pdf", data)
    page_count = len(doc)
    if page_count > 200:
        raise ValueError(f"PDF exceeds 200 pages limit (got {page_count})")
    if page_count <= 30:
        norm = pipeline.extract(data)
        return norm, pipeline.chunk(norm)

    batch_size = 25
    all_pages: list[Any] = []
    all_sections: list[Any] = []
    all_objects: list[Any] = []
    all_issues: list[Any] = []
    base_norm: Any = None

    for start in range(0, page_count, batch_size):
        end = min(start + batch_size, page_count)
        sub_bytes = _slice_pdf(doc, start, end)
        batch_norm = pipeline.extract(sub_bytes)
        if base_norm is None:
            base_norm = batch_norm
        batch_norm = _remap_batch_offset(batch_norm, start)
        all_pages.extend(batch_norm.pages)
        all_sections.extend(batch_norm.sections)
        all_objects.extend(batch_norm.objects)
        all_issues.extend(batch_norm.issues)

    all_objects = merge_continuations(all_objects, all_pages, 0.7)
    combined = base_norm.model_copy(
        update={
            "pages": all_pages,
            "sections": all_sections,
            "objects": all_objects,
            "issues": all_issues,
        }
    )
    return combined, pipeline.chunk(combined)


async def run_document_ingestion(
    db: AsyncConnection,
    *,
    document_id: str,
    data: bytes,
    job_id: str | None = None,
    lease_token: str | None = None,
) -> dict[str, Any]:
    """Run durable Search Sphere extraction, chunking, and pgvector indexing."""
    jobs = tables["MedicalIngestionJob"]
    docs = tables["MedicalDocument"]

    if job_id is None:
        job = await create_ingestion_job(db, document_id=document_id)
        job_id = str(job["id"])

    def _job_filter():
        base = jobs.c.id == job_id
        return (base & (jobs.c.leaseToken == lease_token)) if lease_token else base

    try:
        now = utcnow()
        await db.execute(update(jobs).where(_job_filter()).values(stage="extracting", updatedAt=now))

        normalized, chunks = await run_in_threadpool(_extract_and_chunk_bounded, data)
        version = await persist_normalized_document(
            db, document_id=document_id, normalized=normalized, chunks=chunks
        )

        now = utcnow()
        await db.execute(
            update(jobs)
            .where(_job_filter())
            .values(versionId=version["id"], stage="embedding", updatedAt=now)
        )

        index_result = await index_version_chunks(db, version_id=version["id"])
        now = utcnow()

        if index_result["status"] == "COMPLETED":
            await publish_document_version(db, document_id=document_id, version_id=version["id"])
            await db.execute(
                update(jobs)
                .where(_job_filter())
                .values(
                    versionId=version["id"],
                    status="COMPLETED",
                    stage="published",
                    completedAt=now,
                    updatedAt=now,
                    progress={
                        "pages": version["pageCount"],
                        "chunks": version["chunkCount"],
                        "extractionStatus": version["extractionStatus"],
                        "issues": version["issueCount"],
                    },
                )
            )
            return {
                "jobId": job_id,
                "versionId": version["id"],
                "status": "COMPLETED",
                "extractionStatus": version["extractionStatus"],
                "indexStatus": "COMPLETED",
                "chunkCount": version["chunkCount"],
                "issueCount": version["issueCount"],
            }

        await db.execute(
            update(jobs)
            .where(_job_filter())
            .values(
                versionId=version["id"],
                status="RETRYABLE",
                stage="embedding_retry_scheduled",
                retryable=True,
                availableAt=now + timedelta(seconds=30),
                updatedAt=now,
                progress={"pages": version["pageCount"], "chunks": version["chunkCount"]},
            )
        )
        return {
            "jobId": job_id,
            "versionId": version["id"],
            "status": "RETRYABLE",
            "indexStatus": "RETRYABLE",
            "chunkCount": version["chunkCount"],
        }
    except ValueError as exc:
        logger.warning("Deterministic ingestion rejection for %s: %s", document_id, exc)
        now = utcnow()
        await db.execute(
            update(jobs)
            .where(_job_filter())
            .values(
                status="FAILED",
                stage="failed",
                errorCode=type(exc).__name__,
                retryable=False,
                leaseToken=None,
                leaseExpiresAt=None,
                completedAt=now,
                updatedAt=now,
            )
        )
        await db.execute(
            update(docs)
            .where(docs.c.id == document_id)
            .values(
                processingStatus="FAILED",
                processingError="Document extraction failed; please verify the file and re-upload.",
                updatedAt=now,
            )
        )
        return {"jobId": job_id, "status": "FAILED", "errorCode": type(exc).__name__}
    except Exception as exc:
        if lease_token is not None:
            raise
        logger.exception("Medical document ingestion failed for %s", document_id)
        now = utcnow()
        await db.execute(
            update(jobs)
            .where(_job_filter())
            .values(
                status="FAILED",
                stage="failed",
                errorCode=type(exc).__name__,
                retryable=True,
                leaseToken=None,
                leaseExpiresAt=None,
                completedAt=now,
                updatedAt=now,
            )
        )
        await db.execute(
            update(docs)
            .where(docs.c.id == document_id)
            .values(
                processingStatus="FAILED",
                processingError="Document extraction failed; please retry.",
                updatedAt=now,
            )
        )
        return {"jobId": job_id, "status": "FAILED", "errorCode": type(exc).__name__}
