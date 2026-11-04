from datetime import datetime
from typing import Annotated, Any, Literal
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


PageKey = Literal["schedule", "rules", "live"]
PAGE_KEYS: tuple[PageKey, ...] = ("schedule", "rules", "live")


class PageState(BaseModel):
    """공개 페이지 하나의 열림 상태. 닫으면 공개 화면에 내용 대신 안내 문구를 보여 준다."""

    open: bool
    # 닫혔을 때 보일 문구 (예: 작업 중, 11월 1일 공개). 비우면 화면의 기본 문구를 쓴다
    note_ko: ShortText = None
    note_en: ShortText = None


class PageStates(BaseModel):
    """일정, 규칙, 모니터링 페이지의 열림 상태. 저장할 때는 세 페이지를 모두 보낸다."""

    schedule: PageState
    rules: PageState
    live: PageState


class PublicSettings(BaseModel):
    apply_form_url: str | None
    apply_open_at: datetime | None
    apply_close_at: datetime | None
    # 마감 시각이 아직 정해지지 않아 날짜만 보일 때 true (마감은 그날 23:59 로 저장한다)
    apply_close_date_only: bool
    pages: PageStates
    event_timezone: str


class AdminSettings(BaseModel):
    apply_form_url: str | None
    apply_open_at: datetime | None
    apply_close_at: datetime | None
    apply_close_date_only: bool
    # 모니터링 관리 주소의 비밀 값 (관리자에게만 보인다). 없으면 그 주소를 쓸 수 없다
    monitor_key: str | None
    pages: PageStates


MonitorKey = Annotated[
    str,
    StringConstraints(strip_whitespace=True, pattern=r"^[A-Za-z0-9_-]{6,64}$"),
]


class MonitorKeyUpdate(BaseModel):
    key: MonitorKey | None = Field(
        description="영문, 숫자, _ - 로 6~64자. null 이면 모니터링 관리 주소를 막는다"
    )


class AdminSettingsUpdate(BaseModel):
    apply_form_url: HttpsUrl = None
    apply_open_at: AwareDatetime | None = None
    apply_close_at: AwareDatetime | None = None
    apply_close_date_only: bool = False

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


RuleLevel = Literal[1, 2]


class RuleSectionPublic(ORMModel):
    id: int
    title_ko: str
    title_en: str
    body_ko: str
    body_en: str
    sort_order: int
    # 1 = 장(# 큰 제목), 2 = 절(## 섹션). 예전에 게시한 공개본에는 없어서 기본값을 둔다
    level: RuleLevel = 2
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
            "{line}번째 줄처럼 # 이나 ## 로 시작하는 제목은 본문에 쓸 수 없습니다."
            " 규칙 문서에서 장·절을 나누는 표시이니 소제목은 ### 로 쓰세요",
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
    level: RuleLevel = 2


class RuleSectionUpdate(BaseModel):
    version: int
    title_ko: Title = None
    title_en: TitleEn = None
    body_ko: RuleBody = None
    body_en: RuleBody = None
    sort_order: int = None
    is_published: bool = None
    level: RuleLevel = None


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


# ---- 게시 ----

PublishResource = Literal["schedule", "rules", "settings"]


class PublishState(BaseModel):
    resource: PublishResource
    pending: bool = Field(description="고쳤지만 아직 게시하지 않은 것이 있는지")
    published_at: datetime | None
    published_by: str | None = Field(description="게시한 계정 (서버가 처음 만든 것이면 null)")


# ---- 일정 문서 ----


class ScheduleDocument(BaseModel):
    filename: str
    markdown: str


class ScheduleDocumentImport(BaseModel):
    markdown: Markdown = Field(
        description="'## 2026-11-01' 날짜 줄 아래 '### 09:00-10:00 제목' 으로 일정을 쓴 문서"
    )


class ScheduleImportResult(BaseModel):
    created: int
    deleted: int
    items: list[ScheduleItemAdmin]
