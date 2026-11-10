"""PostgreSQL checkpoint persistence architecture for future LangGraph execution.

LangGraph workflows require durable checkpoints so that human-in-the-loop approvals,
multi-step doctor consultations, and tool interruptions can resume after restarts.
"""

from app.core.config import get_settings


class LangGraphPersistenceConfig:
    """Guidelines and helper configurations for LangGraph PostgreSQL checkpointer."""

    # Schema tables required by LangGraph AsyncPostgresSaver:
    # 1. checkpoints (thread_id, checkpoint_ns, checkpoint_id, parent_checkpoint_id, type, checkpoint, metadata)
    # 2. checkpoint_blobs (thread_id, checkpoint_ns, channel, version, type, blob)
    # 3. checkpoint_writes (thread_id, checkpoint_ns, checkpoint_id, task_id, idx, channel, type, blob)
    # 4. checkpoint_migrations (v)

    @classmethod
    def get_connection_string(cls) -> str:
        """Returns the PostgreSQL connection string appropriate for LangGraph AsyncPostgresSaver."""
        settings = get_settings()
        # Use dedicated langgraph_database_url if provided, otherwise the main database_url
        url = settings.langgraph_database_url or settings.database_url
        if url.startswith("postgres://"):
            url = "postgresql://" + url[len("postgres://") :]
        return url

    @classmethod
    def get_pool_kwargs(cls) -> dict:
        """Connection pool settings optimized for Supabase/Neon connection limits."""
        return {
            "min_size": 1,
            "max_size": 3,
            "timeout": 15.0,
            "command_timeout": 30.0,
            "max_queries": 500,
            "max_inactive_connection_lifetime": 300.0,
        }
