"""Clinic-local date/time conversion and weekly schedule validation."""

import calendar
import re
from datetime import date, datetime, timezone
from zoneinfo import ZoneInfo
from fastapi import HTTPException

CLINIC_ZONE = ZoneInfo("Asia/Kolkata")


def aware(value):
    return value if value.tzinfo is None else value.astimezone(timezone.utc).replace(tzinfo=None)


def parse_datetime(value):
    try:
        return aware(datetime.fromisoformat(value.replace("Z", "+00:00")))
    except (ValueError, AttributeError, TypeError):
        raise HTTPException(400, "Invalid date format")


def parse_date(value):
    try:
        return date.fromisoformat(value)
    except (ValueError, TypeError):
        raise HTTPException(400, "Invalid date format")


def local_time(day, value):
    if "T" in value:
        return parse_datetime(value)
    time_minutes(value)
    return (
        datetime.fromisoformat(f"{day}T{value}")
        .replace(tzinfo=CLINIC_ZONE)
        .astimezone(timezone.utc)
        .replace(tzinfo=None)
    )


def time_minutes(value):
    if not isinstance(value, str) or not re.fullmatch("\\d{2}:\\d{2}", value):
        raise HTTPException(400, "Time must use HH:mm")
    (hours, minutes) = map(int, value.split(":"))
    if hours > 23 or minutes > 59:
        raise HTTPException(400, "Invalid time")
    return hours * 60 + minutes


def validate_schedule(weekly):
    if not isinstance(weekly, list):
        raise HTTPException(400, "weeklySchedule must be an array")
    days = set()
    for item in weekly:
        if not isinstance(item, dict) or item.get("day", "").lower() not in [
            name.lower() for name in calendar.day_name
        ]:
            raise HTTPException(400, "Each day schedule must specify a valid day name")
        day = item["day"].lower()
        if day in days or not isinstance(item.get("slots", []), list):
            raise HTTPException(400, "Duplicate day or invalid slots")
        days.add(day)
        intervals = []
        for slot in item.get("slots", []):
            if not isinstance(slot, dict):
                raise HTTPException(400, "Invalid slot")
            (start, end) = (time_minutes(slot.get("start")), time_minutes(slot.get("end")))
            if start >= end or any((start < b and end > a for (a, b) in intervals)):
                raise HTTPException(400, "Invalid or overlapping schedule slots")
            intervals.append((start, end))
    return weekly
