"""HTTP adapters for profiles, avatars, bank accounts and notifications."""

from fastapi import APIRouter, Depends, File, UploadFile
from sqlalchemy.ext.asyncio import AsyncConnection

from app.core.security import current_user
from app.infrastructure.database import get_db

from . import avatars, banking, notifications, service
from .schemas import AvatarUpdateRequest, BankDetailsRequest, ProfileUpdateRequest

router = APIRouter(prefix="/api", tags=["accounts"])


@router.get("/user/{userId}")
async def get_profile(userId: str, user: dict = Depends(current_user), db: AsyncConnection = Depends(get_db)):
    return await service.get_profile(userId, user, db)


@router.patch("/user/{userId}")
async def update_profile(
    userId: str,
    payload: ProfileUpdateRequest,
    user: dict = Depends(current_user),
    db: AsyncConnection = Depends(get_db),
):
    return await service.update_profile(userId, payload.model_dump(exclude_unset=True), user, db)


@router.get("/user/{userId}/avatar")
async def get_avatar(userId: str, db: AsyncConnection = Depends(get_db)):
    return await avatars.get_avatar(userId, db)


@router.post("/user/{userId}/avatar")
async def update_avatar(
    userId: str,
    payload: AvatarUpdateRequest,
    user: dict = Depends(current_user),
    db: AsyncConnection = Depends(get_db),
):
    return await avatars.update_avatar(userId, payload.model_dump(exclude_unset=True), user, db)


@router.post("/user/{userId}/avatar/upload")
async def upload_avatar(
    userId: str,
    file: UploadFile = File(...),
    user: dict = Depends(current_user),
    db: AsyncConnection = Depends(get_db),
):
    return await avatars.upload_avatar(userId, file, user, db)


@router.get("/user/{userId}/bank-details")
async def get_bank_details(
    userId: str, user: dict = Depends(current_user), db: AsyncConnection = Depends(get_db)
):
    return await banking.get_bank_details(userId, user, db)


@router.patch("/user/{userId}/bank-details")
async def save_bank_details(
    userId: str,
    payload: BankDetailsRequest,
    user: dict = Depends(current_user),
    db: AsyncConnection = Depends(get_db),
):
    return await banking.save_bank_details(userId, payload.model_dump(), user, db)


@router.get("/user/{userId}/notification")
async def list_notifications(
    userId: str, user: dict = Depends(current_user), db: AsyncConnection = Depends(get_db)
):
    return await notifications.list_notifications(userId, user, db)


@router.patch("/user/{userId}/notification/{id}")
async def mark_notification_read(
    userId: str, id: str, user: dict = Depends(current_user), db: AsyncConnection = Depends(get_db)
):
    return await notifications.mark_notification_read(userId, id, user, db)


@router.delete("/user/{userId}/notification/{id}")
async def delete_notification(
    userId: str, id: str, user: dict = Depends(current_user), db: AsyncConnection = Depends(get_db)
):
    return await notifications.delete_notification(userId, id, user, db)


@router.get("/doctors/{doctorId}/bank-details")
async def get_doctor_bank_details(
    doctorId: str, user: dict = Depends(current_user), db: AsyncConnection = Depends(get_db)
):
    return await banking.get_doctor_bank_details(doctorId, user, db)


@router.patch("/doctors/{doctorId}/bank-details")
async def save_doctor_bank_details(
    doctorId: str,
    payload: BankDetailsRequest,
    user: dict = Depends(current_user),
    db: AsyncConnection = Depends(get_db),
):
    return await banking.save_doctor_bank_details(doctorId, payload.model_dump(), user, db)
