"""HTTP adapters for credentials and email verification."""

from fastapi import APIRouter, Depends, Response
from sqlalchemy.ext.asyncio import AsyncConnection

from app.core.config import get_settings
from app.core.security import current_user, issue_token
from app.infrastructure.database import get_db

from . import service
from .schemas import (
    LoginRequest,
    OtpVerificationRequest,
    PasswordChangeRequest,
    PasswordResetRequest,
    SignupRequest,
)

router = APIRouter(prefix="/api", tags=["authentication"])


def set_session_cookies(response: Response, user: dict) -> None:
    secure = get_settings().node_env == "production"
    response.set_cookie(
        "token", issue_token(user), httponly=True, secure=secure, samesite="lax", path="/", max_age=604800
    )
    response.set_cookie("role", user["role"], secure=secure, samesite="strict", path="/")


@router.post("/user/signup", status_code=201)
async def signup(payload: SignupRequest, response: Response, db: AsyncConnection = Depends(get_db)):
    result = await service.register_user(payload.model_dump(), db)
    set_session_cookies(response, result["user"])
    return result


@router.post("/user/login")
async def login(payload: LoginRequest, response: Response, db: AsyncConnection = Depends(get_db)):
    result = await service.authenticate_user(payload.model_dump(), db)
    set_session_cookies(response, result["user"])
    return result


@router.post("/user/logout")
async def logout(response: Response):
    response.delete_cookie("token", path="/")
    response.delete_cookie("role", path="/")
    return {"message": "Logged out"}


@router.post("/user/change-password")
async def change_password(
    payload: PasswordChangeRequest, user: dict = Depends(current_user), db: AsyncConnection = Depends(get_db)
):
    return await service.change_password(payload.model_dump(exclude_unset=True), user, db)


@router.post("/user/reset-password")
async def reset_password(payload: PasswordResetRequest, db: AsyncConnection = Depends(get_db)):
    return await service.reset_password(payload.model_dump(), db)


@router.post("/user/{userId}/otp/send")
async def send_otp(userId: str, db: AsyncConnection = Depends(get_db)):
    return await service.send_email_otp(userId, db)


@router.post("/user/{userId}/otp/verify")
async def verify_otp(userId: str, payload: OtpVerificationRequest, db: AsyncConnection = Depends(get_db)):
    return await service.verify_email_otp(userId, payload.model_dump(), db)
