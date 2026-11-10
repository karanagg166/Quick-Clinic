"""HTTP adapters for patient-owned files and authorized doctor read access."""

from typing import Annotated, Literal
from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, Response, UploadFile
from pydantic import ValidationError
from sqlalchemy.ext.asyncio import AsyncConnection
from app.core.security import current_user
from app.infrastructure.database import get_db
from . import service
from .schemas import DocumentFilters, DocumentRename, DocumentUpload
from .storage import MAX_FILE_BYTES
from .files import check_managed_file

router = APIRouter(prefix="/api", tags=["medical documents"])
Database = Annotated[AsyncConnection, Depends(get_db)]
Actor = Annotated[dict, Depends(current_user)]
FileAction = Literal["view", "download"]


@router.get("/patients/me/medical-documents")
async def list_documents(database: Database, actor: Actor, filters: Annotated[DocumentFilters, Depends()]):
    return await service.list_patient_documents(database, actor, filters)


@router.post("/patients/me/medical-documents", status_code=201)
async def upload_document(
    database: Database,
    actor: Actor,
    response: Response,
    file: UploadFile = File(...),
    title: str = Form(...),
    type: str = Form(...),
    reportDate: str = Form(...),
    hospitalOrDoctor: str = Form(""),
    notes: str = Form(""),
    idempotency_key: Annotated[str | None, Header()] = None,
):
    try:
        metadata = DocumentUpload(
            title=title, type=type, reportDate=reportDate, hospitalOrDoctor=hospitalOrDoctor, notes=notes
        )
    except ValidationError as exc:
        raise HTTPException(400, "Invalid document metadata") from exc
    data = await file.read(MAX_FILE_BYTES + 1)
    document, created = await service.upload_patient_document(
        database, actor, metadata, data, file.filename or "document", file.content_type or "", idempotency_key
    )
    response.status_code = 201 if created else 200
    return {"document": document}


@router.get("/patients/me/medical-documents/{document_id}")
async def get_document(document_id: str, database: Database, actor: Actor):
    document = await service.get_owned_document(database, actor, document_id)
    await service.record_access(database, actor, document_id, "MEDICAL_DOCUMENT_ACCESS")
    return {"document": service.document_metadata(document)}


@router.patch("/patients/me/medical-documents/{document_id}")
async def rename_document(document_id: str, payload: DocumentRename, database: Database, actor: Actor):
    return await service.rename_patient_document(database, actor, document_id, payload)


@router.delete("/patients/me/medical-documents/{document_id}")
async def delete_document(document_id: str, database: Database, actor: Actor):
    return await service.delete_patient_document(database, actor, document_id)


@router.get("/patients/me/medical-documents/{document_id}/access")
async def document_access(document_id: str, database: Database, actor: Actor, action: FileAction = "view"):
    document = await service.get_owned_document(database, actor, document_id)
    check_managed_file(document["storagePath"])
    await service.record_access(database, actor, document_id, "MEDICAL_DOCUMENT_ACCESS")
    return {"url": f"/api/patients/me/medical-documents/{document_id}/file?action={action}"}


@router.get("/patients/me/medical-documents/{document_id}/file")
async def document_file(document_id: str, database: Database, actor: Actor, action: FileAction = "view"):
    document = await service.get_owned_document(database, actor, document_id)
    return await service.download_patient_file(database, actor, document, action)


@router.get("/doctors/me/medical-record-patients")
async def accessible_patients(database: Database, actor: Actor):
    return await service.list_accessible_patients(database, actor)


@router.get("/doctors/me/patients/{patient_id}/medical-documents")
async def doctor_documents(
    patient_id: str, database: Database, actor: Actor, filters: Annotated[DocumentFilters, Depends()]
):
    return await service.list_doctor_documents(database, actor, patient_id, filters)


@router.get("/doctors/me/patients/{patient_id}/medical-documents/{document_id}/access")
async def doctor_document_access(
    patient_id: str, document_id: str, database: Database, actor: Actor, action: FileAction = "view"
):
    document = await service.get_doctor_document(database, actor, patient_id, document_id)
    check_managed_file(document["storagePath"])
    return {
        "url": f"/api/doctors/me/patients/{patient_id}/medical-documents/{document_id}/file?action={action}"
    }


@router.get("/doctors/me/patients/{patient_id}/medical-documents/{document_id}/file")
async def doctor_document_file(
    patient_id: str, document_id: str, database: Database, actor: Actor, action: FileAction = "view"
):
    document = await service.get_doctor_document(database, actor, patient_id, document_id)
    return await service.download_patient_file(database, actor, document, action)
