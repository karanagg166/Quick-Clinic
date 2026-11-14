
"""Authorized backend queries for Doctor AI Agent tools."""

from datetime import date
from typing import Any

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncConnection

from app.core.clock import to_clinic_time
from app.infrastructure.database import tables

from app.features.doctors import service as doctor_service
from app.features.doctors.repository import owned_doctor
from app.features.scheduling import service as scheduling_service

from app.features.ai_agent.security.permissions import (
    require_permission,
)
from app.features.ai_agent.security.policies import (
    audit_agent_action,
)


MAX_RESULTS = 30


async def _resolve_owned_doctor(
    db: AsyncConnection,
    actor: dict[str, Any],
    permission: str,
) -> str:
    """Resolve the authenticated doctor's own profile."""

    require_permission(actor, permission)

    if actor["role"] != "DOCTOR":
        raise HTTPException(
            status_code=403,
            detail="Doctor access required",
        )

    doctor_table = tables["Doctor"]

    doctor_id = (
        await db.execute(
            select(doctor_table.c.id).where(
                doctor_table.c.userId == actor["id"],
                doctor_table.c.isReleaseFixture.is_(False),
            )
        )
    ).scalar_one_or_none()

    if doctor_id is None:
        raise HTTPException(
            status_code=404,
            detail="Doctor profile not found",
        )

    await owned_doctor(db, doctor_id, actor)

    return doctor_id


async def get_my_profile(
    db: AsyncConnection,
    actor: dict[str, Any],
) -> dict[str, Any]:
    """Return the doctor's own public profile fields."""

    doctor_id = await _resolve_owned_doctor(
        db, actor, "get_doctor_profile"
    )

    result = await doctor_service.get_doctor_profile(
        doctor_id, actor, db
    )

    profile = result["doctor"]

    await audit_agent_action(
        db, actor["id"], "READ_DOCTOR_PROFILE",
        {"doctorId": doctor_id},
    )

    return {
        "name": profile.get("name"),
        "specialty": profile.get("specialty"),
        "experience": profile.get("experience"),
        "fees": profile.get("fees"),
        "city": profile.get("city"),
        "state": profile.get("state"),
        "qualifications": profile.get("qualifications"),
        "doctor_bio": profile.get("doctorBio"),
        "rating": result.get("rating"),
    }


async def get_my_weekly_schedule(
    db: AsyncConnection,
    actor: dict[str, Any],
) -> dict[str, Any]:
    """Return the doctor's configured weekly schedule."""

    doctor_id = await _resolve_owned_doctor(
        db, actor, "get_schedule"
    )

    schedule = await scheduling_service.get_schedule(
        doctor_id, db
    )

    await audit_agent_action(
        db, actor["id"], "READ_WEEKLY_SCHEDULE",
        {"doctorId": doctor_id},
    )

    return {
        "timezone": "Asia/Kolkata",
        "weekly_schedule": schedule.get("weeklySchedule"),
    }


async def get_my_leaves(
    db: AsyncConnection,
    actor: dict[str, Any],
) -> dict[str, Any]:
    """Return the doctor's registered leave periods."""

    doctor_id = await _resolve_owned_doctor(
        db, actor, "list_leaves"
    )

    result = await scheduling_service.list_leaves(
        doctor_id, {}, actor, db
    )

    leaves = result.get("leaves", [])

    await audit_agent_action(
        db, actor["id"], "READ_DOCTOR_LEAVES",
        {
            "doctorId": doctor_id,
            "count": len(leaves),
        },
    )

    return {
        "timezone": "Asia/Kolkata",
        "total_leaves": len(leaves),
        "truncated": len(leaves) > MAX_RESULTS,
        "leaves": [
            {
                "leave_id": leave["id"],
                "start_time": to_clinic_time(
                    leave["startDate"]
                ).isoformat(),
                "end_time": to_clinic_time(
                    leave["endDate"]
                ).isoformat(),
            }
            for leave in leaves[:MAX_RESULTS]
        ],
    }


async def get_my_statistics(
    db: AsyncConnection,
    actor: dict[str, Any],
) -> dict[str, Any]:
    """Return the doctor's existing dashboard statistics."""

    doctor_id = await _resolve_owned_doctor(
        db, actor, "get_doctor_statistics"
    )

    result = await doctor_service.get_doctor_statistics(
        doctor_id, actor, db
    )

    await audit_agent_action(
        db, actor["id"], "READ_DOCTOR_STATISTICS",
        {"doctorId": doctor_id},
    )

    return result


async def get_my_balance(
    db: AsyncConnection,
    actor: dict[str, Any],
) -> dict[str, Any]:
    """Return the doctor's balance without bank details."""

    doctor_id = await _resolve_owned_doctor(
        db, actor, "get_balance"
    )

    result = await doctor_service.get_balance(
        doctor_id, actor, db
    )

    await audit_agent_action(
        db, actor["id"], "READ_DOCTOR_BALANCE",
        {"doctorId": doctor_id},
    )

    return {
        "currency": "INR",
        "balance_rupees": result["balanceInRupees"],
    }


async def get_my_earnings_summary(
    db: AsyncConnection,
    actor: dict[str, Any],
    start_day: date | None = None,
    end_day: date | None = None,
) -> dict[str, Any]:
    """Return an earnings summary without patient details."""

    doctor_id = await _resolve_owned_doctor(
        db, actor, "list_earnings"
    )

    if start_day and end_day and start_day > end_day:
        raise HTTPException(
            status_code=400,
            detail="Start date must not exceed end date",
        )

    filters = {}

    if start_day:
        filters["startDate"] = start_day.isoformat()

    if end_day:
        filters["endDate"] = end_day.isoformat()

    result = await doctor_service.list_earnings(
        doctor_id, filters, actor, db
    )

    await audit_agent_action(
        db, actor["id"], "READ_DOCTOR_EARNINGS",
        {
            "doctorId": doctor_id,
            "count": result["count"],
        },
    )

    return {
        "currency": "INR",
        "start_date": (
            start_day.isoformat() if start_day else None
        ),
        "end_date": (
            end_day.isoformat() if end_day else None
        ),
        "total_earnings_rupees": result["total"],
        "completed_consultations": result["count"],
    }
