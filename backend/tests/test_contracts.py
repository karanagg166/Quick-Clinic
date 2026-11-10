"""Every retained legacy HTTP operation must have a concrete Python route."""

import json
import re
from pathlib import Path
from app.main import api


def normalized(path):
    return re.sub(r"\{[^}]+\}|\[[^]]+\]", "{}", path)


def test_retained_route_coverage():
    expected = json.loads(Path(__file__).with_name("route_contracts.json").read_text())
    actual = {
        (normalized(path), method.upper())
        for path, methods in api.openapi()["paths"].items()
        for method in methods
    }
    missing = [
        (item["path"], item["method"])
        for item in expected
        if (normalized(item["path"]), item["method"]) not in actual
    ]
    assert not missing, f"Missing migrated endpoints: {missing}"


def test_no_retired_ai_endpoints():
    assert not any(
        any(
            fragment in path
            for fragment in ("medical-chat", "medical-search", "medical-answer", "medical-observations")
        )
        for path in api.openapi()["paths"]
    )
