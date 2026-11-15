"""Atomic document version publishing, state transitions, and active version resolution."""

import logging
from typing import Any

from sqlalchemy import desc, select, update
from sqlalchemy.ext.asyncio import AsyncConnection

from app.infrastructure.database import tables, utcnow

logger = logging.getLogger(__name__)


async def publish_document_version(
    db: AsyncConnection,
    *,
    document_id: str,
    version_id: str,
) -> dict[str, Any]:
    """Atomically publish a document version after extraction and indexing succeed.

    Demotes any previously published versions, promotes target version to isPublished=True,
    and updates parent MedicalDocument to processingStatus="READY".
    """
    versions = tables["MedicalDocumentVersion"]
    docs = tables["MedicalDocument"]

    target = (
        await db.execute(
            select(versions).where(
                versions.c.id == version_id,
                versions.c.documentId == document_id,
            )
        )
    ).mappings().first()

    if target is None:
        raise ValueError(f"Document version {version_id} not found for document {document_id}")

    if target["extractionStatus"] not in {"COMPLETED", "PARTIAL"}:
        raise ValueError(
            f"Cannot publish version {version_id} with extractionStatus={target['extractionStatus']}"
        )

    if target["indexStatus"] != "COMPLETED":
        raise ValueError(
            f"Cannot publish version {version_id} with indexStatus={target['indexStatus']}; "
            "embeddings must be completed before publishing"
        )

    now = utcnow()

    # Atomically demote any currently published versions for this document
    await db.execute(
        update(versions)
        .where(
            versions.c.documentId == document_id,
            versions.c.id != version_id,
            versions.c.isPublished.is_(True),
        )
        .values(isPublished=False)
    )

    # Publish target version
    published = (
        await db.execute(
            update(versions)
            .where(versions.c.id == version_id)
            .values(
                isPublished=True,
                publishedAt=now,
                revokedAt=None,
            )
            .returning(versions)
        )
    ).mappings().first()

    # Set parent MedicalDocument to READY and record completion timestamp
    await db.execute(
        update(docs)
        .where(docs.c.id == document_id)
        .values(
            processingStatus="READY",
            processedAt=now,
            processingError=None,
            updatedAt=now,
        )
    )

    return dict(published) if published else dict(target)


async def get_published_version(
    db: AsyncConnection,
    *,
    document_id: str,
) -> dict[str, Any] | None:
    """Return the currently published, non-revoked version for a document."""
    versions = tables["MedicalDocumentVersion"]
    row = (
        await db.execute(
            select(versions)
            .where(
                versions.c.documentId == document_id,
                versions.c.isPublished.is_(True),
                versions.c.revokedAt.is_(None),
            )
            .order_by(desc(versions.c.versionNumber))
            .limit(1)
        )
    ).mappings().first()
    return dict(row) if row else None


async def revoke_document_version(
    db: AsyncConnection,
    *,
    document_id: str,
    version_id: str,
) -> None:
    """Revoke a published version, preventing any future RAG retrieval from it."""
    versions = tables["MedicalDocumentVersion"]
    now = utcnow()
    await db.execute(
        update(versions)
        .where(versions.c.id == version_id, versions.c.documentId == document_id)
        .values(
            isPublished=False,
            revokedAt=now,
            extractionStatus="REVOKED",
        )
    )
