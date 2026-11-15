"""Regression tests for human approval TTL and timezone-safe API timestamps."""

from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

import pytest

from app.features.ai_agent.approval_resume import _utc_iso, format_approval_payload
from app.features.ai_agent.persistence.approval_helpers import APPROVAL_TTL_SECONDS


@pytest.mark.unit
def test_approval_window_is_ten_minutes() -> None:
    assert APPROVAL_TTL_SECONDS == 600


@pytest.mark.unit
def test_api_formats_naive_utc_expiry_for_browser_in_india() -> None:
    issued_at = datetime(2026, 11, 15, 9, 0, tzinfo=UTC)
    expires_at = issued_at + timedelta(seconds=APPROVAL_TTL_SECONDS)
    row = {
        "id": "approval_1",
        "actionType": "APPLY_LEAVE",
        "riskLevel": "MEDIUM_HUMAN_APPROVAL",
        "status": "PENDING",
        "executionStatus": "NOT_STARTED",
        "title": "Apply Leave",
        "summary": "Apply for leave",
        "reason": "Requested by doctor",
        "parameters": {},
        "idempotencyKey": "hitl_approval_1",
        "expiresAt": expires_at.replace(tzinfo=None),
        "decidedAt": None,
        "approvedByUserId": None,
    }

    response = format_approval_payload(row)
    browser_parsed = datetime.fromisoformat(response["expiresAt"])

    assert browser_parsed.utcoffset() == timedelta(0)
    assert browser_parsed - issued_at == timedelta(minutes=10)
    assert browser_parsed.astimezone(ZoneInfo("Asia/Kolkata")).hour == 14
    assert response["decidedAt"] is None


@pytest.mark.unit
def test_approval_decision_timestamp_preserves_utc_instant() -> None:
    local = datetime(2026, 11, 15, 14, 30, tzinfo=ZoneInfo("Asia/Kolkata"))
    assert _utc_iso(local) == "2026-11-15T09:00:00+00:00"
    assert _utc_iso(local.replace(tzinfo=None)) == "2026-11-15T14:30:00+00:00"
    assert _utc_iso(None) is None
