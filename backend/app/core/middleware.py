"""Request IDs, private response caching, request limits and auth abuse controls."""

import time
from collections import defaultdict, deque
from uuid import uuid4
from fastapi import Request
from fastapi.responses import JSONResponse
from .config import get_settings

# One process is the default deployment. Redis is used for distributed limiting when configured.
_rate_windows = defaultdict(deque)


async def request_guards(request: Request, call_next):
    request_id = uuid4().hex
    length = request.headers.get("content-length")
    if length:
        try:
            oversized = int(length) > 11 * 1024 * 1024
        except ValueError:
            return JSONResponse({"error": "Invalid Content-Length"}, status_code=400)
        if oversized:
            return JSONResponse({"error": "Request body too large"}, status_code=413)
    # Never trust forwarded IP headers from public clients for abuse limits.
    client = request.client.host if request.client else "unknown"
    sensitive = (
        request.url.path in {"/api/user/login", "/api/user/signup", "/api/user/reset-password"}
        or "/otp/" in request.url.path
    )
    if sensitive and request.method == "POST":
        key = f"quickclinic:rate:{client}:{request.url.path}:{int(time.time() // 60)}"
        limit = 20
        if get_settings().redis_url:
            from redis.asyncio import Redis

            try:
                async with Redis.from_url(get_settings().redis_url) as redis:
                    count = await redis.incr(key)
                    if count == 1:
                        await redis.expire(key, 61)
            except Exception:
                return JSONResponse(
                    {"error": "Authentication service temporarily unavailable"}, status_code=503
                )
        else:
            now = time.monotonic()
            window = _rate_windows[key]
            while window and window[0] <= now - 60:
                window.popleft()
            window.append(now)
            count = len(window)
            if len(_rate_windows) > 10000:
                for stale in list(_rate_windows):
                    if not _rate_windows[stale] or _rate_windows[stale][-1] <= now - 60:
                        del _rate_windows[stale]
        if count > limit:
            return JSONResponse(
                {"error": "Too many requests"}, status_code=429, headers={"Retry-After": "60"}
            )
    response = await call_next(request)
    response.headers["X-Request-ID"] = request_id
    if request.url.path.startswith("/api/"):
        response.headers["Cache-Control"] = "private, no-store"
    return response
