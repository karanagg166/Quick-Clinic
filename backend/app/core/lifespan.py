"""Application startup validation and lifecycle for durable notification delivery."""

import asyncio
import logging
import os
from contextlib import asynccontextmanager, suppress
from .config import get_settings
from app.infrastructure.database import engine

logger = logging.getLogger(__name__)


async def deliver_pending_notifications():
    from app.features.operations.outbox import dispatch_outbox

    while True:
        try:
            async with engine.connect() as database:
                await dispatch_outbox(database)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.error("Notification delivery will retry (%s)", type(exc).__name__)
        await asyncio.sleep(1)


@asynccontextmanager
async def lifespan(application):
    settings = get_settings()
    if len(settings.jwt_secret) < 32:
        raise RuntimeError("JWT_SECRET must contain at least 32 characters")
    if settings.node_env == "production" and not settings.backend_public_url.startswith("https://"):
        raise RuntimeError("BACKEND_PUBLIC_URL must use HTTPS in production")
    if settings.node_env == "production" and settings.document_storage_backend == "supabase":
        from app.infrastructure.object_storage import configuration, object_path

        configuration()
        object_path(settings.supabase_document_bucket, "configuration-check")
        object_path(settings.supabase_avatar_bucket, "configuration-check")
        if settings.supabase_document_bucket == settings.supabase_avatar_bucket:
            raise RuntimeError("Medical documents and avatars must use separate buckets")
    if (
        settings.node_env == "production"
        and os.environ.get("RENDER")
        and settings.document_storage_backend == "local"
    ):
        raise RuntimeError("Render requires durable cloud document storage")
    task = asyncio.create_task(deliver_pending_notifications())
    try:
        yield
    finally:
        task.cancel()
        with suppress(asyncio.CancelledError):
            await task
        from app.infrastructure.realtime import shutdown

        await shutdown()
        await engine.dispose()
