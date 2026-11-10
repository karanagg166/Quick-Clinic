"""Doctor discovery, ownership, verified reviews and financial read workflows."""

from datetime import datetime, timedelta

import pytest
from sqlalchemy import insert, select

from app.core.security import issue_token
from app.infrastructure.database import new_id, tables


def auth(user):
    return {"Authorization": f"Bearer {issue_token(user)}"}


async def appointment(db, doctor, patient, status="COMPLETED", start=None):
    start = start or datetime(2030, 1, 7, 3, 30)
    slot_id = new_id()
    await db.execute(
        insert(tables["Slot"]).values(
            id=slot_id,
            doctorId=doctor["doctorId"],
            date=start.date(),
            startTime=start,
            endTime=start + timedelta(minutes=10),
        )
    )
    identifier = new_id()
    await db.execute(
        insert(tables["Appointment"]).values(
            id=identifier,
            doctorId=doctor["doctorId"],
            patientId=patient["patientId"],
            slotId=slot_id,
            status=status,
        )
    )
    return identifier


@pytest.mark.parametrize(
    "query",
    [
        "maxFees=abc",
        "minFees=1.5",
        "age=old",
        "minExperience=x",
        "maxExperience=x",
        "lat=91&lng=0",
        "lat=0&lng=181",
        "lat=0",
        "lng=0",
    ],
)
async def test_discovery_invalid_numeric_and_coordinate_filters_are_client_errors(client, query):
    result = await client.get("/api/doctors?" + query)
    assert result.status_code == 400


async def test_discovery_combines_filters_escapes_sql_wildcards_and_hides_inactive_users(client, seed_user):
    expected = await seed_user(
        "DOCTOR",
        name="Doctor 100%_Match",
        gender="FEMALE",
        age=40,
        profile={"fees": 700, "experience": 12, "specialty": "CARDIOLOGIST"},
    )
    await seed_user(
        "DOCTOR",
        name="Doctor 100XXMatch",
        gender="FEMALE",
        age=40,
        profile={"fees": 700, "experience": 12, "specialty": "CARDIOLOGIST"},
    )
    await seed_user(
        "DOCTOR",
        name="Doctor 100%_Match",
        isActive=False,
        profile={"fees": 700, "experience": 12, "specialty": "CARDIOLOGIST"},
    )
    response = await client.get(
        "/api/doctors",
        params=dict(
            name="100%_",
            city="delhi",
            state="DELHI",
            gender="female",
            age="40",
            minFees="600",
            maxFees="800",
            minExperience="10",
            maxExperience="15",
            specialization="CARDIOLOGIST",
        ),
    )
    assert response.status_code == 200
    assert [row["id"] for row in response.json()] == [expected["doctorId"]]


async def test_discovery_uses_route_results_and_falls_back_for_missing_routes(client, seed_user, monkeypatch):
    first = await seed_user("DOCTOR", profile={"latitude": 28.6, "longitude": 77.2})
    second = await seed_user("DOCTOR", profile={"latitude": 28.8, "longitude": 77.4})
    missing = await seed_user("DOCTOR")
    from app.features.doctors import discovery

    async def metrics(lat, lng, doctors):
        assert (lat, lng) == (28.6, 77.2)
        assert len(doctors) == 3
        return {first["doctorId"]: {"distanceKm": 2.4, "durationMinutes": 8}}

    monkeypatch.setattr(discovery, "route_metrics", metrics)
    response = await client.get("/api/doctors?lat=28.6&lng=77.2")
    payload = response.json()
    assert payload["distanceUnavailable"] is False
    assert [row["id"] for row in payload["doctors"]] == [
        first["doctorId"],
        second["doctorId"],
        missing["doctorId"],
    ]
    assert payload["doctors"][0]["durationMinutes"] == 8
    assert payload["doctors"][1]["distanceKm"] > 2.4
    assert "distanceKm" not in payload["doctors"][2]
    assert all("email" not in row and "password" not in row for row in payload["doctors"])


