"""Centralized clinic clock and timezone helpers.

UTC is canonical for stored instants. Asia/Kolkata (IST, UTC+05:30) is the
authoritative business calendar timezone for clinic schedules, date filters,
and AI agent date resolution.
"""

from __future__ import annotations

import calendar
import re
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta, tzinfo
from typing import Callable
from zoneinfo import ZoneInfo

from fastapi import HTTPException, Request

from .config import get_settings

CLINIC_TIMEZONE_NAME: str = get_settings().clinic_timezone
CLINIC_ZONE: ZoneInfo = ZoneInfo(CLINIC_TIMEZONE_NAME)

_clock_override: Callable[[], datetime] | None = None

_WEEKDAY_MAP = {name.lower(): idx for idx, name in enumerate(calendar.day_name)}
_ISO_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_TIME_RE = re.compile(r"^(\d{2}):(\d{2})(?::(\d{2}))?$")


def clinic_zone() -> ZoneInfo:
    """Return the configured authoritative clinic ZoneInfo."""
    configured = get_settings().clinic_timezone
    if configured == CLINIC_TIMEZONE_NAME:
        return CLINIC_ZONE
    return ZoneInfo(configured)


def set_clock_source(provider: Callable[[], datetime] | None) -> None:
    """Override the UTC clock provider (intended for tests)."""
    global _clock_override
    _clock_override = provider


def reset_clock_source() -> None:
    """Restore the default system UTC clock."""
    global _clock_override
    _clock_override = None


@contextmanager
def freeze_clock(instant: datetime | str):
    """Context manager that freezes the shared clock at a fixed instant."""
    frozen = parse_datetime(instant, default_tz=UTC, naive=False) if isinstance(instant, str) else to_utc(instant)
    previous = _clock_override
    set_clock_source(lambda: frozen)
    try:
        yield frozen
    finally:
        set_clock_source(previous)


def now_utc() -> datetime:
    """Return the current timezone-aware UTC datetime."""
    if _clock_override is not None:
        return to_utc(_clock_override())
    return datetime.now(UTC)


def utcnow_naive() -> datetime:
    """Return the current UTC instant as a naive datetime for PostgreSQL TIMESTAMP WITHOUT TIME ZONE."""
    return now_utc().replace(tzinfo=None)


def to_utc(value: datetime) -> datetime:
    """Convert an aware datetime to UTC, or tag a naive stored instant as UTC."""
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def to_naive_utc(value: datetime) -> datetime:
    """Convert a datetime to naive UTC for database storage."""
    return to_utc(value).replace(tzinfo=None)


def to_clinic_time(value: datetime) -> datetime:
    """Convert an instant (aware, or naive-UTC from DB) into the authoritative clinic timezone."""
    return to_utc(value).astimezone(clinic_zone())


def now_clinic(now: datetime | None = None) -> datetime:
    """Return the current (or provided) instant in the authoritative clinic timezone."""
    instant = to_utc(now) if now is not None else now_utc()
    return instant.astimezone(clinic_zone())


def today_clinic(now: datetime | None = None) -> date:
    """Return today's calendar date in the authoritative clinic timezone."""
    return now_clinic(now).date()


def parse_date(value: str | date) -> date:
    """Strictly parse a YYYY-MM-DD calendar date without timezone conversion."""
    if isinstance(value, date) and not isinstance(value, datetime):
        return value
    if not isinstance(value, str) or not _ISO_DATE_RE.fullmatch(value.strip()):
        raise HTTPException(status_code=400, detail="Invalid date format")
    try:
        return date.fromisoformat(value.strip())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid date format") from exc


def parse_datetime(
    value: str | datetime,
    *,
    default_tz: tzinfo | None = None,
    naive: bool = False,
) -> datetime:
    """Parse an ISO 8601 timestamp strictly and normalize it to UTC.

    If the input lacks an explicit timezone offset and ``default_tz`` is None,
    an HTTP 400 error is raised rather than guessing the server's local timezone.
    """
    if isinstance(value, datetime):
        parsed = value
    elif isinstance(value, str):
        raw = value.strip()
        if not raw:
            raise HTTPException(status_code=400, detail="Invalid date format")
        normalized = raw[:-1] + "+00:00" if raw.endswith(("Z", "z")) else raw
        try:
            parsed = datetime.fromisoformat(normalized)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="Invalid date format") from exc
    else:
        raise HTTPException(status_code=400, detail="Invalid date format")

    if parsed.tzinfo is None:
        if default_tz is None:
            raise HTTPException(status_code=400, detail="Datetime must include an explicit timezone offset")
        parsed = parsed.replace(tzinfo=default_tz)

    utc_dt = parsed.astimezone(UTC)
    return utc_dt.replace(tzinfo=None) if naive else utc_dt


