"""HTTP adapters for administrator-only management and reporting."""

from fastapi import APIRouter, Depends, Request
from sqlalchemy.ext.asyncio import AsyncConnection

from app.core.security import require_roles
from app.infrastructure.database import get_db

from . import logs, reporting, service, withdrawals
from .schemas import AdminOnboardingRequest, AdminUserUpdateRequest, WithdrawalDecisionRequest

router = APIRouter(prefix="/api/admin", tags=["administration"])
require_admin = require_roles("ADMIN")


@router.get("/logs")
async def list_logs(
    request: Request, user: dict = Depends(require_admin), db: AsyncConnection = Depends(get_db)
):
    return await logs.list_logs(dict(request.query_params), user, db)


@router.post("/onboarding")
async def onboard_admin(
    payload: AdminOnboardingRequest,
    user: dict = Depends(require_admin),
    db: AsyncConnection = Depends(get_db),
):
    return await service.onboard_admin(payload.model_dump(exclude_unset=True), user, db)


@router.get("/users")
async def list_users(
    request: Request, user: dict = Depends(require_admin), db: AsyncConnection = Depends(get_db)
):
    return await service.list_users(dict(request.query_params), user, db)


@router.get("/users/{userId}")
async def get_user(userId: str, user: dict = Depends(require_admin), db: AsyncConnection = Depends(get_db)):
    return await service.get_user(userId, user, db)


@router.patch("/users/{userId}")
async def update_user(
    userId: str,
    payload: AdminUserUpdateRequest,
    user: dict = Depends(require_admin),
    db: AsyncConnection = Depends(get_db),
):
    return await service.update_user(userId, payload.model_dump(exclude_unset=True), user, db)


@router.delete("/users/{userId}")
async def delete_user(
    userId: str, user: dict = Depends(require_admin), db: AsyncConnection = Depends(get_db)
):
    return await service.delete_user(userId, user, db)


@router.get("/analytics")
async def get_analytics(user: dict = Depends(require_admin), db: AsyncConnection = Depends(get_db)):
    return await reporting.get_analytics(user, db)


@router.get("/withdrawals")
async def list_withdrawals(
    request: Request, user: dict = Depends(require_admin), db: AsyncConnection = Depends(get_db)
):
    return await withdrawals.list_withdrawals(dict(request.query_params), user, db)


@router.patch("/withdrawals")
async def finalize_withdrawal(
    payload: WithdrawalDecisionRequest,
    user: dict = Depends(require_admin),
    db: AsyncConnection = Depends(get_db),
):
    return await withdrawals.finalize_withdrawal(payload.model_dump(exclude_unset=True), user, db)
