"""Schedule editing, generated availability, leave and private overviews."""

from datetime import datetime, timedelta

import pytest
from sqlalchemy import insert, select, update

from app.core.security import issue_token
from app.infrastructure.database import new_id, tables


def auth(user):
    return {"Authorization": f"Bearer {issue_token(user)}"}


async def slot(db, doctor, status="AVAILABLE", minute=0):
    identifier = new_id()
    start = datetime(2035, 1, 1, 3, 30) + timedelta(minutes=minute)
    await db.execute(
        insert(tables["Slot"]).values(
            id=identifier,
            doctorId=doctor["doctorId"],
            date=start.date(),
            startTime=start,
            endTime=start + timedelta(minutes=10),
            status=status,
        )
    )
    return identifier


async def test_weekly_schedule_upsert_is_one_record_and_generation_is_idempotent(client, db, seed_user):
    doctor = await seed_user("DOCTOR")
    root = f"/api/doctors/{doctor['doctorId']}"
    weekly = [{"day": "Monday", "slots": [{"start": "09:00", "end": "09:25"}]}]
    for _ in range(2):
        response = await client.post(
            root + "/schedule", headers=auth(doctor), json={"weeklySchedule": weekly}
        )
        assert response.status_code == 201
    assert len((await db.execute(select(tables["Schedule"]))).all()) == 1
    first = await client.get(root + "/slots?date=2035-01-01")
    second = await client.get(root + "/slots?date=2035-01-01")
    assert first.status_code == 201 and second.status_code == 200
    assert [row["id"] for row in first.json()["slots"]] == [row["id"] for row in second.json()["slots"]]
    assert len(second.json()["slots"]) == 2  # partial final 5 minutes cannot form a slot
    assert second.json()["slots"][0]["startTime"].startswith("2035-01-01T03:30")
    assert (await client.get(root + "/slots?date=2035-01-02")).json()["slots"] == []


async def test_missing_schedule_and_doctor_are_not_found(client, seed_user):
    doctor = await seed_user("DOCTOR")
    assert (await client.get(f"/api/doctors/{doctor['doctorId']}/schedule")).status_code == 404
    assert (await client.get("/api/doctors/missing/slots?date=2035-01-01")).status_code == 404


async def test_ad_hoc_slot_rejects_overlap_allows_touching_boundary_and_can_be_removed(client, seed_user):
    doctor = await seed_user("DOCTOR")
    root = f"/api/doctors/{doctor['doctorId']}/slots"
    body = {"date": "2035-01-01", "startTime": "09:00", "endTime": "09:10"}
    created = await client.post(root, headers=auth(doctor), json=body)
    assert created.status_code == 201
    assert (await client.post(root, headers=auth(doctor), json=body)).status_code == 409
    adjacent = await client.post(
        root, headers=auth(doctor), json={**body, "startTime": "09:10", "endTime": "09:20"}
    )
    assert adjacent.status_code == 201
    identifier = created.json()["slot"]["id"]
    result = await client.request("DELETE", root, headers=auth(doctor), json={"slotId": identifier})
    assert result.status_code == 200
    assert (
        await client.request("DELETE", root, headers=auth(doctor), json={"slotId": identifier})
    ).status_code == 404


@pytest.mark.parametrize("status", ["BOOKED", "HELD"])
async def test_booked_or_held_slots_cannot_be_edited_or_removed(client, db, seed_user, status):
    doctor = await seed_user("DOCTOR")
    identifier = await slot(db, doctor, status)
    root = f"/api/doctors/{doctor['doctorId']}/slots"
    assert (
        await client.patch(root, headers=auth(doctor), json={"slotId": identifier, "status": "AVAILABLE"})
    ).status_code == 409
    assert (
        await client.request("DELETE", root, headers=auth(doctor), json={"slotId": identifier})
    ).status_code == 409


async def test_bulk_edit_is_atomic_when_any_slot_belongs_to_other_doctor(client, db, seed_user):
    doctor, other = await seed_user("DOCTOR"), await seed_user("DOCTOR")
    own, foreign = await slot(db, doctor), await slot(db, other)
    result = await client.patch(
        f"/api/doctors/{doctor['doctorId']}/slots",
        headers=auth(doctor),
        json={"slotIds": [own, foreign], "status": "UNAVAILABLE"},
    )
    assert result.status_code == 404
    assert set((await db.execute(select(tables["Slot"].c.status))).scalars()) == {"AVAILABLE"}


@pytest.mark.parametrize(
    "payload",
    [
        {"slotIds": [], "status": "AVAILABLE"},
        {"slotIds": [1], "status": "AVAILABLE"},
        {"slotIds": ["id"], "status": "BOOKED"},
        {"slotIds": ["id"], "status": "HELD"},
    ],
)
async def test_slot_edits_accept_only_explicit_valid_ids_and_editable_statuses(client, seed_user, payload):
    doctor = await seed_user("DOCTOR")
    result = await client.patch(
        f"/api/doctors/{doctor['doctorId']}/slots", headers=auth(doctor), json=payload
    )
    assert result.status_code == 400


