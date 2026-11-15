"""Persistence for Search Sphere normalized documents, versions, objects, and chunks."""

import hashlib
from typing import Any

from search_sphere_ingest.models import Chunk, NormalizedDocument
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncConnection

from app.infrastructure.database import new_id, tables, utcnow


def _sha256_bytes_or_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _map_status(status_val: Any) -> str:
    text = str(getattr(status_val, "value", status_val)).upper()
    if text in {"PENDING", "QUEUED", "RUNNING", "PARTIAL", "COMPLETED", "RETRYABLE", "FAILED", "REVOKED"}:
        return text
    return "PARTIAL"


async def create_ingestion_job(
    db: AsyncConnection,
    *,
    document_id: str,
    version_id: str | None = None,
) -> dict[str, Any]:
    jobs = tables["MedicalIngestionJob"]
    max_gen = (
        await db.execute(
            select(func.coalesce(func.max(jobs.c.generation), 0)).where(jobs.c.documentId == document_id)
        )
    ).scalar_one()
    now = utcnow()
    row = (
        await db.execute(
            jobs.insert()
            .values(
                id=new_id(),
                documentId=document_id,
                versionId=version_id,
                generation=int(max_gen) + 1,
                status="RUNNING",
                stage="extracting",
                attempts=1,
                availableAt=now,
                startedAt=now,
                createdAt=now,
                updatedAt=now,
            )
            .returning(jobs)
        )
    ).mappings().first()
    return dict(row)


