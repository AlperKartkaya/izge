from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "İzge"
    api_prefix: str = "/api"
    workspace_name: str = "Şirket Çalışma Alanı"
    workspace_description: str = "Şirket kararları, işler ve kurumsal hafıza"
    default_admin_email: str = "admin@example.com"
    default_admin_password: str | None = None
    default_admin_display_name: str = "Şirket Yöneticisi"
    sqlite_path: str = "./data/izge.db"
    storage_root: str = "./data/storage"
    pasted_text_root: str = "./data/pasted"
    bootstrap_admin_credentials_path: str = "./data/bootstrap_admin_credentials.json"
    token_ttl_hours: int = 24
    auth_rate_limit_window_seconds: int = 300
    auth_rate_limit_max_attempts: int = 8
    session_cookie_name: str = "izge_session"
    chunk_size: int = 1200
    chunk_overlap: int = 120
    max_upload_bytes: int = 10 * 1024 * 1024
    max_pasted_text_bytes: int = 2 * 1024 * 1024
    max_pdf_pages: int = 50
    max_extracted_text_chars: int = 500_000
    local_llm_enabled: bool = False
    local_llm_base_url: str = "http://127.0.0.1:11434"
    local_llm_model: str = "qwen3.5:9b"
    local_llm_timeout_seconds: int = 60
    agent_model_provider: Literal["ollama", "onprem", "glm", "deepseek", "codex"] = "ollama"
    agent_model_effort: Literal["none", "low", "medium", "high", "xhigh", "max"] = "none"
    agent_onprem_base_url: str | None = None
    agent_onprem_model: str | None = None
    agent_onprem_api_key: SecretStr | None = None
    agent_allow_public_onprem_url: bool = False
    agent_glm_api_key: SecretStr | None = None
    agent_deepseek_api_key: SecretStr | None = None
    agent_codex_bridge_base_url: str | None = None
    agent_codex_bridge_token: SecretStr | None = None
    agent_web_search_key: SecretStr = SecretStr("")
    agent_mcp_connectors_json: str = "[]"
    llm_signal_explanation_enabled: bool = False
    llm_query_routing_enabled: bool = False
    llm_answer_synthesis_enabled: bool = False
    allow_public_llm_base_url: bool = False
    demo_seed_enabled: bool = False
    public_demo_enabled: bool = False
    public_demo_hourly_limit: int = 10
    trust_railway_proxy: bool = False

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
