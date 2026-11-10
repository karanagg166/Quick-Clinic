"""HTTP contracts for doctor discovery, profiles, reviews and finances."""

from fastapi import APIRouter, Depends, HTTPException, Request
from app.infrastructure.database import get_db
from app.core.security import current_user
from . import service

router = APIRouter(prefix="/api", tags=["Doctors"])


@router.get("/doctors/specializations")
async def specializations():
    return {"specialties": service.SPECIALTIES}


@router.get("/doctors/qualifications")
async def qualifications():
    return {"qualifications": service.QUALIFICATIONS}


@router.get("/doctors")
async def search_doctors(request: Request, db=Depends(get_db)):
    return await service.search_doctors(request.query_params, db)


@router.post("/doctors", status_code=201)
async def create_doctor(request: Request, user=Depends(current_user), db=Depends(get_db)):
    return await service.create_doctor_profile(await request.json(), user, db)


@router.get("/doctors/{doctorId}")
async def get_doctor(doctorId: str, request: Request, db=Depends(get_db)):
    try:
        viewer = await current_user(request, db)
    except HTTPException as exc:
        if exc.status_code != 401:
            raise
        viewer = None
    return await service.get_doctor_profile(doctorId, viewer, db)


@router.put("/doctors/{doctorId}")
@router.patch("/doctors/{doctorId}")
async def update_doctor(doctorId: str, request: Request, user=Depends(current_user), db=Depends(get_db)):
    return await service.update_doctor_profile(doctorId, await request.json(), user, db)


@router.get("/doctors/{doctorId}/rating")
async def get_rating(doctorId: str, db=Depends(get_db)):
    return await service.rating_summary(doctorId, db)


@router.post("/doctors/{doctorId}/rating")
async def rate_doctor(doctorId: str, request: Request, user=Depends(current_user), db=Depends(get_db)):
    return await service.submit_rating(doctorId, await request.json(), user, db)


@router.get("/doctors/{doctorId}/comments")
async def get_comments(doctorId: str, db=Depends(get_db)):
    return await service.list_comments(doctorId, db)


@router.post("/doctors/{doctorId}/comments", status_code=201)
async def post_comment(doctorId: str, request: Request, user=Depends(current_user), db=Depends(get_db)):
    return await service.create_comment(doctorId, await request.json(), user, db)


@router.get("/doctors/{doctorId}/balance")
async def get_balance(doctorId: str, user=Depends(current_user), db=Depends(get_db)):
    return await service.get_balance(doctorId, user, db)


@router.get("/doctors/{doctorId}/earnings")
async def get_earnings(doctorId: str, request: Request, user=Depends(current_user), db=Depends(get_db)):
    return await service.list_earnings(doctorId, request.query_params, user, db)


@router.get("/doctors/{doctorId}/stats")
async def get_statistics(doctorId: str, user=Depends(current_user), db=Depends(get_db)):
    return await service.get_doctor_statistics(doctorId, user, db)


@router.get("/doctors/{doctorId}/withdrawals")
async def get_withdrawals(doctorId: str, user=Depends(current_user), db=Depends(get_db)):
    return await service.list_withdrawals(doctorId, user, db)


@router.post("/doctors/{doctorId}/withdrawals", status_code=201)
async def create_withdrawal(doctorId: str, request: Request, user=Depends(current_user), db=Depends(get_db)):
    return await service.request_withdrawal(doctorId, await request.json(), user, db)
