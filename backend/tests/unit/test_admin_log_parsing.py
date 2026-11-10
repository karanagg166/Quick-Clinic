"""Legacy log query parsing preserves UTC and bounded pagination semantics."""

from datetime import datetime

import pytest

from app.features.admin.logs import parse_log_limit, parse_log_timestamp


@pytest.mark.parametrize(
    "raw,expected", [(" 12items", 12), ("-9", 1), ("0", 1), ("101", 100), ("invalid", 50)]
)
def test_log_limit_retains_parseint_compatibility_and_bounds(raw, expected):
    assert parse_log_limit(raw) == expected


def test_log_timestamp_normalizes_offset_and_utc_z_to_naive_utc():
    assert parse_log_timestamp("2026-01-01T05:30:00+05:30") == datetime(2026, 1, 1)
    assert parse_log_timestamp("2026-01-01T00:00:00Z") == datetime(2026, 1, 1)
    assert parse_log_timestamp("2026-01-01") == datetime(2026, 1, 1)
    assert parse_log_timestamp("2026-01-") is None
    assert parse_log_timestamp(None) is None
