"""Public realtime boundary used by ASGI startup and application services."""

from .server import sio, encode, make_socket_app, shutdown
from .notifications import publish_outbox, revoke_user, revoke_relation

# Import adapters once to register their Socket.IO events.
from . import sessions, handlers

__all__ = [
    "sio",
    "encode",
    "make_socket_app",
    "shutdown",
    "publish_outbox",
    "revoke_user",
    "revoke_relation",
    "sessions",
    "handlers",
]
