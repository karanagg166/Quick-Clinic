"""Request IDs, private response caching, request limits and auth abuse controls."""

import asyncio
import time
from collections import defaultdict, deque
from uuid import uuid4
from fastapi import HTTPException, Request
from fastapi.responses import JSONResponse
from .config import get_settings

# One process is the default deployment. Redis is used for distributed limiting when configured.
_rate_windows = defaultdict(deque)
MAX_REQUEST_BYTES = 11 * 1024 * 1024


async def request_guards(request: Request, call_next):
    request_id = uuid4().hex
    length = request.headers.get("content-length")
    if length:
        try:
            oversized = int(length) > MAX_REQUEST_BYTES
        except ValueError:
            return JSONResponse({"error": "Invalid Content-Length"}, status_code=400)
        if oversized:
            return JSONResponse({"error": "Request body too large"}, status_code=413)

    # Protect streaming/chunked requests from exceeding max body size
    original_receive = request._receive
    bytes_received = 0

    async def bounded_receive():
        nonlocal bytes_received
        message = await original_receive()
        if message.get("type") == "http.request":
            bytes_received += len(message.get("body", b""))
            if bytes_received > MAX_REQUEST_BYTES:
                raise HTTPException(413, "Request body too large")
        return message

    request._receive = bounded_receive

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
                async with Redis.from_url(
                    get_settings().redis_url,
                    socket_timeout=1.0,
                    socket_connect_timeout=1.0,
                ) as redis:
                    count = await asyncio.wait_for(redis.incr(key), timeout=1.5)
                    if count == 1:
                        await asyncio.wait_for(redis.expire(key, 61), timeout=1.0)
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
