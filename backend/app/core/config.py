"""Server configuration. No credentials are sent to the browser."""

from functools import lru_cache
from pathlib import Path
from typing import Literal
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=("../.env", ".env"), extra="ignore")
    database_url: str = "postgresql://localhost/quickclinic"
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
    cloudinary_cloud_name: str = ""
    cloudinary_api_key: str = ""
    cloudinary_api_secret: str = ""
    openrouteservice_api_key: str = ""
    document_storage_backend: Literal["local", "cloudinary"] = "local"
    document_storage_dir: Path = Path("./data/medical-documents")
    git_commit: str = "unknown"

    @property
    def cors_origins(self) -> list[str]:
        return [origin.strip().rstrip("/") for origin in self.frontend_url.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
