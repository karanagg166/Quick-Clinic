"""Uvicorn entrypoint: a single ASGI service for REST and Socket.IO."""

from .api import create_api
from .infrastructure.realtime import make_socket_app

api = create_api()
app = make_socket_app(api)