def _parse_wall_time(wall_time: str | time) -> time:
    if isinstance(wall_time, time):
        return wall_time
    if not isinstance(wall_time, str):
        raise HTTPException(status_code=400, detail="Invalid time format")
    match = _TIME_RE.fullmatch(wall_time.strip())
    if not match:
        raise HTTPException(status_code=400, detail="Invalid time format")
    hour, minute, second = int(match.group(1)), int(match.group(2)), int(match.group(3) or 0)
    try:
        return time(hour=hour, minute=minute, second=second)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid time format") from exc


def clinic_datetime_to_utc(day: date | str, wall_time: str | time, *, naive: bool = False) -> datetime:
    """Interpret a clinic-local date and wall-clock time in Asia/Kolkata and return its UTC instant."""
    clinic_day = parse_date(day)
    clinic_wall = _parse_wall_time(wall_time)
    local_dt = datetime.combine(clinic_day, clinic_wall, tzinfo=clinic_zone())
    utc_dt = local_dt.astimezone(UTC)
    return utc_dt.replace(tzinfo=None) if naive else utc_dt


def clinic_day_bounds_utc(day: date | str, *, naive: bool = False) -> tuple[datetime, datetime]:
    """Return (start_utc, end_exclusive_utc) for an entire calendar day in Asia/Kolkata."""
    clinic_day = parse_date(day)
    start_local = datetime.combine(clinic_day, time.min, tzinfo=clinic_zone())
    end_local = datetime.combine(clinic_day + timedelta(days=1), time.min, tzinfo=clinic_zone())
    start_utc = start_local.astimezone(UTC)
    end_utc = end_local.astimezone(UTC)
    if naive:
        return start_utc.replace(tzinfo=None), end_utc.replace(tzinfo=None)
    return start_utc, end_utc


def resolve_clinic_date(value: str | date | None, *, reference_date: date | None = None) -> date:
    """Resolve an ISO calendar date or relative expression ('today', 'tomorrow', etc.) in Asia/Kolkata."""
    base = reference_date if reference_date is not None else today_clinic()
    if value is None:
        return base
    if isinstance(value, date) and not isinstance(value, datetime):
        return value
    if not isinstance(value, str):
        raise ValueError(f"Unsupported clinic date value: {value!r}")

    text = " ".join(value.strip().lower().split())
    if not text or text == "today":
        return base
    if text == "tomorrow":
        return base + timedelta(days=1)
    if text == "yesterday":
        return base - timedelta(days=1)
    if text in ("day after tomorrow", "the day after tomorrow"):
        return base + timedelta(days=2)

    if _ISO_DATE_RE.fullmatch(text):
        return date.fromisoformat(text)

    if text.startswith("next "):
        weekday_name = text[5:].strip()
        if weekday_name in _WEEKDAY_MAP:
            target_idx = _WEEKDAY_MAP[weekday_name]
            days_ahead = (target_idx - base.weekday()) % 7
            return base + timedelta(days=days_ahead or 7)

    if text.startswith("this "):
        weekday_name = text[5:].strip()
        if weekday_name in _WEEKDAY_MAP:
            target_idx = _WEEKDAY_MAP[weekday_name]
            days_ahead = (target_idx - base.weekday()) % 7
            return base + timedelta(days=days_ahead)

    if text in _WEEKDAY_MAP:
        target_idx = _WEEKDAY_MAP[text]
        days_ahead = (target_idx - base.weekday()) % 7
        return base + timedelta(days=days_ahead)

    raise ValueError(f"Could not resolve clinic date expression: {value!r}")


@dataclass(frozen=True, slots=True)
class RequestClockContext:
    """Snapshot of the authoritative request-time clock in UTC and Asia/Kolkata."""

    now_utc: datetime
    now_clinic: datetime
    today_clinic: date
    clinic_timezone: str


def get_request_clock(request: Request) -> RequestClockContext:
    """Return the per-request clock snapshot captured by middleware (or current clock if absent)."""
    captured_utc = getattr(request.state, "now_utc", None)
    if captured_utc is None:
        captured_utc = now_utc()
    captured_clinic = getattr(request.state, "now_clinic", None) or to_clinic_time(captured_utc)
    captured_today = getattr(request.state, "today_clinic", None) or captured_clinic.date()
    tz_name = getattr(request.state, "clinic_timezone", None) or get_settings().clinic_timezone
    return RequestClockContext(
        now_utc=captured_utc,
        now_clinic=captured_clinic,
        today_clinic=captured_today,
        clinic_timezone=tz_name,
    )