async def test_discovery_reports_distance_unavailable_when_no_coordinates(client, seed_user):
    await seed_user("DOCTOR")
    result = await client.get("/api/doctors?lat=0&lng=0")
    assert result.json()["distanceUnavailable"] is True


async def test_profile_owner_can_update_coordinates_and_replace_deduplicated_qualifications(
    client, db, seed_user
):
    doctor = await seed_user("DOCTOR")
    path = f"/api/doctors/{doctor['doctorId']}"
    response = await client.patch(
        path,
        headers=auth(doctor),
        json={
            "fees": 0,
            "experience": 0,
            "latitude": 0,
            "longitude": 0,
            "doctorBio": "Synthetic biography",
            "qualifications": ["MBBS", "MBBS", "MD"],
        },
    )
    assert response.status_code == 200, response.text
    assert response.json()["doctor"]["latitude"] == 0
    await client.patch(path, headers=auth(doctor), json={"qualifications": ["BDS"]})
    rows = (await db.execute(select(tables["DoctorQualification"].c.qualification))).scalars().all()
    assert rows == ["BDS"]


@pytest.mark.parametrize("role", ["PATIENT", "DOCTOR"])
async def test_profile_updates_reject_other_users(client, seed_user, role):
    doctor = await seed_user("DOCTOR")
    outsider = await seed_user(role)
    result = await client.patch(
        f"/api/doctors/{doctor['doctorId']}", headers=auth(outsider), json={"fees": 1}
    )
    assert result.status_code == 403


@pytest.mark.parametrize(
    "payload",
    [
        {"latitude": True, "longitude": 1},
        {"latitude": 1, "longitude": 181},
        {"doctorBio": {}},
        {"qualifications": "MBBS"},
        {"experience": -1},
        {"fees": 1.2},
    ],
)
async def test_profile_rejects_invalid_updates_without_mutating_doctor(client, db, seed_user, payload):
    doctor = await seed_user("DOCTOR")
    result = await client.patch(f"/api/doctors/{doctor['doctorId']}", headers=auth(doctor), json=payload)
    assert result.status_code == 400
    row = (
        (await db.execute(select(tables["Doctor"]).where(tables["Doctor"].c.id == doctor["doctorId"])))
        .mappings()
        .one()
    )
    assert row["fees"] == 500 and row["latitude"] is None


async def test_completed_patient_can_rate_update_rating_and_publish_trimmed_comment(client, db, seed_user):
    doctor, patient = await seed_user("DOCTOR"), await seed_user()
    await appointment(db, doctor, patient)
    root = f"/api/doctors/{doctor['doctorId']}"
    for rating in (5, 3):
        result = await client.post(root + "/rating", headers=auth(patient), json={"rating": rating})
        assert result.status_code == 200
    assert (await client.get(root + "/rating")).json() == {"average": 3.0, "count": 1}
    result = await client.post(
        root + "/comments", headers=auth(patient), json={"text": "  Synthetic feedback  "}
    )
    assert result.status_code == 201
    comments = (await client.get(root + "/comments")).json()["comments"]
    assert comments[0]["text"] == "Synthetic feedback"
    assert set(comments[0]["user"]) == {"id", "name", "profileImageUrl"}
    profile = (await client.get(root, headers=auth(patient))).json()
    assert profile["canReview"] is True and profile["userRating"] == 3


@pytest.mark.parametrize("status", ["PENDING", "CONFIRMED", "CANCELLED", "NO_SHOW"])
async def test_reviews_require_completed_consultation(client, db, seed_user, status):
    doctor, patient = await seed_user("DOCTOR"), await seed_user()
    await appointment(db, doctor, patient, status)
    root = f"/api/doctors/{doctor['doctorId']}"
    assert (await client.post(root + "/rating", headers=auth(patient), json={"rating": 5})).status_code == 403
    assert (
        await client.post(root + "/comments", headers=auth(patient), json={"text": "Feedback"})
    ).status_code == 403


