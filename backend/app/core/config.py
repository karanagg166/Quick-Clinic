"""Server configuration. No credentials are sent to the browser."""

from functools import lru_cache
from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=("../.env", ".env"), extra="ignore")
    database_url: str = "postgresql://localhost/quickclinic"
    db_schema: str = "public"
    jwt_secret: str = ""
    node_env: str = "development"
    frontend_url: str = "http://localhost:3000"
    backend_public_url: str = "http://localhost:4000"
    redis_url: str = ""
    cron_secret: str = ""
    internal_api_secret: str = ""
    super_admin_code: str = ""
    razorpay_key_id: str = ""
    razorpay_key_secret: str = ""
    razorpay_webhook_secret: str = ""
    resend_api_key: str = ""
    resend_from: str = "onboarding@resend.dev"
    supabase_url: str = ""
    supabase_secret_key: str = ""
    supabase_document_bucket: str = "quick-clinic-medical-documents"
    supabase_avatar_bucket: str = "quick-clinic-avatars"
    openrouteservice_api_key: str = ""
    document_storage_backend: str = "supabase"
    document_storage_dir: Path = Path("./data/medical-documents")
    git_commit: str = "unknown"

    # Database connection pooling (safe for free-tier Neon / Supabase session pooler)
    db_pool_size: int = 5
    db_max_overflow: int = 5
    db_pool_timeout: float = 15.0
    db_pool_recycle: int = 1800

    # AI & Model Providers
    google_api_key: str = ""
    groq_api_key: str = ""
    cohere_api_key: str = ""

    # LangChain & LangSmith
    langsmith_tracing: str = ""
    langsmith_endpoint: str = ""
    langsmith_api_key: str = ""
    langsmith_project: str = ""
    langchain_tracing_v2: str = ""
    langchain_api_key: str = ""
    langchain_project: str = ""
    langchain_endpoint: str = ""

    # LangGraph Checkpointing
    langgraph_database_url: str = ""

    @property
    def cors_origins(self) -> list[str]:
        return [origin.strip().rstrip("/") for origin in self.frontend_url.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
