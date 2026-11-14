
"""PostgreSQL checkpoint persistence for Quick-Clinic AI agents.

Checkpoints store LangGraph execution state across requests
and service restarts.

This module does not manage human approval records.
Those will be stored in a separate AgentApproval table.
"""

from contextlib import asynccontextmanager
from typing import AsyncIterator
from urllib.parse import (
    parse_qsl,
    urlencode,
    urlsplit,
    urlunsplit,
)

from langgraph.checkpoint.postgres.aio import (
    AsyncPostgresSaver,
)
from langgraph.checkpoint.serde.jsonplus import (
    JsonPlusSerializer,
)

from .config import LangGraphPersistenceConfig


def _checkpoint_database_url() -> str:
    """Return a Psycopg-compatible PostgreSQL URL."""

    url = (
        LangGraphPersistenceConfig.get_connection_string()
        .strip()
    )

    if not url:
        raise RuntimeError(
            "Checkpoint database URL is not configured"
        )

    if url.startswith("postgres://"):
        url = "postgresql://" + url[len("postgres://"):]

    for prefix in (
        "postgresql+asyncpg://",
        "postgresql+psycopg://",
    ):
        if url.startswith(prefix):
            url = "postgresql://" + url[len(prefix):]
            break

    parsed = urlsplit(url)

    if parsed.scheme != "postgresql":
        raise RuntimeError(
            "LangGraph checkpoints require PostgreSQL"
        )

    # Remove connection options that belong to other drivers.
    query = [
        (key, value)
        for key, value in parse_qsl(
            parsed.query,
            keep_blank_values=True,
        )
        if key not in {
            "pgbouncer",
        }
    ]

    return urlunsplit(
        parsed._replace(query=urlencode(query))
    )


@asynccontextmanager
async def get_checkpoint() -> AsyncIterator[
    AsyncPostgresSaver
]:
    """Open a checkpoint session for one graph invocation.

    Use the same thread_id when resuming an interrupted
    graph from a later HTTP request.

    The connection closes automatically when the
    context manager exits.
    """

    serializer = JsonPlusSerializer(
        allowed_msgpack_modules=None,
        pickle_fallback=False,
    )

    async with AsyncPostgresSaver.from_conn_string(
        _checkpoint_database_url(),
        serde=serializer,
    ) as checkpointer:
        yield checkpointer


async def initialize_checkpoint_schema() -> None:
    """Initialize or migrate LangGraph's checkpoint tables.

    Run explicitly during a controlled database migration.
    Never invoke this for every chat request.
    """

    async with get_checkpoint() as checkpointer:
        await checkpointer.setup()
