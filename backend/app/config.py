from functools import lru_cache
from pathlib import Path
from typing import Annotated, Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_env: Literal["development", "production"] = "development"
    database_url: str = "sqlite:///./data/roboracer.db"
    session_ttl_hours: int = 12
    cookie_secure: bool = False
    # 지시서는 Path=/ 이지만, 같은 호스트의 서브패스에 배포할 때 쿠키 범위를 좁히기 위해 둔다.
    cookie_path: str = "/"
    event_timezone: str = "Asia/Seoul"
    frontend_dist: Path = Path("../frontend/dist")
    # 규칙 섹션을 Markdown 문서(rules.ko.md, rules.en.md)로 두는 폴더. 볼륨(data/) 안에 둔다.
    rules_dir: Path = Path("./data/rules")
    cors_origins: Annotated[list[str], NoDecode] = []
    log_level: str = "info"

    @field_validator("cors_origins", mode="before")
    @classmethod
    def split_origins(cls, value: object) -> object:
        if isinstance(value, str):
            return [origin.strip() for origin in value.split(",") if origin.strip()]
        return value

    @field_validator("event_timezone")
    @classmethod
    def check_timezone(cls, value: str) -> str:
        try:
            ZoneInfo(value)
        except (ZoneInfoNotFoundError, ValueError) as exc:
            raise ValueError(f"알 수 없는 시간대입니다: {value}") from exc
        return value

    @property
    def is_production(self) -> bool:
        return self.app_env == "production"


@lru_cache
def get_settings() -> Settings:
    return Settings()
