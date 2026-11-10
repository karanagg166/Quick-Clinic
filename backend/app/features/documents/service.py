"""Document ownership, quotas, audit, and atomic metadata/file lifecycle."""

import hashlib
import re
import logging
from datetime import datetime, timedelta
from fastapi import HTTPException
from starlette.concurrency import run_in_threadpool
from sqlalchemy import delete, func, insert, or_, select, update
from app.infrastructure.database import new_id, tables, utcnow
from .schemas import DocumentFilters, DocumentRename, DocumentType, DocumentUpload
from .storage import (
    MAX_ACCOUNT_BYTES,
    MAX_ACCOUNT_DOCUMENTS,
    document_metadata,
    safe_filename,
    validate_file,
)

from . import files

logger = logging.getLogger(__name__)

documents = tables["MedicalDocument"]
patients = tables["Patient"]
users = tables["User"]
appointments = tables["Appointment"]


async def get_patient_owner(database, actor, *, lock=False):
    if actor["role"] != "PATIENT":
        raise HTTPException(403, "Only patients can manage medical documents")
    query = select(patients).where(patients.c.userId == actor["id"])
    if lock:
        query = query.with_for_update()
    patient = (await database.execute(query)).mappings().first()
    if not patient:
        raise HTTPException(404, "Patient profile not found")
    return patient


async def record_access(database, actor, target_id, action):
    await database.execute(
        insert(tables["AccessLog"]).values(
            userId=actor["id"], targetId=target_id, action=action, tag="MEDICAL_RECORD"
        )
    )


async def require_doctor_record_access(database, actor, patient_id):
    if actor["role"] != "DOCTOR":
        raise HTTPException(403, "Doctor access required")
    doctors = tables["Doctor"]
    query = (
        select(appointments)
        .join(doctors, doctors.c.id == appointments.c.doctorId)
        .where(
            doctors.c.userId == actor["id"],
            appointments.c.patientId == patient_id,
            appointments.c.status.in_(["CONFIRMED", "COMPLETED"]),
        )
    )
    appointment = (
        (await database.execute(query.order_by(appointments.c.bookedAt.desc()).limit(1))).mappings().first()
    )
    if not appointment:
        raise HTTPException(403, "An eligible confirmed or completed appointment is required")
    return appointment


def document_query(patient_id, filters: DocumentFilters):
    query = select(documents).where(documents.c.patientId == patient_id)
    if filters.type in set(DocumentType):
        query = query.where(documents.c.type == filters.type)
    if filters.search.strip():
        query = query.where(
            or_(
                *[
                    column.icontains(filters.search.strip(), autoescape=True)
                    for column in (
                        documents.c.title,
                        documents.c.fileName,
                        documents.c.hospitalOrDoctor,
                        documents.c.notes,
                    )
                ]
            )
        )
    if filters.fileType == "PDF":
        query = query.where(documents.c.mimeType == "application/pdf")
    elif filters.fileType == "IMAGE":
        query = query.where(documents.c.mimeType.like("image/%"))
    if filters.reportDate:
        try:
            start = datetime.fromisoformat(filters.reportDate).replace(
                hour=0, minute=0, second=0, microsecond=0, tzinfo=None
            )
        except ValueError as exc:
            raise HTTPException(400, "Invalid report date") from exc
        query = query.where(
            documents.c.reportDate >= start, documents.c.reportDate < start + timedelta(days=1)
        )
    order = {
        "oldest": documents.c.reportDate.asc(),
        "name_asc": documents.c.title.asc(),
        "name_desc": documents.c.title.desc(),
    }.get(filters.sort, documents.c.reportDate.desc())
    return query.order_by(order)


async def list_patient_documents(database, actor, filters):
    patient = await get_patient_owner(database, actor)
    rows = (await database.execute(document_query(patient["id"], filters))).mappings().all()
    await record_access(database, actor, patient["id"], "MEDICAL_DOCUMENT_LIST")
    return {"documents": [document_metadata(row) for row in rows]}


