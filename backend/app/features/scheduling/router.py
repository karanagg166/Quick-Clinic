"""Scheduling HTTP boundary; business rules live in the scheduling service."""

from fastapi import APIRouter, Depends, Request, Response
from app.infrastructure.database import get_db
from app.core.security import current_user
from . import service

router = APIRouter(prefix="/api", tags=["Scheduling"])


@router.get("/doctors/{doctorId}/schedule")
async def get_schedule(doctorId: str, db=Depends(get_db)):
    return await service.get_schedule(doctorId, db)


@router.post("/doctors/{doctorId}/schedule", status_code=201)
async def save_schedule(doctorId: str, request: Request, user=Depends(current_user), db=Depends(get_db)):
    return await service.upsert_schedule(doctorId, await request.json(), user, db)


@router.get("/doctors/{doctorId}/slots")
async def list_slots(doctorId: str, date: str, response: Response, db=Depends(get_db)):
    (slots, generated) = await service.daily_slots(db, doctorId, service.parse_date(date))
    response.status_code = 201 if generated else 200
    return {"slots": slots}


@router.post("/doctors/{doctorId}/slots", status_code=201)
async def create_slot(doctorId: str, request: Request, user=Depends(current_user), db=Depends(get_db)):
    return await service.create_ad_hoc_slot(doctorId, await request.json(), user, db)


@router.patch("/doctors/{doctorId}/slots")
async def update_slots(doctorId: str, request: Request, user=Depends(current_user), db=Depends(get_db)):
    return await service.set_slot_availability(doctorId, await request.json(), user, db)


@router.delete("/doctors/{doctorId}/slots")
async def delete_slot(doctorId: str, request: Request, user=Depends(current_user), db=Depends(get_db)):
    return await service.remove_available_slot(doctorId, await request.json(), user, db)


@router.get("/doctors/{doctorId}/leave")
async def list_leaves(doctorId: str, request: Request, user=Depends(current_user), db=Depends(get_db)):
    return await service.list_leaves(doctorId, request.query_params, user, db)


@router.post("/doctors/{doctorId}/leave", status_code=201)
@router.patch("/doctors/{doctorId}/leave")
async def save_leave(
    doctorId: str, request: Request, response: Response, user=Depends(current_user), db=Depends(get_db)
):
    result = await service.upsert_leave(doctorId, await request.json(), request.method, user, db)
    response.status_code = 200 if request.method == "PATCH" else 201
    return result


@router.delete("/doctors/{doctorId}/leave")
async def delete_leave(doctorId: str, leaveId: str, user=Depends(current_user), db=Depends(get_db)):
    return await service.cancel_leave(doctorId, leaveId, user, db)


@router.get("/doctors/{doctorId}/schedule/overview")
async def overview(doctorId: str, request: Request, user=Depends(current_user), db=Depends(get_db)):
    return await service.get_schedule_overview(doctorId, request.query_params, user, db)