async def persist_normalized_document(
    db: AsyncConnection,
    *,
    document_id: str,
    normalized: NormalizedDocument,
    chunks: list[Chunk],
    tokenizer_name: str = "tiktoken",
    pipeline_version: str = "search-sphere-ingest:0.3.0",
) -> dict[str, Any]:
    """Persist an immutable MedicalDocumentVersion and all extracted structure."""

    versions = tables["MedicalDocumentVersion"]
    max_ver = (
        await db.execute(
            select(func.coalesce(func.max(versions.c.versionNumber), 0)).where(
                versions.c.documentId == document_id
            )
        )
    ).scalar_one()

    now = utcnow()
    version_id = new_id()
    ext_status = _map_status(normalized.status)
    manifest = normalized.model_dump(mode="json")
    content_sha = _sha256_bytes_or_text(
        "|".join(_sha256_bytes_or_text(chunk.text) for chunk in chunks) or normalized.source_sha256
    )

    version_row = (
        await db.execute(
            versions.insert()
            .values(
                id=version_id,
                documentId=document_id,
                versionNumber=int(max_ver) + 1,
                sourceSha256=normalized.source_sha256,
                schemaVersion=str(normalized.schema_version),
                pipelineVersion=pipeline_version,
                configFingerprint=normalized.config_fingerprint,
                tokenizerName=tokenizer_name,
                extractionStatus=ext_status,
                indexStatus="PENDING",
                isPublished=False,
                pageCount=len(normalized.pages),
                objectCount=len(normalized.objects),
                chunkCount=len(chunks),
                issueCount=len(normalized.issues),
                manifest=manifest,
                pipelineMetadata={"traceId": normalized.trace_id},
                contentSha256=content_sha,
                createdAt=now,
                publishedAt=None,
            )
            .returning(versions)
        )
    ).mappings().first()

    page_id_by_num: dict[int, str] = {}
    pages_table = tables["MedicalDocumentPage"]
    for page in normalized.pages:
        pid = new_id()
        page_id_by_num[page.page_number] = pid
        await db.execute(
            pages_table.insert().values(
                id=pid,
                versionId=version_id,
                pageNumber=page.page_number,
                width=page.width,
                height=page.height,
                rotation=page.rotation,
                selectableChars=page.selectable_characters,
                cropbox=list(page.cropbox),
                pdfToPage=list(page.pdf_to_page) if page.pdf_to_page else None,
                status=_map_status(page.status),
                metadata=page.model_dump(mode="json"),
            )
        )

    sections_table = tables["MedicalDocumentSection"]
    for idx, sec in enumerate(normalized.sections):
        await db.execute(
            sections_table.insert().values(
                id=new_id(),
                versionId=version_id,
                sectionStableId=sec.section_id,
                parentSectionId=sec.parent_section_id,
                title=sec.title,
                level=sec.level,
                headingPath=sec.path,
                source=sec.source.model_dump(mode="json"),
                readingOrder=idx,
            )
        )

    obj_id_by_stable: dict[str, str] = {}
    objects_table = tables["MedicalDocumentObject"]
    regions_table = tables["MedicalObjectRegion"]
    for order_idx, obj in enumerate(normalized.objects):
        oid = new_id()
        obj_id_by_stable[obj.object_id] = oid
        obj_dump = obj.model_dump(mode="json")
        sources = obj_dump.get("sources") or []
        pages = [s["page_number"] for s in sources if isinstance(s, dict) and "page_number" in s]
        text_val = obj_dump.get("text") or obj_dump.get("caption") or obj_dump.get("description")
        await db.execute(
            objects_table.insert().values(
                id=oid,
                versionId=version_id,
                objectStableId=obj.object_id,
                kind=obj.kind,
                subtype=obj_dump.get("subtype"),
                title=obj_dump.get("title"),
                text=text_val,
                sectionStableId=obj_dump.get("section_id"),
                headingPath=obj_dump.get("heading_path"),
                firstPage=min(pages) if pages else None,
                lastPage=max(pages) if pages else None,
                readingOrder=order_idx,
                status=_map_status(obj_dump.get("status", "COMPLETED")),
                reviewRequired=bool(obj_dump.get("review_required", False)),
                confidence=obj_dump.get("confidence"),
                normalized=obj_dump,
                sourceSha256=normalized.source_sha256,
                createdAt=now,
            )
        )
        for r_idx, src in enumerate(sources):
            pnum = src.get("page_number")
            pid = page_id_by_num.get(pnum)
            bbox = src.get("bbox") or {}
            if pid and bbox:
                await db.execute(
                    regions_table.insert().values(
                        id=new_id(),
                        objectId=oid,
                        pageId=pid,
                        regionStableId=src.get("region_id", f"r_{r_idx}"),
                        parentRegionId=src.get("parent_region_id"),
                        readingOrder=int(src.get("reading_order", r_idx)),
                        coordinateSystem=src.get("coordinate_system", "unrotated_pdf_points"),
                        x0=float(bbox["x0"]),
                        y0=float(bbox["y0"]),
                        x1=float(bbox["x1"]),
                        y1=float(bbox["y1"]),
                        sourceImageId=src.get("source_image"),
                        provider=src.get("provider"),
                        model=src.get("model"),
                        confidence=src.get("confidence"),
                        evidence=src.get("evidence"),
                        source=src,
                    )
                )

    issues_table = tables["MedicalExtractionIssue"]
    for issue in normalized.issues:
        await db.execute(
            issues_table.insert().values(
                id=new_id(),
                versionId=version_id,
                pageNumber=issue.page_number,
                objectStableId=issue.region_id,
                stage=issue.stage,
                code=issue.code,
                retryable=issue.retryable,
                createdAt=now,
            )
        )

    chunks_table = tables["MedicalDocumentChunk"]
    chunk_objs_table = tables["MedicalChunkObject"]
    for idx, ch in enumerate(chunks):
        cid = new_id()
        ch_dump = ch.model_dump(mode="json")
        page_nums = sorted({s.page_number for s in ch.sources}) or [1]
        await db.execute(
            chunks_table.insert().values(
                id=cid,
                versionId=version_id,
                chunkStableId=ch.chunk_id,
                chunkIndex=idx,
                kind=ch.kind,
                content=ch.text,
                contentSha256=_sha256_bytes_or_text(ch.text),
                tokenCount=ch.token_count,
                tokenizer=ch.tokenizer,
                headingPath=ch_dump.get("heading_path"),
                sourceObjectIds=ch.source_object_ids,
                paragraphIds=ch_dump.get("paragraph_ids"),
                sentenceIds=ch_dump.get("sentence_ids"),
                pageNumbers=page_nums,
                startPage=min(page_nums),
                endPage=max(page_nums),
                rowStart=ch_dump.get("row_start"),
                rowEnd=ch_dump.get("row_end"),
                isFragment=bool(ch.fragment),
                provenance=ch_dump.get("sources") or [],
                pipelineVersion=pipeline_version,
                status="COMPLETED",
                createdAt=now,
            )
        )
        for obj_stable_id in ch.source_object_ids:
            oid = obj_id_by_stable.get(obj_stable_id)
            if oid:
                await db.execute(
                    chunk_objs_table.insert().values(
                        id=new_id(),
                        chunkId=cid,
                        objectId=oid,
                        createdAt=now,
                    )
                )

    docs_table = tables["MedicalDocument"]
    proc_status = "PROCESSING" if ext_status in {"COMPLETED", "PARTIAL"} else "FAILED"
    await db.execute(
        update(docs_table)
        .where(docs_table.c.id == document_id)
        .values(
            processingStatus=proc_status,
            processingError=None if proc_status == "PROCESSING" else "Document extraction failed",
            updatedAt=now,
        )
    )
    return dict(version_row)
