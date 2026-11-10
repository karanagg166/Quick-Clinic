"""A bounded liveness probe, never a guarantee of free-tier availability."""

import json
import os
import sys
from datetime import UTC, datetime
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener


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


def health_url(base_url: str) -> str:
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
    return base_url.rstrip("/") + "/api/health"


def main() -> int:
    base_url = os.environ.get("QUICK_CLINIC_BACKEND_URL", "https://quick-clinic-api.onrender.com")
    deadline = os.environ.get("KEEPALIVE_UNTIL", "always")
    if not base_url:
        print("Keep-alive inactive: configure backend URL.")
        return 0
    if not active_window(deadline):
        print("The keep-alive window has ended. No requests sent.")
        return 0
    request = Request(health_url(base_url), headers={"User-Agent": "QuickClinic-HealthMonitor/1.0"})
    try:
        with build_opener(NoRedirects).open(request, timeout=90) as response:
            payload = json.loads(response.read(65536))
            if (
                response.status != 200
                or payload.get("status") != "ok"
                or payload.get("service") != "quick-clinic-backend"
            ):
                raise ValueError("Backend did not return the expected liveness response")
    except (HTTPError, URLError, TimeoutError, ValueError):
        print("::error::Quick-Clinic backend health probe failed.")
        return 1
    print("Quick-Clinic backend is responding.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
