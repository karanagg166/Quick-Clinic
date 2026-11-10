"""Reservation and appointment features through the real FastAPI routes."""

from datetime import timedelta
from uuid import uuid4

import pytest
from sqlalchemy import insert, select, update

from app.core.security import issue_token
from app.infrastructure.database import tables, utcnow


def auth(user):
    return {"authorization": f"Bearer {issue_token(user)}"}


@pytest.fixture
async def scenario(db, seed_user):
    doctor = await seed_user("DOCTOR", name="Doctor A")
    patient = await seed_user(name="Patient A")
    outsider = await seed_user(name="Patient B")
    start = utcnow() + timedelta(days=2)
    slot = dict(
        id="booking-http-slot",
        doctorId=doctor["doctorId"],
        date=start.date(),
        startTime=start,
        endTime=start + timedelta(minutes=30),
        status="AVAILABLE",
    )
    await db.execute(insert(tables["Slot"]).values(**slot))
    return doctor, patient, outsider, slot


async def book(client, doctor, patient, slot):
    hold = await client.post(
        "/api/appointments/hold",
        headers=auth(patient),
        json={"slotId": slot["id"], "doctorId": doctor["doctorId"]},
    )
    assert hold.status_code == 201
    response = await client.post(
        "/api/appointments/confirm",
        headers=auth(patient),
        json={
            "slotId": slot["id"],
            "doctorId": doctor["doctorId"],
            "holdToken": hold.json()["holdToken"],
            "paymentMethod": "OFFLINE",
        },
    )
    assert response.status_code == 201
    return response.json()["appointment"]


async def test_hold_can_be_released_and_all_lease_fields_are_cleared(client, db, scenario):
    doctor, patient, _, slot = scenario
    held = await client.post(
        "/api/appointments/hold",
        headers=auth(patient),
        json={"slotId": slot["id"], "doctorId": doctor["doctorId"]},
    )
    assert held.status_code == 201
    token = held.json()["holdToken"]
    released = await client.post(
        "/api/appointments/cancel-hold",
        headers=auth(patient),
        json={"slotId": slot["id"], "holdToken": token},
    )
    assert released.status_code == 200 and released.json() == {"released": True}
    row = (await db.execute(select(tables["Slot"]))).mappings().one()
    assert row["status"] == "AVAILABLE"
    assert all(row[key] is None for key in ("heldByPatientId", "heldAt", "holdToken", "holdExpiresAt"))
    replay = await client.post(
        "/api/appointments/cancel-hold",
        headers=auth(patient),
        json={"slotId": slot["id"], "holdToken": token},
    )
    assert replay.status_code == 409


@pytest.mark.parametrize("state", ["BOOKED", "UNAVAILABLE", "CANCELLED", "ON_LEAVE"])
async def test_nonavailable_slot_cannot_be_held(client, db, scenario, state):
    doctor, patient, _, slot = scenario
    await db.execute(update(tables["Slot"]).values(status=state))
    response = await client.post(
        "/api/appointments/hold",
        headers=auth(patient),
        json={"slotId": slot["id"], "doctorId": doctor["doctorId"]},
    )
    assert response.status_code == 409
    assert (await db.execute(select(tables["Slot"].c.status))).scalar_one() == state


async def test_past_slot_and_hidden_release_fixture_cannot_be_reserved(client, db, scenario):
    doctor, patient, _, slot = scenario
    await db.execute(update(tables["Slot"]).values(startTime=utcnow() - timedelta(seconds=1)))
    payload = {"slotId": slot["id"], "doctorId": doctor["doctorId"]}
    assert (
        await client.post("/api/appointments/hold", headers=auth(patient), json=payload)
    ).status_code == 409
    await db.execute(update(tables["Slot"]).values(startTime=slot["startTime"]))
    await db.execute(update(tables["Doctor"]).values(isReleaseFixture=True))
    assert (
        await client.post("/api/appointments/hold", headers=auth(patient), json=payload)
    ).status_code == 409


