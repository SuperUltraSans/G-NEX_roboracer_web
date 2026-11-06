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
    # 같은 호스트의 서브패스에 배포할 때 쿠키 범위를 좁히기 위해 둔다.
    cookie_path: str = "/"
    event_timezone: str = "Asia/Seoul"
    frontend_dist: Path = Path("../frontend/dist")
    # 규칙 섹션을 Markdown 문서(rules.ko.md, rules.en.md)로 두는 폴더. 볼륨(data/) 안에 둔다.
    rules_dir: Path = Path("./data/rules")
    cors_origins: Annotated[list[str], NoDecode] = []
    log_level: str = "info"
    # 검색엔진용: 공개 주소(끝에 / 를 붙인 사이트 주소, 예: https://example.com/roboracer/).
    # 엣지가 경로 앞부분을 떼고 넘기므로 앱은 자기 주소를 모른다.
    # 비우면 대표 주소(canonical)·사이트맵을 내지 않는다
    public_url: str | None = None
    # 구글 서치 콘솔·네이버 서치어드바이저 소유 확인 값 (meta 태그의 content)
    google_site_verification: str | None = None
    naver_site_verification: str | None = None

    @field_validator("public_url")
    @classmethod
    def check_public_url(cls, value: str | None) -> str | None:
        if not value:
            return None
        if not value.startswith(("https://", "http://")):
            raise ValueError("PUBLIC_URL 은 http(s):// 로 시작해야 합니다")
        return value if value.endswith("/") else value + "/"

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
