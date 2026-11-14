"""Authoritative Asia/Kolkata clock, middleware snapshot, and IST query boundary tests."""

from datetime import UTC, date, datetime
from fastapi import Request
from fastapi.testclient import TestClient
from sqlalchemy import insert
import pytest

from app.core.clock import (
    CLINIC_ZONE,
    clinic_datetime_to_utc,
    clinic_day_bounds_utc,
    freeze_clock,
    now_clinic,
    now_utc,
    parse_date,
    parse_datetime,
    resolve_clinic_date,
    to_clinic_time,
    to_utc,
    today_clinic,
)
from app.features.booking.appointments import list_appointments
from app.features.scheduling.overview import get_schedule_overview
from app.infrastructure.database import new_id, tables


def test_ist_midnight_boundary_1829z_vs_1830z():
    with freeze_clock("2026-11-14T18:29:00Z"):
        clinic_dt = now_clinic()
        assert clinic_dt.tzinfo == CLINIC_ZONE
        assert clinic_dt.isoformat() == "2026-11-14T23:59:00+05:30"
        assert today_clinic() == date(2026, 11, 14)

    with freeze_clock("2026-11-14T18:30:00Z"):
        clinic_dt = now_clinic()
        assert clinic_dt.isoformat() == "2026-11-15T00:00:00+05:30"
        assert today_clinic() == date(2026, 11, 15)


@pytest.mark.parametrize(
    "utc_iso,expected_ist_date",
    [
        ("2026-11-30T18:29:59Z", date(2026, 11, 30)),
        ("2026-11-30T18:30:00Z", date(2026, 12, 1)),
        ("2026-12-31T18:29:59Z", date(2026, 12, 31)),
        ("2026-12-31T18:30:00Z", date(2027, 1, 1)),
        ("2024-02-28T18:30:00Z", date(2024, 2, 29)),
        ("2024-02-29T18:30:00Z", date(2024, 3, 1)),
    ],
)
def test_ist_month_year_and_leap_year_rollovers(utc_iso, expected_ist_date):
    with freeze_clock(utc_iso):
        assert today_clinic() == expected_ist_date


def test_clinic_day_bounds_and_wall_time_conversion():
    start_utc, end_utc = clinic_day_bounds_utc(date(2026, 11, 15))
    assert start_utc == datetime(2026, 11, 14, 18, 30, tzinfo=UTC)
    assert end_utc == datetime(2026, 11, 15, 18, 30, tzinfo=UTC)

    wall_utc = clinic_datetime_to_utc("2026-11-15", "00:30")
    assert wall_utc == datetime(2026, 11, 14, 19, 0, tzinfo=UTC)
    assert to_clinic_time(wall_utc).strftime("%Y-%m-%d %H:%M") == "2026-11-15 00:30"
    assert to_utc(datetime(2026, 11, 14, 19, 0)) == datetime(2026, 11, 14, 19, 0, tzinfo=UTC)


def test_parse_datetime_strictness_and_parse_date():
    assert parse_datetime("2026-11-15T00:00:00+05:30") == datetime(2026, 11, 14, 18, 30, tzinfo=UTC)
    assert parse_datetime("2026-11-14T18:30:00Z") == datetime(2026, 11, 14, 18, 30, tzinfo=UTC)
    assert parse_date("2026-11-15") == date(2026, 11, 15)

    with pytest.raises(Exception) as exc:
        parse_datetime("2026-11-15T09:00:00")
    assert exc.value.status_code == 400


def test_resolve_clinic_date_relative_expressions():
    with freeze_clock("2026-11-14T18:30:00Z"):
        # 2026-11-15 is Sunday in IST
        assert resolve_clinic_date("today") == date(2026, 11, 15)
        assert resolve_clinic_date("tomorrow") == date(2026, 11, 16)
        assert resolve_clinic_date("yesterday") == date(2026, 11, 14)
        assert resolve_clinic_date("day after tomorrow") == date(2026, 11, 17)
        assert resolve_clinic_date("next monday") == date(2026, 11, 16)
        assert resolve_clinic_date("next sunday") == date(2026, 11, 22)
        assert resolve_clinic_date("2026-11-20") == date(2026, 11, 20)

    with pytest.raises(ValueError):
        resolve_clinic_date("next century")


