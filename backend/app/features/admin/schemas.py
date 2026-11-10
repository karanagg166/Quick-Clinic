"""Explicit request contracts for privileged account and financial actions."""

from typing import Literal

from pydantic import BaseModel, Field, StrictBool


class AdminOnboardingRequest(BaseModel):
    userId: str = Field(min_length=1, max_length=200)
    name: str | None = Field(default=None, min_length=1, max_length=200)
    phoneNo: str | None = Field(default=None, min_length=1, max_length=30)
    gender: Literal["MALE", "FEMALE", "BINARY"] | None = None
    age: int | None = Field(default=None, ge=0, le=150)
    managerEmail: str | None = Field(default=None, max_length=320)
    secretCode: str | None = Field(default=None, max_length=512)


class AdminUserUpdateRequest(BaseModel):
    isActive: StrictBool | None = None
    role: Literal["PATIENT", "DOCTOR", "ADMIN"] | None = None


class WithdrawalDecisionRequest(BaseModel):
    withdrawalId: str = Field(min_length=1, max_length=200)
    status: str = Field(min_length=1, max_length=20)
    failureReason: str | None = Field(default=None, max_length=1000)
