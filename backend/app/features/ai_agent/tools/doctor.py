
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

from app.features.doctors.agent_queries import (
    get_my_profile as fetch_profile,
    get_my_weekly_schedule as fetch_weekly_schedule,
    get_my_leaves as fetch_leaves,
    get_my_statistics as fetch_statistics,
    get_my_balance as fetch_balance,
    get_my_earnings_summary as fetch_earnings,
)
from .doctor_mutations import build_doctor_mutating_tools
from .doctor_reads import build_doctor_extended_read_tools


class SlotDateInput(BaseModel):
    day: str | date = Field(
        default="today",
        description=(
            "Clinic date in YYYY-MM-DD format or "
            "a relative date such as today, tomorrow, "
            "yesterday, or next Monday."
        ),
    )


class EarningsInput(BaseModel):
    start_day: str | None = Field(
        default=None,
        description=(
            "Optional start date in YYYY-MM-DD format "
            "or a supported relative date."
        ),
    )

    end_day: str | None = Field(
        default=None,
        description=(
            "Optional end date in YYYY-MM-DD format "
            "or a supported relative date."
        ),
    )


def build_doctor_tools(
    db: AsyncConnection,
    actor: dict[str, Any],
    reference_date: date | None = None,
    *,
    thread_id: str | None = None,
    turn_id: str | None = None,
    include_mutations: bool = False,
) -> list[BaseTool]:
    """Build tools using trusted authenticated request context."""

    @tool(
        "get_my_consultation_slots",
        args_schema=SlotDateInput,
    )
    async def get_my_consultation_slots(
        day: str | date = "today",
    ) -> dict[str, Any]:
        """Get my confirmed patient consultation slots for a date.

        Use for booked consultations, confirmed appointments,
        or when I am scheduled to see patients.
        """
        resolved_day = resolve_clinic_date(
            day,
            reference_date=reference_date,
        )

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
        """Get my currently unbooked appointment slots.

        Use to find free, available consultation windows.
        These slots remain open for patient booking.
        """
        resolved_day = resolve_clinic_date(
            day,
            reference_date=reference_date,
        )

        return await fetch_free_slots(
            db=db,
            actor=actor,
            day=resolved_day,
        )

    @tool("get_my_profile")
    async def get_my_profile() -> dict[str, Any]:
        """Read my own doctor profile.

        Use for specialty, qualifications, consultation fees,
        experience, ratings, and public profile information.
        """
        return await fetch_profile(
            db=db,
            actor=actor,
        )

    @tool("get_my_weekly_schedule")
    async def get_my_weekly_schedule() -> dict[str, Any]:
        """Read my configured weekly working schedule.

        Use when I ask about regular working days,
        clinic hours, or weekly consultation timings.
        """
        return await fetch_weekly_schedule(
            db=db,
            actor=actor,
        )

    @tool("get_my_leaves")
    async def get_my_leaves() -> dict[str, Any]:
        """Read my registered doctor leave periods.

        Use when I ask about scheduled leaves,
        time off, or upcoming leave dates.
        Does not create, update, or cancel leave.
        """
        return await fetch_leaves(
            db=db,
            actor=actor,
        )

    @tool("get_my_statistics")
    async def get_my_statistics() -> dict[str, Any]:
        """Read my existing doctor dashboard statistics.

        Use for patient counts, today's appointments,
        pending consultations, or dashboard metrics.
        """
        return await fetch_statistics(
            db=db,
            actor=actor,
        )

    @tool("get_my_balance")
    async def get_my_balance() -> dict[str, Any]:
        """Read my current clinic earnings balance.

        Use when I ask about my available earnings balance.
        Never initiate withdrawals or modify bank details.
        """
        return await fetch_balance(
            db=db,
            actor=actor,
        )

    @tool(
        "get_my_earnings_summary",
        args_schema=EarningsInput,
    )
    async def get_my_earnings_summary(
        start_day: str | None = None,
        end_day: str | None = None,
    ) -> dict[str, Any]:
        """Read my earnings summary for an optional date range.

        Use for total earnings, completed paid consultations,
        or earnings over a specified period.

        For requests such as 'this month', provide the
        corresponding start and end calendar dates.
        """
        resolved_start = (
            resolve_clinic_date(
                start_day,
                reference_date=reference_date,
            )
            if start_day
            else None
        )

        resolved_end = (
            resolve_clinic_date(
                end_day,
                reference_date=reference_date,
            )
            if end_day
            else None
        )

        return await fetch_earnings(
            db=db,
            actor=actor,
            start_day=resolved_start,
            end_day=resolved_end,
        )

    tools_list: list[BaseTool] = [
        get_my_consultation_slots,
        get_my_free_slots,
        get_my_profile,
        get_my_weekly_schedule,
        get_my_leaves,
        get_my_statistics,
        get_my_balance,
        get_my_earnings_summary,
        *build_doctor_extended_read_tools(
            db,
            actor,
            reference_date=reference_date,
            thread_id=thread_id,
            turn_id=turn_id,
        ),
    ]
    if include_mutations:
        tools_list.extend(build_doctor_mutating_tools())
    return tools_list
