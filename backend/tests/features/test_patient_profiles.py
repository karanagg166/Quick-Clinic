"""Patient onboarding, medical privacy, clinical search and statistics contracts."""

from datetime import timedelta

import pytest
from sqlalchemy import delete, insert, select

from app.core.security import issue_token
from app.infrastructure.database import new_id, tables, utcnow


def auth(user):
    return {"Authorization": "Bearer " + issue_token(user)}


async def appointment(db, doctor, patient, status="CONFIRMED", *, days=1, offset=0):
    slot_id, appointment_id = new_id(), new_id()
    start = utcnow() + timedelta(days=days, minutes=offset)
    await db.execute(
        insert(tables["Slot"]).values(
            id=slot_id,
            doctorId=doctor["doctorId"],
            date=start.date(),
            startTime=start,
            endTime=start + timedelta(minutes=30),
        )
    )
    await db.execute(
        insert(tables["Appointment"]).values(
            id=appointment_id,
            doctorId=doctor["doctorId"],
            patientId=patient["patientId"],
            slotId=slot_id,
            status=status,
            notes="Appointment context",
        )
    )
    return appointment_id


@pytest.mark.parametrize("actor_role", ["PATIENT", "ADMIN"])
async def test_patient_onboarding_creates_only_requested_medical_profile(client, db, seed_user, actor_role):
    patient = await seed_user()
    await db.execute(delete(tables["Patient"]).where(tables["Patient"].c.id == patient["patientId"]))
    actor = patient if actor_role == "PATIENT" else await seed_user("ADMIN")
    payload = {
        "userId": patient["id"],
        "medicalHistory": "Asthma",
        "allergies": "Peanuts",
        "currentMedications": "Inhaler",
    }
    response = await client.post("/api/patients", headers=auth(actor), json=payload)
    assert response.status_code == 201
    created = response.json()["patient"]
    assert all(created[key] == value for key, value in payload.items())
    assert (await client.post("/api/patients", headers=auth(actor), json=payload)).status_code == 409


@pytest.mark.parametrize("target", ["another-patient", "self-doctor", "missing"])
async def test_onboarding_rejects_impersonation_and_nonpatient_targets(client, db, seed_user, target):
    patient, doctor, admin = await seed_user(), await seed_user("DOCTOR"), await seed_user("ADMIN")
    actor = patient if target == "another-patient" else doctor if target == "self-doctor" else admin
    target_id = "missing" if target == "missing" else doctor["id"]
    response = await client.post("/api/patients", headers=auth(actor), json={"userId": target_id})
    assert response.status_code == (404 if target == "missing" else 403)
    assert (await db.execute(select(tables["Patient"].c.userId))).scalars().all() == [patient["id"]]


@pytest.mark.parametrize(
    "method,path_kind", [("patch", "resource"), ("put", "resource"), ("patch", "collection")]
)
async def test_medical_profile_updates_accept_both_resource_and_legacy_routes(
    client, db, seed_user, method, path_kind
):
    patient = await seed_user(
        profile={"medicalHistory": "Preserved", "allergies": "Old", "currentMedications": "Original"}
    )
    payload = {"allergies": "Updated", "userId": "attacker", "id": "attacker"}
    url = f"/api/patients/{patient['patientId']}"
    if path_kind == "collection":
        url = "/api/patients"
        payload["patientId"] = patient["patientId"]
    response = await client.request(method, url, headers=auth(patient), json=payload)
    assert response.status_code == 200
    result = response.json()["patient"]
    assert result["allergies"] == "Updated" and result["medicalHistory"] == "Preserved"
    assert result["currentMedications"] == "Original" and result["userId"] == patient["id"]
    assert result["id"] == patient["patientId"]


@pytest.mark.parametrize(
    "payload", [{"medicalHistory": None}, {"allergies": "x" * 20001}, {"currentMedications": 42}]
)
async def test_invalid_medical_fields_preserve_entire_previous_profile(client, db, seed_user, payload):
    user = await seed_user(profile={"medicalHistory": "Original"})
    response = await client.patch(
        f"/api/patients/{user['patientId']}",
        headers=auth(user),
        json={"medicalHistory": "Uncommitted", **payload},
    )
    assert response.status_code == 400
    assert (
        await db.execute(
            select(tables["Patient"].c.medicalHistory).where(tables["Patient"].c.id == user["patientId"])
        )
    ).scalar_one() == "Original"


@pytest.mark.parametrize(
    "status,allowed",
    [("PENDING", False), ("CONFIRMED", True), ("COMPLETED", True), ("CANCELLED", False), ("NO_SHOW", False)],
)
async def test_doctor_medical_read_requires_confirmed_or_completed_appointment(
    client, db, seed_user, status, allowed
):
    doctor, patient = await seed_user("DOCTOR"), await seed_user(profile={"medicalHistory": "Private"})
    await appointment(db, doctor, patient, status)
    response = await client.get(f"/api/patients/{patient['patientId']}", headers=auth(doctor))
    assert response.status_code == (200 if allowed else 403)
    if allowed:
        body = response.json()["patient"]
        assert body["medicalHistory"] == "Private"
        assert "password" not in body["user"] and "isActive" not in body["user"]
    assert (
        await client.patch(
            f"/api/patients/{patient['patientId']}", headers=auth(doctor), json={"medicalHistory": "Changed"}
        )
    ).status_code == 403
    assert (
        await client.get(f"/api/patients/{patient['patientId']}/stats", headers=auth(doctor))
    ).status_code == 403


