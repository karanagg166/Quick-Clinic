"""Preserve Prisma's UTC JSON timestamps while PostgreSQL stores naive UTC."""

from collections.abc import Mapping
from datetime import UTC, date, datetime
from functools import wraps
from fastapi.responses import Response


def encode_utc(value):
    if isinstance(value, datetime):
        return (
            value.replace(tzinfo=UTC).isoformat().replace("+00:00", "Z")
            if value.tzinfo is None
            else value.astimezone(UTC).isoformat().replace("+00:00", "Z")
        )
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, Mapping):
        return {key: encode_utc(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [encode_utc(item) for item in value]
    return value


def utc_endpoint(endpoint):
    @wraps(endpoint)
    async def wrapped(*args, **kwargs):
        result = await endpoint(*args, **kwargs)
        return result if isinstance(result, Response) else encode_utc(result)

    return wrapped
