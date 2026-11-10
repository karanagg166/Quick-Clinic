"""Validated account mutations with explicit writable fields."""

from typing import Literal

from pydantic import BaseModel, Field, model_validator


class ProfileUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    phoneNo: str | None = Field(default=None, min_length=1, max_length=30)
    address: str | None = Field(default=None, min_length=1, max_length=2000)
    age: int | None = Field(default=None, ge=0, le=150)
    gender: Literal["MALE", "FEMALE", "BINARY"] | None = None
    pinCode: int | None = Field(default=None, ge=100000, le=999999)
    city: str = Field(default="", max_length=200)
    state: str = Field(default="", max_length=200)


class BankDetailsRequest(BaseModel):
    bankAccountNumber: str = Field(min_length=9, max_length=20)
    bankIFSC: str = Field(min_length=11, max_length=15)
    bankAccountHolderName: str = Field(min_length=1, max_length=200)
    bankName: str = Field(min_length=1, max_length=200)


class AvatarUpdateRequest(BaseModel):
    avatarUrl: str | None = Field(default=None, max_length=2048)
    url: str | None = Field(default=None, max_length=2048)

    @model_validator(mode="after")
    def require_avatar_url(self):
        if not (self.avatarUrl or self.url):
            raise ValueError("An avatar URL is required")
        return self
