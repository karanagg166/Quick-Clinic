
"""Read-only tools for the Quick-Clinic Doctor AI Agent."""

from datetime import date
from typing import Any

from langchain_core.tools import BaseTool, tool
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncConnection

from app.core.clock import resolve_clinic_date
from app.features.scheduling.doctor_agent_queries import (
    get_my_free_slots as fetch_free_slots,
    get_my_consultation_slots as fetch_consultation_slots,
)


class SlotDateInput(BaseModel):
    day: str | date = Field(
        default="today",
        description=(
            "Clinic calendar date in YYYY-MM-DD format or a relative expression "
            "such as 'today', 'tomorrow', or 'yesterday' (interpreted in Asia/Kolkata)."
        ),
    )


def build_doctor_tools(
    db: AsyncConnection,
    actor: dict[str, Any],
    reference_date: date | None = None,
) -> list[BaseTool]:
    """Create tools for the authenticated doctor request."""

    @tool(
        "get_my_consultation_slots",
        args_schema=SlotDateInput,
    )
    async def get_my_consultation_slots(
        day: str | date = "today",
    ) -> dict[str, Any]:
        """List my confirmed patient consultation slots.

        Use when the doctor asks about booked consultations,
        patient appointments, or their consultation timetable.
        """
        resolved_day = resolve_clinic_date(day, reference_date=reference_date)
        return await fetch_consultation_slots(
            db=db,
            actor=actor,
            day=resolved_day,
        )

    @tool(
        "get_my_free_slots",
        args_schema=SlotDateInput,
    )
    async def get_my_free_slots(
        day: str | date = "today",
    ) -> dict[str, Any]:
        """List my currently unbooked, available slots.

        Use when the doctor asks about free time,
        unbooked consultation windows, or available slots.
        These slots remain open for patient booking.
        """
        resolved_day = resolve_clinic_date(day, reference_date=reference_date)
        return await fetch_free_slots(
            db=db,
            actor=actor,
            day=resolved_day,
        )

    return [
        get_my_consultation_slots,
        get_my_free_slots,
    ]
