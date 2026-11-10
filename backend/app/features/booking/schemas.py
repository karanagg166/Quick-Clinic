"""Validated appointment and reservation request contracts."""

from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field


class SlotHoldRequest(BaseModel):
    slotId: str = Field(min_length=1)
    doctorId: str = Field(min_length=1)


class SlotHoldCancellationRequest(BaseModel):
    slotId: str = Field(min_length=1)
    holdToken: UUID


class AppointmentConfirmationRequest(SlotHoldRequest):
    holdToken: UUID
    paymentMethod: Literal["ONLINE", "OFFLINE"]
    transactionId: str | None = None


class AppointmentUpdateRequest(BaseModel):
    status: (
        Literal["PENDING", "CONFIRMED", "COMPLETED", "CANCELLED", "NO_SHOW", "RESCHEDULED", "EXPIRED"] | None
    ) = None
    paymentMethod: Literal["ONLINE", "OFFLINE"] | None = None
    isAppointmentOffline: bool | None = None