async def test_leave_cancels_pending_visit_clears_holds_and_restores_only_after_cancel(client, db, seed_user):
    doctor, patient = await seed_user("DOCTOR"), await seed_user()
    booked = await slot(db, doctor, "BOOKED")
    held = await slot(db, doctor, "HELD", 10)
    await db.execute(
        update(tables["Slot"])
        .where(tables["Slot"].c.id == held)
        .values(
            heldByPatientId=patient["patientId"],
            holdToken="synthetic-private-token",
            heldAt=datetime(2035, 1, 1),
            holdExpiresAt=datetime(2035, 1, 1, 4),
        )
    )
    appt = new_id()
    await db.execute(
        insert(tables["Appointment"]).values(
            id=appt,
            doctorId=doctor["doctorId"],
            patientId=patient["patientId"],
            slotId=booked,
            status="PENDING",
            paymentMethod="OFFLINE",
        )
    )
    root = f"/api/doctors/{doctor['doctorId']}"
    result = await client.post(
        root + "/leave",
        headers=auth(doctor),
        json={
            "startDate": "2035-01-01T03:30Z",
            "endDate": "2035-01-01T03:50Z",
            "reason": "  Synthetic leave  ",
        },
    )
    assert result.status_code == 201, result.text
    assert result.json()["cancelledAppointments"] == 1
    assert (await db.execute(select(tables["Appointment"].c.status))).scalar_one() == "CANCELLED"
    rows = (await db.execute(select(tables["Slot"]))).mappings().all()
    assert all(row["status"] == "ON_LEAVE" and row["holdToken"] is None for row in rows)
    assert (
        await client.patch(
            root + "/slots", headers=auth(doctor), json={"slotId": held, "status": "AVAILABLE"}
        )
    ).status_code == 409
    result = await client.delete(
        root + "/leave", headers=auth(doctor), params={"leaveId": result.json()["id"]}
    )
    assert result.status_code == 200
    assert set((await db.execute(select(tables["Slot"].c.status))).scalars()) == {"AVAILABLE"}
    assert (await db.execute(select(tables["Appointment"].c.status))).scalar_one() == "CANCELLED"


async def test_leave_overlap_conflicts_but_adjacent_ranges_and_rescheduling_work(client, db, seed_user):
    doctor = await seed_user("DOCTOR")
    identifier = await slot(db, doctor)
    root = f"/api/doctors/{doctor['doctorId']}/leave"
    body = {"startDate": "2035-01-01T03:30Z", "endDate": "2035-01-01T03:40Z", "reason": "Conference"}
    first = await client.post(root, headers=auth(doctor), json=body)
    assert first.status_code == 201
    assert (await client.post(root, headers=auth(doctor), json=body)).status_code == 409
    adjacent = await client.post(
        root,
        headers=auth(doctor),
        json={**body, "startDate": "2035-01-01T03:40Z", "endDate": "2035-01-01T03:50Z"},
    )
    assert adjacent.status_code == 201
    revised = await client.patch(
        root,
        headers=auth(doctor),
        json={
            "leaveId": first.json()["id"],
            "newStartDate": "2035-01-02T03:30Z",
            "newEndDate": "2035-01-02T03:40Z",
        },
    )
    assert revised.status_code == 200
    assert (
        await db.execute(select(tables["Slot"].c.status).where(tables["Slot"].c.id == identifier))
    ).scalar_one() == "AVAILABLE"
    listing = await client.get(
        root, headers=auth(doctor), params={"reason": "Conference", "startDate": "2035-01-02"}
    )
    assert len(listing.json()["leaves"]) == 1


@pytest.mark.parametrize(
    "body",
    [
        {"startDate": "2035-01-02", "endDate": "2035-01-01", "reason": "Leave"},
        {"startDate": "2000-01-01", "endDate": "2000-01-02", "reason": "Past"},
        {"startDate": "2035-01-01", "endDate": "2035-01-02", "reason": " "},
    ],
)
async def test_leave_requires_future_positive_range_and_reason(client, seed_user, body):
    doctor = await seed_user("DOCTOR")
    assert (
        await client.post(f"/api/doctors/{doctor['doctorId']}/leave", headers=auth(doctor), json=body)
    ).status_code == 400


@pytest.mark.parametrize(
    "view,params,expected",
    [
        ("day", {"date": "2035-01-01"}, "metrics"),
        ("week", {"startDate": "2035-01-01"}, "weekMetrics"),
        ("month", {"year": "2035", "month": "1"}, "days"),
    ],
)
async def test_schedule_overview_views_are_private_and_consistent(
    client, db, seed_user, view, params, expected
):
    doctor, other = await seed_user("DOCTOR"), await seed_user("DOCTOR")
    await slot(db, doctor)
    root = f"/api/doctors/{doctor['doctorId']}/schedule/overview"
    response = await client.get(root, headers=auth(doctor), params={"view": view, **params})
    assert response.status_code == 200, response.text
    assert expected in response.json()
    assert (await client.get(root, headers=auth(other), params={"view": view, **params})).status_code == 403


@pytest.mark.parametrize("query", ["view=year", "view=month&month=13", "view=month&year=invalid"])
async def test_overview_rejects_invalid_views_and_calendar_ranges(client, seed_user, query):
    doctor = await seed_user("DOCTOR")
    assert (
        await client.get(f"/api/doctors/{doctor['doctorId']}/schedule/overview?{query}", headers=auth(doctor))
    ).status_code == 400