async def upload_patient_document(
    database, actor, metadata: DocumentUpload, data, filename, mime_type, idempotency_key
):
    mime = await run_in_threadpool(validate_file, data, mime_type)
    # Patient lock serializes quota checks and idempotency across all backend instances.
    patient = await get_patient_owner(database, actor, lock=True)
    fingerprint_data = metadata.model_dump_json().encode()
    fingerprint = hashlib.sha256(data + fingerprint_data).hexdigest()
    identifier = new_id()
    if idempotency_key:
        if not re.fullmatch(r"[A-Za-z0-9_-]{8,128}", idempotency_key):
            raise HTTPException(400, "Invalid idempotency key")
        identifier = "doc_" + hashlib.sha256(f"{patient['id']}:{idempotency_key}".encode()).hexdigest()
    relative = files.upload_key(patient["id"], identifier, fingerprint)
    existing = (
        (await database.execute(select(documents).where(documents.c.id == identifier))).mappings().first()
    )
    if existing:
        if existing["storagePath"] != relative:
            raise HTTPException(409, "Idempotency key was used with a different upload")
        return document_metadata(existing), False
    count, total = (
        await database.execute(
            select(func.count(), func.coalesce(func.sum(documents.c.fileSize), 0)).where(
                documents.c.patientId == patient["id"]
            )
        )
    ).one()
    if count >= MAX_ACCOUNT_DOCUMENTS or total + len(data) > MAX_ACCOUNT_BYTES:
        raise HTTPException(403, "Account storage quota exceeded")
    await files.write_file(relative, data, safe_filename(filename), mime)
    try:
        row = (
            (
                await database.execute(
                    insert(documents)
                    .values(
                        id=identifier,
                        patientId=patient["id"],
                        title=metadata.title,
                        type=metadata.type.value,
                        fileName=safe_filename(filename),
                        mimeType=mime,
                        fileSize=len(data),
                        storagePath=relative,
                        reportDate=metadata.reportDate,
                        hospitalOrDoctor=metadata.hospitalOrDoctor or None,
                        notes=metadata.notes or None,
                        processingStatus="READY",
                        processedAt=utcnow(),
                    )
                    .returning(documents)
                )
            )
            .mappings()
            .one()
        )
        await record_access(database, actor, identifier, "MEDICAL_DOCUMENT_UPLOAD")
        await database.commit()
    except BaseException:
        try:
            await files.remove_file(relative)
        except Exception:
            logger.error("Orphaned medical file requires storage cleanup")
        raise
    return document_metadata(row), True


async def get_owned_document(database, actor, document_id):
    patient = await get_patient_owner(database, actor)
    document = (
        (
            await database.execute(
                select(documents).where(documents.c.id == document_id, documents.c.patientId == patient["id"])
            )
        )
        .mappings()
        .first()
    )
    if not document:
        raise HTTPException(404, "Document not found")
    return document


async def rename_patient_document(database, actor, document_id, payload: DocumentRename):
    await get_owned_document(database, actor, document_id)
    row = (
        (
            await database.execute(
                update(documents)
                .where(documents.c.id == document_id)
                .values(title=payload.title)
                .returning(documents)
            )
        )
        .mappings()
        .one()
    )
    await record_access(database, actor, document_id, "MEDICAL_DOCUMENT_RENAME")
    return {"document": document_metadata(row)}


async def delete_patient_document(database, actor, document_id):
    document = await get_owned_document(database, actor, document_id)
    files.check_managed_file(document["storagePath"])
    # Delete the private object first; preserve metadata if the provider fails.
    await files.remove_file(document["storagePath"])
    await database.execute(delete(documents).where(documents.c.id == document_id))
    await record_access(database, actor, document_id, "MEDICAL_DOCUMENT_DELETE")
    await database.commit()
    return {"success": True}


async def get_doctor_document(database, actor, patient_id, document_id):
    await require_doctor_record_access(database, actor, patient_id)
    document = (
        (
            await database.execute(
                select(documents).where(documents.c.id == document_id, documents.c.patientId == patient_id)
            )
        )
        .mappings()
        .first()
    )
    if not document:
        raise HTTPException(404, "Document not found")
    return document


async def download_patient_file(database, actor, document, action):
    files.check_managed_file(document["storagePath"])
    await record_access(database, actor, document["id"], "MEDICAL_DOCUMENT_DOWNLOAD")
    await database.commit()
    return await files.file_response(document, action)


async def list_accessible_patients(database, actor):
    if actor["role"] != "DOCTOR":
        raise HTTPException(403, "Doctor access required")
    doctors = tables["Doctor"]
    query = (
        select(patients.c.id, users.c.name, users.c.age, users.c.gender, users.c.profileImageUrl)
        .join(users, users.c.id == patients.c.userId)
        .where(
            patients.c.id.in_(
                select(appointments.c.patientId)
                .join(doctors, doctors.c.id == appointments.c.doctorId)
                .where(doctors.c.userId == actor["id"], appointments.c.status.in_(["CONFIRMED", "COMPLETED"]))
            )
        )
    )
    return [dict(row, relationship="CONFIRMED") for row in (await database.execute(query)).mappings()]


async def list_doctor_documents(database, actor, patient_id, filters):
    appointment = await require_doctor_record_access(database, actor, patient_id)
    summary = (
        (
            await database.execute(
                select(patients.c.id, users.c.name, users.c.age, users.c.gender, users.c.profileImageUrl)
                .join(users, users.c.id == patients.c.userId)
                .where(patients.c.id == patient_id)
            )
        )
        .mappings()
        .one()
    )
    records = (await database.execute(document_query(patient_id, filters))).mappings().all()
    await record_access(database, actor, patient_id, "MEDICAL_DOCUMENT_LIST")
    return {
        "patient": dict(
            summary,
            qualifyingAppointment={
                "id": appointment["id"],
                "status": appointment["status"],
                "date": appointment["bookedAt"],
            },
        ),
        "documents": [document_metadata(row) for row in records],
    }