async def test_patient_statistics_count_appointments_dates_and_assigned_doctors(client, db, seed_user):
    patient, doctor, other = await seed_user(), await seed_user("DOCTOR"), await seed_user()
    states = [("PENDING", 1), ("CONFIRMED", 1), ("PENDING", -1), ("COMPLETED", -2), ("CANCELLED", 2)]
    for index, (status, days) in enumerate(states):
        await appointment(db, doctor, patient, status, days=days, offset=index)
    await appointment(db, doctor, other, "COMPLETED", offset=20)
    await db.execute(
        insert(tables["DoctorPatientRelation"]).values(
            id=new_id(),
            doctorsUserId=doctor["id"],
            patientsUserId=patient["id"],
        )
    )
    response = await client.get(f"/api/patients/{patient['patientId']}/stats", headers=auth(patient))
    assert response.status_code == 200
    assert response.json() == {
        "upcomingAppointments": 2,
        "assignedDoctors": 1,
        "pendingApprovals": 2,
        "completedAppointments": 1,
        "wellnessScore": 10,
    }


async def test_empty_patient_statistics_and_admin_privilege(client, seed_user):
    patient, admin = await seed_user(), await seed_user("ADMIN")
    response = await client.get(f"/api/patients/{patient['patientId']}/stats", headers=auth(admin))
    assert response.status_code == 200 and all(value == 0 for value in response.json().values())
    assert (await client.get("/api/patients/missing", headers=auth(admin))).status_code == 404
    assert (await client.get("/api/patients/missing/stats", headers=auth(admin))).status_code == 404


@pytest.mark.parametrize("params", [{"scope": "all"}, {"all": "true"}, {"doctorId": "another-doctor"}])
async def test_doctor_patient_search_cannot_expand_own_scope(client, seed_user, params):
    doctor = await seed_user("DOCTOR")
    assert (await client.get("/api/patients", headers=auth(doctor), params=params)).status_code == 403


async def test_doctor_search_lists_eligible_patients_and_only_own_appointment_history(client, db, seed_user):
    doctor, other_doctor = await seed_user("DOCTOR"), await seed_user("DOCTOR")
    patient, pending = await seed_user(), await seed_user()
    own = await appointment(db, doctor, patient, "COMPLETED")
    await appointment(db, other_doctor, patient, "CONFIRMED")
    await appointment(db, doctor, pending, "PENDING", offset=3)
    response = await client.get("/api/patients", headers=auth(doctor))
    assert response.status_code == 200 and len(response.json()) == 1
    row = response.json()[0]
    assert row["id"] == patient["patientId"]
    assert [event["id"] for event in row["appointments"]] == [own]
    assert not {"password", "bankAccountNumber", "userId"}.intersection(row)


@pytest.mark.parametrize(
    "params,matched",
    [
        ({"name": "special"}, True),
        ({"medicalHistory": "asthma"}, True),
        ({"allergy": "peanut"}, True),
        ({"currentMedications": "inhaler"}, True),
        ({"city": "delhi", "state": "Delhi"}, True),
        ({"gender": "female", "age": "42"}, True),
        ({"minAge": "40", "maxAge": "45"}, True),
        ({"name": "absent"}, False),
        ({"minAge": "43"}, False),
        ({"gender": "MALE"}, False),
    ],
)
async def test_admin_patient_search_applies_text_demographic_and_location_filters(
    client, seed_user, params, matched
):
    admin = await seed_user("ADMIN")
    patient = await seed_user(
        name="Special Patient",
        age=42,
        gender="FEMALE",
        profile={"medicalHistory": "Asthma", "allergies": "Peanuts", "currentMedications": "Inhaler"},
    )
    response = await client.get("/api/patients", headers=auth(admin), params={"scope": "all", **params})
    assert response.status_code == 200
    assert [row["id"] for row in response.json()] == ([patient["patientId"]] if matched else [])


@pytest.mark.parametrize(
    "params", [{}, {"scope": "all", "age": "NaN"}, {"scope": "all", "minAge": "invalid"}]
)
async def test_admin_patient_search_rejects_missing_scope_or_invalid_filters(client, seed_user, params):
    admin = await seed_user("ADMIN")
    assert (await client.get("/api/patients", headers=auth(admin), params=params)).status_code == 400


async def test_patient_cannot_enumerate_clinical_directory_or_other_patient_statistics(client, seed_user):
    patient, other = await seed_user(), await seed_user()
    assert (await client.get("/api/patients?all=true", headers=auth(patient))).status_code == 403
    assert (
        await client.get(f"/api/patients/{other['patientId']}/stats", headers=auth(patient))
    ).status_code == 403
