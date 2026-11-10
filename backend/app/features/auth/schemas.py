"""Validated credential payloads; external field names retain the web contract."""

from typing import Literal

from pydantic import BaseModel, Field, field_validator


class SignupRequest(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    email: str = Field(min_length=3, max_length=320, pattern=r"^[^\s@]+@[^\s@]+$")
    phoneNo: str = Field(min_length=1, max_length=30)
    address: str = Field(min_length=1, max_length=2000)
    age: int = Field(ge=0, le=150)
    gender: Literal["MALE", "FEMALE", "BINARY"]
    role: str = Field(max_length=20)
    password: str = Field(min_length=6, max_length=72)
    pinCode: int = Field(ge=100000, le=999999)
    city: str = Field(default="", max_length=200)
    state: str = Field(default="", max_length=200)

    @field_validator("role")
    @classmethod
    def normalize_role(cls, value: str) -> str:
        return value.upper()


class LoginRequest(BaseModel):
    email: str = Field(min_length=1, max_length=320)
    # Existing bcryptjs accounts may have passwords longer than 72 bytes.
    password: str = Field(min_length=1, max_length=4096)


class PasswordChangeRequest(BaseModel):
    email: str | None = Field(default=None, max_length=320)
    userId: str | None = Field(default=None, max_length=200)
    currentPassword: str = Field(min_length=1, max_length=4096)
    newPassword: str = Field(min_length=6, max_length=72)


class PasswordResetRequest(BaseModel):
    email: str = Field(min_length=1, max_length=320)
    otp: str = Field(pattern=r"^\d{6}$")
    newPassword: str = Field(min_length=6, max_length=72)


class OtpVerificationRequest(BaseModel):
    otp: str = Field(pattern=r"^\d{6}$")
