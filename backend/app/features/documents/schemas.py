"""Validated metadata and filters for patient-owned medical documents."""

from datetime import datetime
from enum import StrEnum
from pydantic import BaseModel, ConfigDict, Field, field_validator


class DocumentType(StrEnum):
    LAB_REPORT = "LAB_REPORT"
    PRESCRIPTION = "PRESCRIPTION"
    RADIOLOGY_SCAN = "RADIOLOGY_SCAN"
    DISCHARGE_SUMMARY = "DISCHARGE_SUMMARY"
    MEDICAL_CERTIFICATE = "MEDICAL_CERTIFICATE"
    VACCINATION_RECORD = "VACCINATION_RECORD"
    OTHER = "OTHER"


class DocumentUpload(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    title: str = Field(min_length=1, max_length=200)
    type: DocumentType
    reportDate: datetime
    hospitalOrDoctor: str = Field(default="", max_length=300)
    notes: str = Field(default="", max_length=5000)

    @field_validator("reportDate")
    @classmethod
    def utc_date(cls, value):
        from datetime import UTC

        return value.astimezone(UTC).replace(tzinfo=None) if value.tzinfo else value


class DocumentRename(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    title: str = Field(min_length=1, max_length=200)


class DocumentFilters(BaseModel):
    search: str = Field(default="", max_length=200)
    type: str | None = None
    fileType: str | None = None
    reportDate: str | None = None
    sort: str = "newest"
