"""Validation shared by doctor creation and profile updates."""

import math
from fastapi import HTTPException

SPECIALTIES = "CARDIOLOGIST DERMATOLOGIST PEDIATRICIAN NEUROLOGIST NEPHROLOGIST GASTROENTEROLOGIST ENDOCRINOLOGIST PULMONOLOGIST ONCOLOGIST ORTHOPEDIC OPHTHALMOLOGIST OTOLARYNGOLOGIST UROLOGIST RHEUMATOLOGIST PSYCHIATRIST PSYCHOLOGIST GENERAL_PHYSICIAN GENERAL_SURGEON RADIOLOGIST PATHOLOGIST HEMATOLOGIST DENTIST GYNECOLOGIST OBSTETRICIAN PLASTIC_SURGEON VASCULAR_SURGEON CARDIOTHORACIC_SURGEON DERMATOSURGEON INFECTIOUS_DISEASE_SPECIALIST IMMUNOLOGIST ANESTHESIOLOGIST EMERGENCY_MEDICINE SPORTS_MEDICINE PAIN_MEDICINE CRITICAL_CARE PHYSIOTHERAPIST NUTRITIONIST".split()
QUALIFICATIONS = "MBBS BDS BPT BHMS BAMS MD MS DNB MDS DM MCH MPH MBA_HM PHD DO FELLOWSHIP PGD".split()


def profile_values(body):
    values = {}
    if "specialty" in body:
        if body["specialty"] not in SPECIALTIES:
            raise HTTPException(400, "Invalid specialty")
        values["specialty"] = body["specialty"]
    for key in ("fees", "experience"):
        if key in body:
            if isinstance(body[key], bool) or not isinstance(body[key], int) or body[key] < 0:
                raise HTTPException(400, f"{key} must be a nonnegative integer")
            values[key] = body[key]
    if "doctorBio" in body:
        if body["doctorBio"] is not None and (not isinstance(body["doctorBio"], str)):
            raise HTTPException(400, "Invalid doctorBio")
        values["doctorBio"] = body["doctorBio"]
    if "latitude" in body or "longitude" in body:
        for key, maximum in (("latitude", 90), ("longitude", 180)):
            value = body.get(key)
            if (
                isinstance(value, bool)
                or not isinstance(value, (int, float))
                or (not math.isfinite(value))
                or (not -maximum <= value <= maximum)
            ):
                raise HTTPException(400, "Valid latitude and longitude are required")
            values[key] = value
    if "qualifications" in body and (
        not isinstance(body["qualifications"], list)
        or any((q not in QUALIFICATIONS for q in body["qualifications"]))
    ):
        raise HTTPException(400, "Invalid qualifications")
    return values
