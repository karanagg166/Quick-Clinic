"""Search Sphere ingestion runner for Quick-Clinic medical documents."""

import logging
from typing import Any

from search_sphere_ingest import DocumentPipeline, PipelineConfig
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncConnection
from starlette.concurrency import run_in_threadpool

from app.infrastructure.database import tables, utcnow

from .embeddings import index_version_chunks
from .ingestion_persistence import create_ingestion_job, persist_normalized_document
from .storage import MAX_FILE_BYTES

logger = logging.getLogger(__name__)


def _build_pipeline() -> DocumentPipeline:
    """Configure bounded extraction suitable for Render free-tier memory."""

    config = PipelineConfig(
        max_file_bytes=MAX_FILE_BYTES,
        max_pages=40,
        target_tokens=320,
        max_tokens=480,
        overlap_sentences=1,
        use_opencv=False,
    )
    return DocumentPipeline(config=config)


def _extract_and_chunk(data: bytes) -> tuple[Any, list[Any]]:
    pipeline = _build_pipeline()
    normalized = pipeline.extract(data)
    chunks = pipeline.chunk(normalized)
    return normalized, chunks


async def run_document_ingestion(
    db: AsyncConnection,
    *,
    document_id: str,
    data: bytes,
) -> dict[str, Any]:
    """Run durable Search Sphere extraction, chunking, and pgvector indexing."""

    jobs = tables["MedicalIngestionJob"]
    docs = tables["MedicalDocument"]
    job = await create_ingestion_job(db, document_id=document_id)

    try:
        normalized, chunks = await run_in_threadpool(_extract_and_chunk, data)
        version = await persist_normalized_document(
            db,
            document_id=document_id,
            normalized=normalized,
            chunks=chunks,
        )
        index_result = await index_version_chunks(db, version_id=version["id"])
        now = utcnow()
        await db.execute(
            update(jobs)
            .where(jobs.c.id == job["id"])
            .values(
                versionId=version["id"],
                status="COMPLETED",
                stage="indexed" if index_result["status"] == "COMPLETED" else "extracted",
                completedAt=now,
                updatedAt=now,
                progress={"pages": version["pageCount"], "chunks": version["chunkCount"]},
            )
        )
        return {
            "jobId": job["id"],
            "versionId": version["id"],
            "status": version["extractionStatus"],
            "indexStatus": index_result["status"],
            "chunkCount": version["chunkCount"],
        }
    except Exception as exc:
        logger.exception("Medical document ingestion failed for %s", document_id)
        now = utcnow()
        await db.execute(
            update(jobs)
            .where(jobs.c.id == job["id"])
            .values(
                status="FAILED",
                stage="failed",
                errorCode=type(exc).__name__,
                retryable=True,
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
        return {"jobId": job["id"], "status": "FAILED", "errorCode": type(exc).__name__}