def test_middleware_populates_request_state_clock_and_clock_endpoint(monkeypatch):
    from fastapi import FastAPI
    from app.core.middleware import request_guards
    from app.features.health.router import router as health_router

    app = FastAPI()
    app.middleware("http")(request_guards)
    app.include_router(health_router)

    @app.get("/_test_clock_state")
    async def inspect_state(request: Request):
        return {
            "utc": request.state.now_utc.isoformat(),
            "clinic": request.state.now_clinic.isoformat(),
            "today": request.state.today_clinic.isoformat(),
            "tz": request.state.clinic_timezone,
        }

    with freeze_clock("2026-11-14T18:30:00Z"):
        assert now_utc() == datetime(2026, 11, 14, 18, 30, tzinfo=UTC)
        client = TestClient(app)

        state_res = client.get("/_test_clock_state")
        assert state_res.status_code == 200
        assert state_res.json() == {
            "utc": "2026-11-14T18:30:00+00:00",
            "clinic": "2026-11-15T00:00:00+05:30",
            "today": "2026-11-15",
            "tz": "Asia/Kolkata",
        }

        clock_res = client.get("/api/clock")
        assert clock_res.status_code == 200
        assert clock_res.json() == {
            "utc": "2026-11-14T18:30:00Z",
            "clinicNow": "2026-11-15T00:00:00+05:30",
            "clinicDate": "2026-11-15",
            "clinicWeekday": "Sunday",
            "timezone": "Asia/Kolkata",
        }


@pytest.mark.asyncio
async def test_list_appointments_ist_date_range_boundary(db, seed_user):
    doctor = await seed_user("DOCTOR")
    patient = await seed_user("PATIENT")

    # 2026-11-15 00:30 IST == 2026-11-14 19:00 UTC (included in IST 2026-11-15)
    slot_ist_nov15 = new_id()
    # 2026-11-16 00:30 IST == 2026-11-15 19:00 UTC (excluded from IST 2026-11-15)
    slot_ist_nov16 = new_id()
    # 2026-11-14 23:40 IST == 2026-11-14 18:10 UTC (excluded from IST 2026-11-15)
    slot_ist_nov14 = new_id()

    await db.execute(
        insert(tables["Slot"]),
        [
            {
                "id": slot_ist_nov14,
                "doctorId": doctor["doctorId"],
                "date": date(2026, 11, 14),
                "startTime": datetime(2026, 11, 14, 18, 10),
                "endTime": datetime(2026, 11, 14, 18, 20),
                "status": "BOOKED",
            },
            {
                "id": slot_ist_nov15,
                "doctorId": doctor["doctorId"],
                "date": date(2026, 11, 15),
                "startTime": datetime(2026, 11, 14, 19, 0),
                "endTime": datetime(2026, 11, 14, 19, 10),
                "status": "BOOKED",
            },
            {
                "id": slot_ist_nov16,
                "doctorId": doctor["doctorId"],
                "date": date(2026, 11, 16),
                "startTime": datetime(2026, 11, 15, 19, 0),
                "endTime": datetime(2026, 11, 15, 19, 10),
                "status": "BOOKED",
            },
        ],
    )

    appt_nov14 = new_id()
    appt_nov15 = new_id()
    appt_nov16 = new_id()
    await db.execute(
        insert(tables["Appointment"]),
        [
            {
                "id": appt_nov14,
                "doctorId": doctor["doctorId"],
                "patientId": patient["patientId"],
                "slotId": slot_ist_nov14,
                "status": "CONFIRMED",
                "paymentMethod": "OFFLINE",
            },
            {
                "id": appt_nov15,
                "doctorId": doctor["doctorId"],
                "patientId": patient["patientId"],
                "slotId": slot_ist_nov15,
                "status": "CONFIRMED",
                "paymentMethod": "OFFLINE",
            },
            {
                "id": appt_nov16,
                "doctorId": doctor["doctorId"],
                "patientId": patient["patientId"],
                "slotId": slot_ist_nov16,
                "status": "CONFIRMED",
                "paymentMethod": "OFFLINE",
            },
        ],
    )

    results = await list_appointments(
        db,
        {"startDate": "2026-11-15", "endDate": "2026-11-15"},
        "Doctor",
        doctor["doctorId"],
    )
    assert [row["id"] for row in results] == [appt_nov15]


@pytest.mark.asyncio
async def test_schedule_overview_defaults_to_ist_today(db, seed_user):
    doctor = await seed_user("DOCTOR")
    await db.execute(
        insert(tables["Schedule"]).values(
            id=new_id(),
            doctorId=doctor["doctorId"],
            weeklySchedule=[{"day": "Sunday", "slots": [{"start": "09:00", "end": "09:20"}]}],
        )
    )
    # 2026-11-14T18:30:00Z is already 2026-11-15 (Sunday) in Asia/Kolkata
    with freeze_clock("2026-11-14T18:30:00Z"):
        overview = await get_schedule_overview(
            doctor["doctorId"],
            {"view": "day"},
            {"id": doctor["id"], "role": "DOCTOR"},
            db,
        )
        assert overview["date"] == "2026-11-15"
        assert len(overview["slots"]) == 2
