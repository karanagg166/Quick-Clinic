"""Mutating tool definitions for the Quick-Clinic Doctor AI Agent.

These tools are NEVER executed autonomously. LangGraph intercepts every call
to these tools, persists an AgentApproval proposal, and pauses via interrupt().
"""

from typing import Any, Literal

from langchain_core.tools import BaseTool, tool
from pydantic import BaseModel, Field


MUTATING_TOOL_ACTION_MAP: dict[str, str] = {
    "apply_leave": "APPLY_LEAVE",
    "update_leave": "UPDATE_LEAVE",
    "cancel_leave": "CANCEL_LEAVE",
    "update_weekly_schedule": "UPDATE_SCHEDULE",
    "create_slot": "CREATE_SLOT",
    "update_slot_availability": "UPDATE_SLOT",
    "remove_slot": "REMOVE_SLOT",
    "update_my_profile": "UPDATE_DOCTOR_PROFILE",
    "update_appointment_status": "UPDATE_APPOINTMENT",
    "send_patient_message": "SEND_PATIENT_MESSAGE",
}


class ApplyLeaveInput(BaseModel):
    start_date: str = Field(description="ISO start date/datetime in clinic timezone (YYYY-MM-DD).")
    end_date: str = Field(description="ISO end date/datetime in clinic timezone (YYYY-MM-DD).")
    reason: str = Field(min_length=2, max_length=300, description="Reason for leave.")


class UpdateLeaveInput(BaseModel):
    leave_id: str = Field(min_length=1, description="Existing leave ID.")
    start_date: str = Field(description="Updated ISO start date (YYYY-MM-DD).")
    end_date: str = Field(description="Updated ISO end date (YYYY-MM-DD).")
    reason: str = Field(min_length=2, max_length=300, description="Updated leave reason.")


class CancelLeaveInput(BaseModel):
    leave_id: str = Field(min_length=1, description="Leave ID to cancel.")


class UpdateScheduleInput(BaseModel):
    weekly_schedule: dict[str, Any] | list[Any] | None = Field(
        default=None,
        description="Weekly working schedule as an object mapping day names to slot intervals (e.g. {'Monday': [{'start': '09:00', 'end': '13:00'}]}) or an array of day objects ({'day': 'Monday', 'slots': [...]}).",
    )
    day: str | None = Field(
        default=None,
        description="Specific day name if updating a single day (e.g. 'Monday', 'Tuesday').",
    )
    slots: list[Any] | None = Field(
        default=None,
        description="List of slot intervals for single-day update (e.g. [{'start': '09:00', 'end': '13:00'}]).",
    )


class CreateSlotInput(BaseModel):
    date: str = Field(description="Clinic date YYYY-MM-DD.")
    start_time: str = Field(description="Start time HH:MM (24h).")
    end_time: str = Field(description="End time HH:MM (24h).")


class UpdateSlotInput(BaseModel):
    slot_id: str = Field(min_length=1, description="Target slot ID.")
    status: Literal["AVAILABLE", "UNAVAILABLE"] = Field(description="New slot availability.")


class RemoveSlotInput(BaseModel):
    slot_id: str = Field(min_length=1, description="Available slot ID to remove.")


class UpdateDoctorProfileInput(BaseModel):
    experience: int | None = Field(default=None, ge=0, le=80)
    fees: int | None = Field(default=None, ge=0, le=100000)
    doctor_bio: str | None = Field(default=None, max_length=1000)


class UpdateAppointmentInput(BaseModel):
    appointment_id: str = Field(min_length=1, description="Doctor appointment ID.")
    status: Literal["CONFIRMED", "COMPLETED", "CANCELLED", "NO_SHOW"] = Field(
        description="Target appointment status."
    )


class SendPatientMessageInput(BaseModel):
    patient_user_id: str = Field(min_length=1, description="Authorized patient user ID.")
    text: str = Field(min_length=1, max_length=2000, description="Message content.")


def _blocked(*args: Any, **kwargs: Any) -> dict[str, Any]:
    raise RuntimeError("Mutating tools require human approval and cannot run directly")


def build_doctor_mutating_tools() -> list[BaseTool]:
    """Return schema-validated mutating tool declarations for LLM binding."""

    @tool("apply_leave", args_schema=ApplyLeaveInput)
    async def apply_leave(start_date: str, end_date: str, reason: str) -> dict[str, Any]:
        """Request doctor leave for a date range. Requires human approval."""
        return _blocked()

    @tool("update_leave", args_schema=UpdateLeaveInput)
    async def update_leave(leave_id: str, start_date: str, end_date: str, reason: str) -> dict[str, Any]:
        """Modify an existing doctor leave period. Requires human approval."""
        return _blocked()

    @tool("cancel_leave", args_schema=CancelLeaveInput)
    async def cancel_leave(leave_id: str) -> dict[str, Any]:
        """Cancel an existing doctor leave period. Requires human approval."""
        return _blocked()

    @tool("update_weekly_schedule", args_schema=UpdateScheduleInput)
    async def update_weekly_schedule(
        weekly_schedule: dict[str, Any] | list[Any] | None = None,
        day: str | None = None,
        slots: list[Any] | None = None,
        **kwargs: Any,
    ) -> dict[str, Any]:
        """Update or configure the doctor's weekly working schedule. Requires human approval."""
        return _blocked()

    @tool("create_slot", args_schema=CreateSlotInput)
    async def create_slot(date: str, start_time: str, end_time: str) -> dict[str, Any]:
        """Create an ad-hoc consultation slot. Requires human approval."""
        return _blocked()

    @tool("update_slot_availability", args_schema=UpdateSlotInput)
    async def update_slot_availability(slot_id: str, status: str) -> dict[str, Any]:
        """Mark a slot AVAILABLE or UNAVAILABLE. Requires human approval."""
        return _blocked()

    @tool("remove_slot", args_schema=RemoveSlotInput)
    async def remove_slot(slot_id: str) -> dict[str, Any]:
        """Remove an unbooked available slot. Requires human approval."""
        return _blocked()

    @tool("update_my_profile", args_schema=UpdateDoctorProfileInput)
    async def update_my_profile(
        experience: int | None = None,
        fees: int | None = None,
        doctor_bio: str | None = None,
    ) -> dict[str, Any]:
        """Update doctor profile fields (experience, fees, bio). Requires human approval."""
        return _blocked()

    @tool("update_appointment_status", args_schema=UpdateAppointmentInput)
    async def update_appointment_status(appointment_id: str, status: str) -> dict[str, Any]:
        """Update an appointment status (CONFIRMED, COMPLETED, CANCELLED, NO_SHOW). Requires human approval."""
        return _blocked()

    @tool("send_patient_message", args_schema=SendPatientMessageInput)
    async def send_patient_message(patient_user_id: str, text: str) -> dict[str, Any]:
        """Send a message to an authorized patient. Requires human approval."""
        return _blocked()

    return [
        apply_leave,
        update_leave,
        cancel_leave,
        update_weekly_schedule,
        create_slot,
        update_slot_availability,
        remove_slot,
        update_my_profile,
        update_appointment_status,
        send_patient_message,
    ]
