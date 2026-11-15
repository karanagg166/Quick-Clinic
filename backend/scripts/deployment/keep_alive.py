"""A bounded liveness probe, never a guarantee of free-tier availability."""

import json
import os
import sys
import time
from datetime import UTC, datetime
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

STATE_HEALTHY = "Healthy"
STATE_WAKING_UP = "Waking up"
STATE_UNHEALTHY = "Unhealthy"
STATE_DEPLOYMENT_UNAVAILABLE = "Deployment unavailable"
STATE_DATABASE_UNAVAILABLE = "Database unavailable"


class NoRedirects(HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, newurl):
        return None


def active_window(expires_at: str, now: datetime | None = None) -> bool:
    if str(expires_at).lower().strip() in ("always", "forever", "unlimited", "24/7", "*"):
        return True
    deadline = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
    if deadline.tzinfo is None:
        raise ValueError("KEEPALIVE_UNTIL must include a timezone")
    current = now or datetime.now(UTC)
    if (deadline - current).total_seconds() > 30 * 86400 + 60:
        raise ValueError("Keep-alive deadline must be within 30 days")
    return current < deadline


def _validate_origin(base_url: str) -> str:
    parsed = urlsplit(base_url)
    if (
        parsed.scheme != "https"
        or not parsed.hostname
        or not parsed.hostname.endswith(".onrender.com")
        or parsed.username
        or parsed.password
        or parsed.port not in (None, 443)
        or parsed.query
        or parsed.fragment
        or parsed.path not in ("", "/")
    ):
        raise ValueError("Use the HTTPS Render service origin, without credentials or paths")
    return base_url.rstrip("/")


def health_url(base_url: str) -> str:
    return _validate_origin(base_url) + "/api/health"


def ready_url(base_url: str) -> str:
    return _validate_origin(base_url) + "/api/ready"


def _fetch_json(url: str, timeout: int = 30) -> tuple[int | None, dict[str, str], dict | None]:
    request = Request(url, headers={"User-Agent": "QuickClinic-HealthMonitor/1.0"})
    try:
        with build_opener(NoRedirects).open(request, timeout=timeout) as response:
            headers = {k.lower(): v for k, v in response.headers.items()}
            payload = json.loads(response.read(65536))
            return response.status, headers, payload if isinstance(payload, dict) else None
    except HTTPError as exc:
        headers = {k.lower(): v for k, v in (exc.headers.items() if exc.headers else [])}
        try:
            raw = exc.read(65536)
            payload = json.loads(raw) if raw else None
        except Exception:
            payload = None
        return exc.code, headers, payload if isinstance(payload, dict) else None
    except (URLError, TimeoutError, ValueError):
        return None, {}, None


def classify_probe(
    health_status: int | None,
    health_headers: dict[str, str],
    health_body: dict | None,
    ready_status: int | None,
    ready_body: dict | None,
) -> str:
    """Classify backend probe into Healthy, Waking up, Unhealthy, Deployment unavailable, or Database unavailable."""
    routing = health_headers.get("x-render-routing", "").lower()
    if health_status == 404 or routing == "no-server":
        return STATE_DEPLOYMENT_UNAVAILABLE
    if health_status in (None, 502, 503, 504):
        return STATE_WAKING_UP
    if (
        health_status != 200
        or not isinstance(health_body, dict)
        or health_body.get("status") != "ok"
        or health_body.get("service") != "quick-clinic-backend"
    ):
        return STATE_UNHEALTHY
    if ready_status == 503 or (
        isinstance(ready_body, dict)
        and (
            ready_body.get("error") == "DATABASE_UNAVAILABLE"
            or ready_body.get("database") == "disconnected"
        )
    ):
        return STATE_DATABASE_UNAVAILABLE
    if (
        ready_status == 200
        and isinstance(ready_body, dict)
        and ready_body.get("status") == "ready"
        and ready_body.get("database") == "connected"
    ):
        return STATE_HEALTHY
    if ready_status in (None, 502, 504):
        return STATE_WAKING_UP
    return STATE_UNHEALTHY


def main() -> int:
    base_url = os.environ.get("QUICK_CLINIC_BACKEND_URL", "https://quick-clinic-api.onrender.com")
    deadline = os.environ.get("KEEPALIVE_UNTIL", "always")
    if not base_url:
        print("Keep-alive inactive: configure backend URL.")
        return 0
    if not active_window(deadline):
        print("The keep-alive window has ended. No requests sent.")
        return 0
    h_url = health_url(base_url)
    r_url = ready_url(base_url)
    max_attempts = 4
    for attempt in range(1, max_attempts + 1):
        h_status, h_headers, h_body = _fetch_json(h_url, timeout=30)
        if h_status == 200:
            r_status, _, r_body = _fetch_json(r_url, timeout=15)
        else:
            r_status, r_body = None, None
        state = classify_probe(h_status, h_headers, h_body, r_status, r_body)
        print(f"[attempt {attempt}/{max_attempts}] state={state} health={h_status} ready={r_status}")
        if state == STATE_HEALTHY:
            print("Quick-Clinic backend and database are Healthy.")
            return 0
        if state == STATE_WAKING_UP and attempt < max_attempts:
            time.sleep(15)
            continue
        print(f"::error::Quick-Clinic backend probe failed with state: {state}")
        return 1
    return 1


if __name__ == "__main__":
    sys.exit(main())