@pytest.mark.parametrize("rating", [True, 0, 6, 3.5, "5", None])
async def test_rating_validates_integer_scale(client, db, seed_user, rating):
    doctor, patient = await seed_user("DOCTOR"), await seed_user()
    await appointment(db, doctor, patient)
    result = await client.post(
        f"/api/doctors/{doctor['doctorId']}/rating", headers=auth(patient), json={"rating": rating}
    )
    assert result.status_code == 400


@pytest.mark.parametrize("text", [" ", 1, None, "x" * 10001])
async def test_review_comments_validate_text(client, db, seed_user, text):
    doctor, patient = await seed_user("DOCTOR"), await seed_user()
    await appointment(db, doctor, patient)
    result = await client.post(
        f"/api/doctors/{doctor['doctorId']}/comments", headers=auth(patient), json={"text": text}
    )
    assert result.status_code == 400


async def test_review_cannot_spoof_a_different_patient(client, db, seed_user):
    doctor, patient, other = await seed_user("DOCTOR"), await seed_user(), await seed_user()
    await appointment(db, doctor, patient)
    result = await client.post(
        f"/api/doctors/{doctor['doctorId']}/rating",
        headers=auth(patient),
        json={"rating": 5, "patientId": other["patientId"]},
    )
    assert result.status_code == 403


async def test_earnings_only_include_completed_appointments_in_date_range(client, db, seed_user):
    doctor, patient = await seed_user("DOCTOR", profile={"balance": 12345, "fees": 700}), await seed_user()
    accepted = await appointment(db, doctor, patient, start=datetime(2030, 1, 7, 4))
    await appointment(db, doctor, patient, "CONFIRMED", datetime(2030, 1, 7, 5))
    await appointment(db, doctor, patient, start=datetime(2030, 1, 8, 4))
    root = f"/api/doctors/{doctor['doctorId']}"
    result = await client.get(
        root + "/earnings?startDate=2030-01-07&endDate=2030-01-07", headers=auth(doctor)
    )
    assert result.json()["total"] == 700 and result.json()["count"] == 1
    assert result.json()["earnings"][0]["id"] == accepted
    balance = (await client.get(root + "/balance", headers=auth(doctor))).json()
    assert balance == {"balance": 12345, "balanceInRupees": 123.45, "fees": 700}


@pytest.mark.parametrize("suffix", ["balance", "earnings", "stats", "withdrawals"])
async def test_financial_endpoints_are_doctor_private(client, seed_user, suffix):
    doctor, outsider = await seed_user("DOCTOR"), await seed_user()
    response = await client.get(f"/api/doctors/{doctor['doctorId']}/{suffix}", headers=auth(outsider))
    assert response.status_code == 403


@pytest.mark.parametrize("amount", [True, 99, -100, 100.5, "100", None])
async def test_withdrawal_invalid_amount_never_reserves_balance(client, db, seed_user, amount):
    doctor = await seed_user("DOCTOR", profile={"balance": 50000})
    result = await client.post(
        f"/api/doctors/{doctor['doctorId']}/withdrawals", headers=auth(doctor), json={"amount": amount}
    )
    assert result.status_code == 400
    assert (await db.execute(select(tables["Doctor"].c.balance))).scalar_one() == 50000


async def test_withdrawal_requires_bank_account_before_reserving_balance(client, db, seed_user):
    doctor = await seed_user("DOCTOR", profile={"balance": 50000})
    result = await client.post(
        f"/api/doctors/{doctor['doctorId']}/withdrawals", headers=auth(doctor), json={"amount": 100}
    )
    assert result.status_code == 400 and "Bank" in result.json()["error"]
    assert (await db.execute(select(tables["Doctor"].c.balance))).scalar_one() == 50000
