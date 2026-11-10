"""Patient medical profile request contracts."""

from pydantic import BaseModel, Field


class MedicalProfileUpdate(BaseModel):
    medicalHistory: str | None = Field(default=None, max_length=20000)
    allergies: str | None = Field(default=None, max_length=20000)
    currentMedications: str | None = Field(default=None, max_length=20000)


class PatientCreateRequest(BaseModel):
    userId: str = Field(min_length=1, max_length=200)
    medicalHistory: str = Field(default="", max_length=20000)
    allergies: str = Field(default="", max_length=20000)
    currentMedications: str = Field(default="", max_length=20000)


class PatientUpdateRequest(MedicalProfileUpdate):
    patientId: str = Field(min_length=1, max_length=200)
