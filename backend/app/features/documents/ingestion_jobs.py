"""Durable ingestion job queue, lease claiming, and bounded startup recovery."""

import asyncio
import logging
from datetime import timedelta
from typing import Any

from sqlalchemy import func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncConnection

from app.infrastructure import database as db_mod
from app.infrastructure.database import new_id, tables, utcnow

from .files import read_file_bytes
from .pipeline_runner import run_document_ingestion

logger = logging.getLogger(__name__)
MAX_INGESTION_ATTEMPTS = 3
LEASE_SECONDS = 120


async def enqueue_ingestion_job(
    db: AsyncConnection,
    *,
    document_id: str,
) -> dict[str, Any]:
    """Persist a QUEUED ingestion job in the same transaction as upload."""

    jobs = tables["MedicalIngestionJob"]
    max_gen = (
        await db.execute(
            select(func.coalesce(func.max(jobs.c.generation), 0)).where(
                jobs.c.documentId == document_id
            )
        )
    ).scalar_one()
    now = utcnow()
    row = (
        await db.execute(
            jobs.insert()
            .values(
                id=new_id(),
                documentId=document_id,
                generation=int(max_gen) + 1,
                status="QUEUED",
                stage="registered",
                attempts=0,
                availableAt=now,
                createdAt=now,
                updatedAt=now,
            )
            .returning(jobs)
        )
    ).mappings().first()
    return dict(row)


async def claim_next_ingestion_job(
    db: AsyncConnection,
    *,
    document_id: str | None = None,
) -> dict[str, Any] | None:
    """Claim a QUEUED, RETRYABLE, or expired-lease RUNNING job."""

    jobs = tables["MedicalIngestionJob"]
    now = utcnow()
    stmt = (
        select(jobs)
        .where(
            or_(
                jobs.c.status.in_(["QUEUED", "RETRYABLE"]),
                (jobs.c.status == "RUNNING") & (jobs.c.leaseExpiresAt < now),
            ),
            jobs.c.availableAt <= now,
            jobs.c.attempts < MAX_INGESTION_ATTEMPTS,
        )
        .order_by(jobs.c.availableAt.asc())
        .limit(1)
    )
    if document_id is not None:
        stmt = stmt.where(jobs.c.documentId == document_id)

    job = (await db.execute(stmt)).mappings().first()
    if job is None:
        return None

    lease_token = new_id()
    lease_expires = now + timedelta(seconds=LEASE_SECONDS)
    claimed = (
        await db.execute(
            update(jobs)
            .where(jobs.c.id == job["id"])
            .values(
                status="RUNNING",
                stage="extracting",
                attempts=int(job["attempts"]) + 1,
                leaseToken=lease_token,
                leaseOwner="backend-worker",
                leaseExpiresAt=lease_expires,
                startedAt=job["startedAt"] or now,
                lastHeartbeatAt=now,
                updatedAt=now,
            )
            .returning(jobs)
        )
    ).mappings().first()
    return dict(claimed) if claimed else None


async def process_claimed_job(
    db: AsyncConnection,
    job: dict[str, Any],
    *,
    data: bytes | None = None,
) -> dict[str, Any]:
    """Run ingestion for a claimed job with retryable failure handling."""

    jobs = tables["MedicalIngestionJob"]
    docs = tables["MedicalDocument"]
    doc_id = str(job["documentId"])
    try:
        raw_bytes = data
        if raw_bytes is None:
            doc = (
                await db.execute(select(docs).where(docs.c.id == doc_id))
            ).mappings().first()
            if doc is None:
                await db.execute(
                    update(jobs)
                    .where(jobs.c.id == job["id"])
                    .values(status="FAILED", stage="missing_document", completedAt=utcnow(), updatedAt=utcnow())
                )
                return {"jobId": job["id"], "status": "FAILED"}
            raw_bytes = await read_file_bytes(str(doc["storagePath"]))

        result = await run_document_ingestion(db, document_id=doc_id, data=raw_bytes)
        now = utcnow()
        await db.execute(
            update(jobs)
            .where(jobs.c.id == job["id"])
            .values(
                versionId=result.get("versionId"),
                status="COMPLETED" if result.get("status") != "FAILED" else "RETRYABLE",
                stage="indexed" if result.get("indexStatus") == "COMPLETED" else "extracted",
                completedAt=now if result.get("status") != "FAILED" else None,
                updatedAt=now,
            )
        )
        return result
    except Exception as exc:
        logger.exception("Durable ingestion job %s failed", job["id"])
        now = utcnow()
        attempts = int(job["attempts"])
        retryable = attempts < MAX_INGESTION_ATTEMPTS
        backoff = timedelta(seconds=min(300, (2**attempts) * 15))
        await db.execute(
            update(jobs)
            .where(jobs.c.id == job["id"])
            .values(
                status="RETRYABLE" if retryable else "FAILED",
                stage="retry_scheduled" if retryable else "failed",
                errorCode=type(exc).__name__,
                retryable=retryable,
                availableAt=now + backoff if retryable else now,
                completedAt=None if retryable else now,
                updatedAt=now,
            )
        )
        return {"jobId": job["id"], "status": "RETRYABLE" if retryable else "FAILED"}


async def recover_pending_ingestion_jobs(limit: int = 5) -> int:
    """Bounded recovery sweep for queued or interrupted ingestion jobs."""

    semaphore = asyncio.Semaphore(2)
    processed = 0
    for _ in range(max(1, min(limit, 20))):
        async with db_mod.engine.begin() as conn:
            job = await claim_next_ingestion_job(conn)
            if job is None:
                break
        async with semaphore:
            async with db_mod.engine.begin() as conn:
                await process_claimed_job(conn, job)
            processed += 1
    return processed
