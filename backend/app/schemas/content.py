from datetime import datetime
from typing import Annotated, Any
from urllib.parse import urlsplit

from pydantic import (
    AfterValidator,
    AwareDatetime,
    BaseModel,
    BeforeValidator,
    Field,
    StringConstraints,
    model_validator,
)
from pydantic_core import PydanticCustomError

from app.schemas.common import LongText, Markdown, ORMModel, ShortText, Title, TitleEn
from app.services.rules_markdown import Lang, section_heading_lines


def _https_url(value: Any) -> Any:
    if not isinstance(value, str):
        return value
    value = value.strip()
    if not value:
        return None
    parts = urlsplit(value)
    if parts.scheme != "https" or not parts.netloc or any(c.isspace() for c in value):
        raise ValueError("https:// 로 시작하는 URL 이어야 합니다")
    return value


HttpsUrl = Annotated[
    Annotated[str, StringConstraints(max_length=2000)] | None, BeforeValidator(_https_url)
]


def _check_period(start: datetime | None, end: datetime | None, message: str) -> None:
    if start is not None and end is not None and end <= start:
        raise ValueError(message)


class PublicSettings(BaseModel):
    apply_form_url: str | None
    apply_open_at: datetime | None
    apply_close_at: datetime | None
    event_timezone: str


class AdminSettings(BaseModel):
    apply_form_url: str | None
    apply_open_at: datetime | None
    apply_close_at: datetime | None


class AdminSettingsUpdate(BaseModel):
    apply_form_url: HttpsUrl = None
    apply_open_at: AwareDatetime | None = None
    apply_close_at: AwareDatetime | None = None

    @model_validator(mode="after")
    def _period(self) -> "AdminSettingsUpdate":
        _check_period(self.apply_open_at, self.apply_close_at, "접수 마감은 시작보다 뒤여야 합니다")
        return self


class ScheduleItemPublic(ORMModel):
    id: int
    starts_at: datetime
    ends_at: datetime | None
    title_ko: str
    title_en: str
    location_ko: str | None
    location_en: str | None
    description_ko: str | None
    description_en: str | None
    sort_order: int
    updated_at: datetime


class ScheduleItemAdmin(ScheduleItemPublic):
    is_published: bool
    version: int
    created_at: datetime


class ScheduleItemCreate(BaseModel):
    starts_at: AwareDatetime
    ends_at: AwareDatetime | None = None
    title_ko: Title
    title_en: TitleEn = ""
    location_ko: ShortText = None
    location_en: ShortText = None
    description_ko: LongText = None
    description_en: LongText = None
    sort_order: int | None = Field(default=None, description="생략하면 맨 뒤")
    is_published: bool = True

    @model_validator(mode="after")
    def _period(self) -> "ScheduleItemCreate":
        _check_period(self.starts_at, self.ends_at, "종료 시각은 시작 시각보다 뒤여야 합니다")
        return self


class ScheduleItemUpdate(BaseModel):
    version: int
    starts_at: AwareDatetime = None
    ends_at: AwareDatetime | None = None
    title_ko: Title = None
    title_en: TitleEn = None
    location_ko: ShortText = None
    location_en: ShortText = None
    description_ko: LongText = None
    description_en: LongText = None
    sort_order: int = None
    is_published: bool = None


class RuleSectionPublic(ORMModel):
    id: int
    title_ko: str
    title_en: str
    body_ko: str
    body_en: str
    sort_order: int
    updated_at: datetime


class RuleSectionAdmin(RuleSectionPublic):
    is_published: bool
    version: int
    created_at: datetime


def _no_section_headings(value: str) -> str:
    lines = section_heading_lines(value)
    if lines:
        raise PydanticCustomError(
            "rule_body_section_heading",
            "{line}번째 줄처럼 ## 로 시작하는 제목은 본문에 쓸 수 없습니다."
            " ## 는 규칙 문서에서 섹션을 나누는 표시이니 소제목은 ### 로 쓰세요",
            {"line": lines[0]},
        )
    return value


# 규칙 Markdown 문서(services/rules_markdown.py)로 그대로 옮길 수 있는 본문
RuleBody = Annotated[Markdown, AfterValidator(_no_section_headings)]


class RuleSectionCreate(BaseModel):
    title_ko: Title
    title_en: TitleEn = ""
    body_ko: RuleBody = ""
    body_en: RuleBody = ""
    sort_order: int | None = Field(default=None, description="생략하면 맨 뒤")
    is_published: bool = True


class RuleSectionUpdate(BaseModel):
    version: int
    title_ko: Title = None
    title_en: TitleEn = None
    body_ko: RuleBody = None
    body_en: RuleBody = None
    sort_order: int = None
    is_published: bool = None


class RulesDocument(BaseModel):
    lang: Lang
    filename: str = Field(description="서버의 파일 이름 (rules.ko.md, rules.en.md)")
    markdown: str


class RulesDocumentImport(BaseModel):
    lang: Lang
    markdown: str = Field(
        description="`## 제목` 줄로 섹션을 나눈 Markdown 문서. 비공개 섹션은 제목 바로 아래에"
        " `<!-- hidden -->` (한국어 문서만)"
    )


class RulesImportResult(BaseModel):
    lang: Lang
    created: int
    updated: int
    deleted: int
    sections: list[RuleSectionAdmin]
    assets: int = Field(description="올린 문서가 쓰는 그림 수")
    warnings: list[str] = Field(
        description="적용은 했지만 확인할 것: 찾지 못한 그림 주소, 넣지 않은 파일 등"
    )
