"""Clinic time conversion and timeline invariants, independent of transport."""

from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException

from app.features.scheduling.validation import (
    aware,
    local_time,
    parse_date,
    parse_datetime,
    time_minutes,
    validate_schedule,
)
from app.features.scheduling.overview import day_metrics, timeline_blocks


@pytest.mark.parametrize("value", [None, 930, "9:30", "09:3", "09:60", "24:00", "-1:00", "09:00:00"])
def test_clock_rejects_malformed_or_out_of_range_values(value):
    with pytest.raises(HTTPException) as error:
        time_minutes(value)
    assert error.value.status_code == 400


@pytest.mark.parametrize("value,minutes", [("00:00", 0), ("23:59", 1439), ("12:30", 750)])
def test_clock_accepts_boundaries(value, minutes):
    assert time_minutes(value) == minutes


@pytest.mark.parametrize("value", [None, "2030-02-30", "tomorrow"])
def test_invalid_calendar_dates_are_client_errors(value):
    with pytest.raises(HTTPException, match="400"):
        parse_date(value)


@pytest.mark.parametrize("value", [None, 123, "2030-13-01", "2030-01-01T25:00"])
def test_invalid_datetimes_are_client_errors(value):
    with pytest.raises(HTTPException, match="400"):
        parse_datetime(value)


def test_offset_times_normalize_to_naive_utc_and_midnight_crosses_day():
    expected = datetime(2029, 12, 31, 18, 30)
    assert local_time("2030-01-01", "00:00") == expected
    assert parse_datetime("2030-01-01T00:00:00+05:30") == expected
    assert local_time("2030-01-01", "2029-12-31T18:30:00Z") == expected
    assert aware(expected.replace(tzinfo=timezone.utc)) == expected


@pytest.mark.parametrize(
    "weekly",
    [
        None,
        {},
        [None],
        [{"day": "Monday", "slots": {}}],
        [{"day": "Monday", "slots": [None]}],
        [{"day": "Monday", "slots": [{"start": "10:00", "end": "10:00"}]}],
        [{"day": "Monday", "slots": [{"start": "11:00", "end": "10:00"}]}],
    ],
)
def test_weekly_schedule_rejects_invalid_structures_and_empty_ranges(weekly):
    with pytest.raises(HTTPException, match="400"):
        validate_schedule(weekly)


def test_empty_schedule_represents_no_clinic_days():
    assert validate_schedule([]) == []


def test_timeline_merges_adjacent_busy_slots_but_preserves_breaks():
    start = datetime(2030, 1, 7, 3, 30)
    rows = [
        dict(
            startTime=start + timedelta(minutes=offset),
            endTime=start + timedelta(minutes=offset + 10),
            status=status,
        )
        for offset, status in [
            (0, "BOOKED"),
            (10, "HELD"),
            (30, "HELD"),
            (40, "AVAILABLE"),
            (50, "ON_LEAVE"),
            (60, "CANCELLED"),
        ]
    ]
    blocks = timeline_blocks(rows)
    assert [row["type"] for row in blocks] == ["BUSY", "BUSY", "FREE", "ON_LEAVE", "BLOCKED"]
    assert blocks[0]["slotCount"] == 2
    assert blocks[0]["durationMinutes"] == 20
    assert blocks[0]["startMinutes"] == 540  # 09:00 clinic time
    metrics = day_metrics(rows)
    assert metrics["busyMinutes"] == 30
    assert metrics["freeMinutes"] == 10
    assert metrics["occupancyPercentage"] == 50
    assert metrics["unavailableCount"] == 1


def test_empty_timeline_has_zero_metrics_without_division_errors():
    assert timeline_blocks([]) == []
    metrics = day_metrics([])
    assert metrics["totalSlots"] == metrics["occupancyPercentage"] == 0
    assert metrics["nextAppointmentTime"] is None
