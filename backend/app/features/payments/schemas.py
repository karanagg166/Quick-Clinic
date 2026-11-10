"""Canonical checkout and compatibility request validation."""

from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field


class CheckoutInitiationRequest(BaseModel):
    action: Literal["INITIATE"]
    doctorId: str = Field(min_length=1)
    slotId: str = Field(min_length=1)
    paymentMethod: Literal["ONLINE", "OFFLINE"]
    idempotencyKey: str = Field(min_length=8, max_length=128)


class CheckoutVerificationRequest(BaseModel):
    action: Literal["VERIFY"]
    checkoutId: str | None = None
    orderId: str | None = None
    paymentId: str = Field(min_length=1)
    signature: str = Field(pattern=r"^[a-fA-F0-9]{64}$")


class LegacyOrderRequest(BaseModel):
    doctorId: str = Field(min_length=1)
    slotId: str = Field(min_length=1)
    holdToken: UUID
    idempotencyKey: str | None = Field(default=None, min_length=8, max_length=128)


class LegacyPaymentVerificationRequest(BaseModel):
    orderId: str = Field(min_length=1)
    paymentId: str = Field(min_length=1)
    signature: str = Field(pattern=r"^[a-fA-F0-9]{64}$")
