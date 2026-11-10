"""HTTP adapters for patient profiles, search and statistics."""

from fastapi import APIRouter, Depends, Request
from sqlalchemy.ext.asyncio import AsyncConnection

from app.core.security import current_user
from app.infrastructure.database import get_db

from . import service
from .schemas import MedicalProfileUpdate, PatientCreateRequest, PatientUpdateRequest

router = APIRouter(prefix="/api", tags=["patients"])


@router.post("/patients", status_code=201)
async def create_patient(
    payload: PatientCreateRequest, user: dict = Depends(current_user), db: AsyncConnection = Depends(get_db)
):
    return await service.create_patient_profile(payload.model_dump(), user, db)


@router.patch("/patients")
async def update_patient(
    payload: PatientUpdateRequest, user: dict = Depends(current_user), db: AsyncConnection = Depends(get_db)
):
    return await service.update_patient_profile(
        db, payload.patientId, payload.model_dump(exclude_unset=True), user
    )


@router.get("/patients")
async def list_patients(
    request: Request, user: dict = Depends(current_user), db: AsyncConnection = Depends(get_db)
):
    return await service.list_patients(dict(request.query_params), user, db)


@router.get("/patients/{patientId}")
async def get_patient(
    patientId: str, user: dict = Depends(current_user), db: AsyncConnection = Depends(get_db)
):
    return await service.get_patient_profile(patientId, user, db)


@router.put("/patients/{patientId}")
@router.patch("/patients/{patientId}")
async def update_patient_profile(
    patientId: str,
    payload: MedicalProfileUpdate,
    user: dict = Depends(current_user),
    db: AsyncConnection = Depends(get_db),
):
    return await service.update_patient_profile(db, patientId, payload.model_dump(exclude_unset=True), user)


@router.get("/patients/{patientId}/stats")
async def get_patient_stats(
    patientId: str, user: dict = Depends(current_user), db: AsyncConnection = Depends(get_db)
):
    return await service.get_patient_stats(patientId, user, db)
