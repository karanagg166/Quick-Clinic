"""Migration contracts for discovery, clinical availability and doctor finances."""

from datetime import timedelta
import pytest
from fastapi import HTTPException
from sqlalchemy import insert, select, update
from app.infrastructure.database import tables, new_id, utcnow
from app.core.security import issue_token
from app.features.doctors.service import profile_values
from app.features.scheduling.service import validate_schedule, local_time, daily_slots, day_metrics


def test_weekly_schedule_rejects_overlaps_and_duplicate_days():
    for schedule in (
        [
            {
                "day": "Monday",
                "slots": [{"start": "09:00", "end": "10:00"}, {"start": "09:30", "end": "11:00"}],
            }
        ],
        [{"day": "Monday", "slots": []}, {"day": "monday", "slots": []}],
        [{"day": "Blursday", "slots": []}],
    ):
        with pytest.raises(HTTPException):
            validate_schedule(schedule)
    assert validate_schedule(
        [{"day": "Monday", "slots": [{"start": "09:00", "end": "10:00"}, {"start": "10:00", "end": "11:00"}]}]
    )


def test_clinic_local_time_is_converted_to_utc_without_machine_timezone():
    assert local_time("2030-01-07", "09:00").isoformat() == "2030-01-07T03:30:00"
    with pytest.raises(HTTPException):
        local_time("2030-01-07", "25:00")


def test_profile_values_rejects_invalid_financial_and_location_values():
    for body in (
        {"fees": -1},
        {"fees": True},
        {"experience": "2"},
        {"latitude": 91, "longitude": 0},
        {"latitude": 10},
        {"specialty": "HACK"},
        {"qualifications": ["HACK"]},
    ):
        with pytest.raises(HTTPException):
            profile_values(body)


async def test_public_discovery_filters_hidden_fixture_and_never_leaks_credentials(client, seed_user):
    doctor = await seed_user("DOCTOR", profile={"specialty": "CARDIOLOGIST", "fees": 700})
    await seed_user("DOCTOR", profile={"isReleaseFixture": True})
    response = await client.get("/api/doctors?specialty=CARDIOLOGIST&maxFees=800")
    assert response.status_code == 200
    assert [row["id"] for row in response.json()] == [doctor["doctorId"]]
    assert "password" not in response.text
    assert "email" not in response.json()[0]
    assert (await client.get("/api/doctors?lat=nan&lng=0")).status_code == 400


async def test_doctor_ownership_and_withdrawal_paise_conversion(client, seed_user, db):
    doctor = await seed_user("DOCTOR", profile={"balance": 20000})
    other = await seed_user("DOCTOR")
    bank = tables["BankAccount"]
    await db.execute(
        insert(bank).values(
            id=new_id(),
            userId=doctor["id"],
            bankAccountNumber="1234567890",
            bankIFSC="ABCD0123456",
            bankAccountHolderName="Doctor",
            bankName="Bank",
        )
    )
    url = f"/api/doctors/{doctor['doctorId']}/withdrawals"
    response = await client.post(
        url, json={"amount": 100}, headers={"Authorization": f"Bearer {issue_token(other)}"}
    )
    assert response.status_code == 403
    response = await client.post(
        url, json={"amount": 100}, headers={"Authorization": f"Bearer {issue_token(doctor)}"}
    )
    assert response.status_code == 201
    assert response.json()["withdrawal"]["amount"] == 10000
    assert response.json()["withdrawal"]["bankAccountNumber"] == "********7890"
    balance = (
        await db.execute(
            select(tables["Doctor"].c.balance).where(tables["Doctor"].c.id == doctor["doctorId"])
        )
    ).scalar()
    assert balance == 10000
    assert (
        await client.post(
            url, json={"amount": 200}, headers={"Authorization": f"Bearer {issue_token(doctor)}"}
        )
    ).status_code == 400


async def test_generated_slots_use_clinic_timezone_and_hide_hold_identity(db, seed_user):
    doctor = await seed_user("DOCTOR")
    schedule = tables["Schedule"]
    await db.execute(
        insert(schedule).values(
            id=new_id(),
            doctorId=doctor["doctorId"],
            weeklySchedule=[{"day": "Monday", "slots": [{"start": "09:00", "end": "09:20"}]}],
        )
    )
    from datetime import date

    rows, generated = await daily_slots(db, doctor["doctorId"], date(2030, 1, 7))
    assert generated and len(rows) == 2
    assert rows[0]["startTime"].hour == 3
    assert rows[0]["startTime"].minute == 30
    assert rows[0]["heldByPatientId"] is None
    await db.execute(
        update(tables["Slot"])
        .where(tables["Slot"].c.id == rows[0]["id"])
        .values(
            status="HELD",
            heldByPatientId="private-patient",
            holdToken="secret",
            holdExpiresAt=utcnow() - timedelta(seconds=1),
        )
    )
    rows, generated = await daily_slots(db, doctor["doctorId"], date(2030, 1, 7))
    assert not generated
    assert rows[0]["status"] == "AVAILABLE"
    assert "holdToken" not in rows[0]
    assert day_metrics(rows)["availableCount"] == 2


async def test_patient_cannot_modify_doctor_schedule(client, seed_user):
    patient = await seed_user()
    doctor = await seed_user("DOCTOR")
    response = await client.post(
        f"/api/doctors/{doctor['doctorId']}/schedule",
        json={"weeklySchedule": []},
        headers={"Authorization": f"Bearer {issue_token(patient)}"},
    )
    assert response.status_code == 403


async def test_driving_route_matrix_uses_provider_and_falls_back_per_destination(monkeypatch):
    import httpx
    import app.features.doctors.routing as module
    from app.core.config import get_settings

    monkeypatch.setattr(get_settings(), "openrouteservice_api_key", "isolated-routing-key")
    original_client = httpx.AsyncClient
    requests = []

    def response(request):
        requests.append(request)
        return httpx.Response(200, json={"distances": [[12500, None]], "durations": [[1800, None]]})

    monkeypatch.setattr(
        module.httpx,
        "AsyncClient",
        lambda **kwargs: original_client(transport=httpx.MockTransport(response), **kwargs),
    )
    metrics = await module.route_metrics(
        28.6,
        77.2,
        [
            {"id": "first", "latitude": 28.7, "longitude": 77.3},
            {"id": "second", "latitude": 28.8, "longitude": 77.4},
        ],
    )
    assert metrics == {"first": {"distanceKm": 12.5, "durationMinutes": 30}}
    assert requests[0].url.path == "/v2/matrix/driving-car"
    assert requests[0].headers["Authorization"] == "isolated-routing-key"
