"""Socket.IO transport construction and per-process connection state."""

import logging
import socketio
from datetime import date, datetime, timezone
from app.core.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()
manager = socketio.AsyncRedisManager(settings.redis_url) if settings.redis_url else None
sio = socketio.AsyncServer(
    async_mode="asgi",
    cors_allowed_origins=settings.cors_origins,
    client_manager=manager,
    logger=False,
    engineio_logger=False,
    max_http_buffer_size=64000,
)
_sessions: dict[str, dict] = {}
_tasks: dict = {}
_limits: dict[tuple[str, str], list[float]] = {}


def encode(value):
    if isinstance(value, datetime):
        return value.replace(tzinfo=timezone.utc).isoformat().replace("+00:00", "Z")
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, dict):
        return {key: encode(item) for key, item in value.items()}
    if isinstance(value, (tuple, list)):
        return [encode(item) for item in value]
    return value


def make_socket_app(http_app):
    return socketio.ASGIApp(sio, other_asgi_app=http_app, socketio_path="socket.io")


async def shutdown():
    for sid in list(_sessions):
        await sio.disconnect(sid)
    await sio.shutdown()
