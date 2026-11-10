"""Process liveness and bounded database readiness probes."""

import asyncio
from fastapi import APIRouter
from fastapi.responses import JSONResponse
from sqlalchemy import text
from app.core.config import get_settings
from app.infrastructure.database import engine, utcnow

router = APIRouter(tags=["health"])


@router.get("/health")
@router.get("/api/health")
async def liveness():
    settings = get_settings()
    return {
        "status": "ok",
        "service": "quick-clinic-backend",
        "gitCommit": settings.git_commit,
        "environment": settings.node_env,
        "timestamp": utcnow().isoformat() + "Z",
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
