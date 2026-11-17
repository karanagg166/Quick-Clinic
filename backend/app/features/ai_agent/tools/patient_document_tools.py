"""Patient document & RAG tools using the shared Search Sphere pipeline."""

import json
from typing import Any

from langchain_core.tools import BaseTool, tool
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncConnection

from app.features.ai_agent.persistence.threads import list_thread_messages
from app.features.ai_agent.rag.pipeline import answer_medical_question
from app.features.documents import service as documents_svc
from app.features.documents.schemas import DocumentFilters
from app.infrastructure.database import tables


def build_patient_document_tools(
    *,
    db: AsyncConnection,
    actor: dict[str, Any],
    thread_id: str | None = None,
    turn_id: str | None = None,
) -> list[BaseTool]:
    """Build patient-scoped medical document & RAG retrieval tools."""

    @tool
    async def list_my_medical_documents(doc_type: str = "", limit: int = 20) -> str:
        """List your own uploaded medical documents."""
        filters = DocumentFilters(type=doc_type or None)
        res = await documents_svc.list_patient_documents(db, actor, filters)
        docs = res.get("documents", [])[: max(1, min(limit, 50))]
        return json.dumps({"documents": docs}, default=str)

    @tool
    async def get_my_document_details(document_id: str) -> str:
        """Get metadata for one of your own uploaded medical documents."""
        doc = await documents_svc.get_owned_document(db, actor, document_id)
        return json.dumps({"document": documents_svc.document_metadata(doc)}, default=str)

    @tool
    async def get_document_processing_status(document_id: str) -> str:
        """Check extraction and RAG indexing status for one of your medical documents."""
        doc = await documents_svc.get_owned_document(db, actor, document_id)
        jobs_t = tables["MedicalIngestionJob"]
        versions_t = tables["MedicalDocumentVersion"]
        latest_job = (
            await db.execute(
                select(jobs_t)
                .where(jobs_t.c.documentId == document_id)
                .order_by(desc(jobs_t.c.generation))
                .limit(1)
            )
        ).mappings().first()
        latest_ver = (
            await db.execute(
                select(versions_t)
                .where(versions_t.c.documentId == document_id, versions_t.c.revokedAt.is_(None))
                .order_by(desc(versions_t.c.versionNumber))
                .limit(1)
            )
        ).mappings().first()
        rag_ready = bool(
            latest_ver is not None
            and latest_ver["isPublished"] is True
            and latest_ver["indexStatus"] == "COMPLETED"
        )
        issues_t = tables["MedicalExtractionIssue"]
        issue_rows = (
            (
                await db.execute(
                    select(issues_t.c.code, issues_t.c.stage, issues_t.c.pageNumber, issues_t.c.retryable)
                    .where(issues_t.c.versionId == latest_ver["id"])
                    .limit(20)
                )
            )
            .mappings()
            .all()
            if latest_ver is not None
            else []
        )
        return json.dumps(
            {
                "documentId": document_id,
                "processingStatus": doc["processingStatus"],
                "processingError": doc.get("processingError"),
                "ragReady": rag_ready,
                "job": dict(latest_job) if latest_job else None,
                "version": {
                    "id": latest_ver["id"],
                    "extractionStatus": latest_ver["extractionStatus"],
                    "indexStatus": latest_ver["indexStatus"],
                    "isPublished": latest_ver["isPublished"],
                    "chunkCount": latest_ver["chunkCount"],
                    "issueCount": latest_ver["issueCount"],
                }
                if latest_ver
                else None,
                "issues": [dict(r) for r in issue_rows],
            },
            default=str,
        )

    @tool
    async def search_my_medical_documents(
        query: str,
        document_ids: list[str] | None = None,
        document_type: str | None = None,
        top_k: int = 5,
    ) -> str:
        """Search your own uploaded medical documents and get evidence-grounded answers with citations."""
        history = (
            await list_thread_messages(db, thread_id=thread_id, limit=12)
            if thread_id
            else []
        )
        bounded_k = max(1, min(int(top_k or 5), 15))
        res = await answer_medical_question(
            db,
            actor=actor,
            patient_id=None,
            question=query,
            turn_id=turn_id,
            history_messages=history,
            document_ids=document_ids,
            document_type=document_type,
            top_k=bounded_k,
        )
        return json.dumps(
            {
                "query": query,
                "rewritten_query": res.get("rewrittenQuery") or query,
                "retrieval_run_id": res.get("retrievalRunId"),
                "answer": res.get("answer"),
                "chunks": res.get("chunks", []),
                "citations": res.get("citations", []),
            },
            default=str,
        )

    return [
        list_my_medical_documents,
        get_my_document_details,
        get_document_processing_status,
        search_my_medical_documents,
    ]