async def test_patient_cannot_confirm_someone_elses_reservation(client, db, scenario):
    doctor, patient, outsider, slot = scenario
    held = await client.post(
        "/api/appointments/hold",
        headers=auth(patient),
        json={"slotId": slot["id"], "doctorId": doctor["doctorId"]},
    )
    response = await client.post(
        "/api/appointments/confirm",
        headers=auth(outsider),
        json={
            "slotId": slot["id"],
            "doctorId": doctor["doctorId"],
            "holdToken": held.json()["holdToken"],
            "paymentMethod": "OFFLINE",
        },
    )
    assert response.status_code == 409
    assert not (await db.execute(select(tables["Appointment"]))).all()


async def test_online_confirmation_requires_transaction_id_before_provider_lookup(client, scenario):
    doctor, patient, _, slot = scenario
    response = await client.post(
        "/api/appointments/confirm",
        headers=auth(patient),
        json={
            "slotId": slot["id"],
            "doctorId": doctor["doctorId"],
            "holdToken": str(uuid4()),
            "paymentMethod": "ONLINE",
        },
    )
    assert response.status_code == 400


@pytest.mark.parametrize(
    "endpoint,payload",
    [
        ("hold", {"slotId": "", "doctorId": "doctor"}),
        ("hold", {"slotId": "slot"}),
        ("cancel-hold", {"slotId": "slot", "holdToken": "invalid"}),
        (
            "confirm",
            {"slotId": "slot", "doctorId": "doctor", "holdToken": str(uuid4()), "paymentMethod": "CASH"},
        ),
    ],
)
async def test_reservation_validation_returns_400_without_writes(client, db, seed_user, endpoint, payload):
    patient = await seed_user()
    response = await client.post(f"/api/appointments/{endpoint}", headers=auth(patient), json=payload)
    assert response.status_code == 400
    assert not (await db.execute(select(tables["Appointment"]))).all()


async def test_participants_can_read_detail_without_password_or_doctor_balance(client, scenario):
    doctor, patient, _, slot = scenario
    appointment = await book(client, doctor, patient, slot)
    for user, route, owner in (
        (doctor, "doctors", doctor["doctorId"]),
        (patient, "patients", patient["patientId"]),
    ):
        response = await client.get(
            f"/api/{route}/{owner}/appointments/{appointment['id']}", headers=auth(user)
        )
        assert response.status_code == 200
        data = response.json()
        assert data["slot"]["id"] == slot["id"]
        assert data["doctor"]["user"]["city"] == "Delhi"
        assert "password" not in data["doctor"]["user"]
        assert "password" not in data["patient"]["user"]
        assert "balance" not in data["doctor"]


async def test_appointment_lists_are_owner_scoped_and_filterable(client, scenario):
    doctor, patient, outsider, slot = scenario
    appointment = await book(client, doctor, patient, slot)
    routes = [
        (
            doctor,
            f"/api/doctors/{doctor['doctorId']}/appointments",
            {"patientName": "Patient A", "age": "30"},
        ),
        (
            patient,
            f"/api/patients/{patient['patientId']}/appointments",
            {"doctorName": "Doctor A", "fees": "500"},
        ),
    ]
    for user, path, filters in routes:
        response = await client.get(
            path, headers=auth(user), params={**filters, "status": "CONFIRMED", "date": str(slot["date"])}
        )
        assert response.status_code == 200
        assert [row["id"] for row in response.json()] == [appointment["id"]]
        assert (await client.get(path, headers=auth(user), params={"status": "CANCELLED"})).json() == []
    response = await client.get(f"/api/patients/{outsider['patientId']}/appointments", headers=auth(outsider))
    assert response.json() == []


