from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "Izge Backend"
    api_prefix: str = "/api"
    workspace_name: str = "Default Workspace"
    workspace_description: str = "Single-workspace institutional memory environment"
    default_admin_email: str = "admin@example.com"
    default_admin_password: str | None = "change-me-admin"
    default_admin_display_name: str = "Local Admin"
    sync_default_admin_password: bool = False
    sqlite_path: str = "./data/izge.db"
    storage_root: str = "./data/storage"
    pasted_text_root: str = "./data/pasted"
    bootstrap_admin_credentials_path: str = "./data/bootstrap_admin_credentials.json"
    token_ttl_hours: int = 24
    chunk_size: int = 1200
    chunk_overlap: int = 120
    max_upload_bytes: int = 10 * 1024 * 1024
    local_llm_enabled: bool = False
    local_llm_base_url: str = "http://127.0.0.1:11434"
    local_llm_model: str = "qwen3.5:4b"
    local_llm_timeout_seconds: int = 60
    llm_signal_explanation_enabled: bool = False
    llm_query_routing_enabled: bool = False
    llm_answer_synthesis_enabled: bool = False

    model_config = SettingsConfigDict(env_prefix="IZGE_", env_file=".env", extra="ignore")

    @property
    def sqlite_url(self) -> str:
        return f"sqlite:///{Path(self.sqlite_path).resolve()}"

    @property
    def storage_path(self) -> Path:
        return Path(self.storage_root).resolve()

    @property
    def pasted_storage_path(self) -> Path:
        return Path(self.pasted_text_root).resolve()

    @property
    def bootstrap_admin_credentials_file(self) -> Path:
        return Path(self.bootstrap_admin_credentials_path).resolve()


@lru_cache
def get_settings() -> Settings:
    return Settings()
