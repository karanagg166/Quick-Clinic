"""Document cleanup and permission/deletion evidence invalidation."""

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncConnection

from app.infrastructure.database import new_id, tables, utcnow


async def enqueue_document_cleanup(
    db: AsyncConnection,
    *,
    document_id: str,
    storage_path: str,
) -> None:
    cleanup = tables.get("MedicalDocumentCleanup")
    if cleanup is None:
        return
    await db.execute(
        cleanup.insert().values(
            id=new_id(),
            documentId=document_id,
            documentIdSnapshot=document_id,
            storagePath=storage_path,
            status="QUEUED",
            attempts=0,
            availableAt=utcnow(),
            createdAt=utcnow(),
        )
    )


async def invalidate_document_evidence(
    db: AsyncConnection,
    *,
    document_id: str,
    reason: str = "DOCUMENT_DELETED_OR_REVOKED",
) -> None:
    """Revoke document versions, citations, and affected agent memory snapshots."""

    versions = tables["MedicalDocumentVersion"]
    citations = tables["AgentMessageCitation"]
    messages = tables["AgentMessage"]
    snapshots = tables["AgentMemorySnapshot"]
    threads = tables["AgentThread"]
    now = utcnow()

    version_ids = [
        r[0]
        for r in (
            await db.execute(select(versions.c.id).where(versions.c.documentId == document_id))
        ).all()
    ]
    if not version_ids:
        return

    await db.execute(
        update(versions)
        .where(versions.c.id.in_(version_ids), versions.c.revokedAt.is_(None))
        .values(revokedAt=now, isPublished=False, extractionStatus="REVOKED")
    )
    await db.execute(
        update(citations)
        .where(citations.c.documentVersionId.in_(version_ids), citations.c.revokedAt.is_(None))
        .values(revokedAt=now)
    )

    affected_threads = [
        r[0]
        for r in (
            await db.execute(
                select(messages.c.threadId)
                .select_from(citations.join(messages, messages.c.id == citations.c.messageId))
                .where(citations.c.documentVersionId.in_(version_ids))
                .distinct()
            )
        ).all()
    ]
    if affected_threads:
        await db.execute(
            update(snapshots)
            .where(snapshots.c.threadId.in_(affected_threads), snapshots.c.invalidatedAt.is_(None))
            .values(invalidatedAt=now, invalidationReason=reason)
        )
        await db.execute(
            update(threads)
            .where(threads.c.id.in_(affected_threads))
            .values(permissionRevision=threads.c.permissionRevision + 1, updatedAt=now)
        )