@pytest.mark.parametrize(
    "role,param,value",
    [
        ("doctor", "age", "not-a-number"),
        ("patient", "fees", "not-a-number"),
        ("patient", "date", "bad-date"),
        ("doctor", "startDate", "2026-99-99"),
        ("patient", "endDate", "2026-99-99"),
    ],
)
async def test_invalid_appointment_filters_fail_as_client_errors(client, scenario, role, param, value):
    doctor, patient, _, slot = scenario
    await book(client, doctor, patient, slot)
    user = doctor if role == "doctor" else patient
    route = "doctors" if role == "doctor" else "patients"
    owner = user[f"{role}Id"]
    response = await client.get(
        f"/api/{route}/{owner}/appointments", headers=auth(user), params={param: value}
    )
    assert response.status_code == 400


async def test_outsider_cannot_read_or_cancel_another_patients_appointment(client, scenario):
    doctor, patient, outsider, slot = scenario
    appointment = await book(client, doctor, patient, slot)
    path = f"/api/patients/{patient['patientId']}/appointments/{appointment['id']}"
    assert (await client.get(path, headers=auth(outsider))).status_code == 403
    assert (await client.patch(path, headers=auth(outsider))).status_code == 403
    assert (
        await client.get(f"/api/patients/{patient['patientId']}/appointments", headers=auth(outsider))
    ).status_code == 403


async def test_read_access_does_not_grant_cross_role_status_write(client, scenario):
    doctor, patient, _, slot = scenario
    appointment = await book(client, doctor, patient, slot)
    path = f"/api/doctors/{doctor['doctorId']}/appointments/{appointment['id']}"
    assert (await client.get(path, headers=auth(patient))).status_code == 200
    assert (await client.patch(path, headers=auth(patient), json={"status": "COMPLETED"})).status_code == 403


@pytest.mark.parametrize(
    "payload,status",
    [({}, 400), ({"status": "CONFIRMED", "paymentMethod": "ONLINE"}, 400), ({"status": "UNKNOWN"}, 400)],
)
async def test_doctor_update_rejects_missing_status_or_payment_mutation(client, scenario, payload, status):
    doctor, patient, _, slot = scenario
    appointment = await book(client, doctor, patient, slot)
    response = await client.patch(
        f"/api/doctors/{doctor['doctorId']}/appointments/{appointment['id']}",
        headers=auth(doctor),
        json=payload,
    )
    assert response.status_code == status


async def test_offline_cancellation_is_idempotent_and_releases_slot(client, db, scenario):
    doctor, patient, _, slot = scenario
    appointment = await book(client, doctor, patient, slot)
    path = f"/api/patients/{patient['patientId']}/appointments/{appointment['id']}"
    first = await client.patch(path, headers=auth(patient))
    assert first.status_code == 200 and first.json()["refundStatus"] is None
    notices_before = len((await db.execute(select(tables["Notification"]))).all())
    assert (await client.patch(path, headers=auth(patient))).status_code == 200
    assert len((await db.execute(select(tables["Notification"]))).all()) == notices_before
    assert (await db.execute(select(tables["Slot"].c.status))).scalar_one() == "AVAILABLE"
    assert not (await db.execute(select(tables["Refund"]))).all()


@pytest.mark.parametrize("status", ["COMPLETED", "NO_SHOW"])
async def test_terminal_visit_status_prevents_patient_cancellation(client, db, scenario, status):
    doctor, patient, _, slot = scenario
    appointment = await book(client, doctor, patient, slot)
    response = await client.patch(
        f"/api/doctors/{doctor['doctorId']}/appointments/{appointment['id']}",
        headers=auth(doctor),
        json={"status": status},
    )
    assert response.status_code == 200
    assert (await db.execute(select(tables["Slot"].c.status))).scalar_one() == "UNAVAILABLE"
    response = await client.patch(
        f"/api/patients/{patient['patientId']}/appointments/{appointment['id']}", headers=auth(patient)
    )
    assert response.status_code == 400
    assert (await db.execute(select(tables["Doctor"].c.balance))).scalar_one() == 0


async def test_retired_direct_booking_route_has_actionable_migration_response(client, scenario):
    _, patient, _, _ = scenario
    response = await client.post(f"/api/patients/{patient['patientId']}/appointments", headers=auth(patient))
    assert response.status_code == 410
    assert "/api/appointments/hold" in response.json()["message"]
