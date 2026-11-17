"""Process liveness and bounded database readiness probes."""

import asyncio
import os
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from sqlalchemy import text
from app.core.clock import get_request_clock
from app.core.config import get_settings
from app.infrastructure.database import engine

router = APIRouter(tags=["health"])


@router.get("/health")
@router.get("/api/health")
async def liveness(request: Request):
    settings = get_settings()
    req_clock = get_request_clock(request)
    git_commit = (
        settings.git_commit
        if settings.git_commit and settings.git_commit != "unknown"
        else os.environ.get("RENDER_GIT_COMMIT", "unknown")
    )
    return {
        "status": "ok",
        "service": "quick-clinic-backend",
        "gitCommit": git_commit,
        "environment": settings.node_env,
        "timestamp": req_clock.now_utc.isoformat().replace("+00:00", "Z"),
        "clinicTimestamp": req_clock.now_clinic.isoformat(),
        "clinicDate": req_clock.today_clinic.isoformat(),
        "clinicTimezone": req_clock.clinic_timezone,
    }


@router.get("/api/clock")
async def server_clock(request: Request):
    """Authoritative server clock snapshot for frontend synchronization."""
    req_clock = get_request_clock(request)
    return {
        "utc": req_clock.now_utc.isoformat().replace("+00:00", "Z"),
        "clinicNow": req_clock.now_clinic.isoformat(),
        "clinicDate": req_clock.today_clinic.isoformat(),
        "clinicWeekday": req_clock.now_clinic.strftime("%A"),
        "timezone": req_clock.clinic_timezone,
    }


@router.get("/ready")
@router.get("/api/ready")
@router.get("/api/health/ready")
async def readiness():
    try:
        async with asyncio.timeout(7):
            async with engine.connect() as database:
                await database.execute(text('SELECT 1 FROM "User" LIMIT 1'))
        return {"status": "ready", "database": "connected", "service": "quick-clinic-backend"}
    except Exception:
        return JSONResponse(
            {"status": "unready", "database": "disconnected", "error": "DATABASE_UNAVAILABLE"},
            status_code=503,
        )
