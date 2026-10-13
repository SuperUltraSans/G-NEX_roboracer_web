from datetime import datetime
from typing import Annotated, Literal

from pydantic import (
    AwareDatetime,
    BaseModel,
    Field,
    PositiveInt,
    StringConstraints,
    model_validator,
)

from app.schemas.common import Notice, ORMModel, ShortText, Title, TitleEn

LAP_TIME_MIN_MS = 1_000
LAP_TIME_MAX_MS = 600_000

LapTimeMs = Annotated[int, Field(ge=LAP_TIME_MIN_MS, le=LAP_TIME_MAX_MS)]
LapStatus = Literal["valid", "dnf", "dsq", "void"]
LapInputStatus = Literal["valid", "dnf", "dsq"]
MatchStatus = Literal["scheduled", "live", "finished"]
Phase = Literal["idle", "qualifying", "bracket", "break", "finished"]
MatchLabel = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=20)]
SlotCount = Annotated[int, Field(ge=1, le=16)]


# ---- 팀 ----


class TeamPublic(ORMModel):
    id: int
    car_number: int
    name_ko: str
    name_en: str
    affiliation_ko: str | None
    affiliation_en: str | None


class TeamAdmin(TeamPublic):
    is_active: bool
    version: int
    created_at: datetime
    updated_at: datetime


CarNumber = Annotated[int, Field(ge=0, le=9999)]


class TeamCreate(BaseModel):
    car_number: CarNumber
    name_ko: Title
    name_en: TitleEn = ""
    affiliation_ko: ShortText = None
    affiliation_en: ShortText = None
    is_active: bool = True


class TeamUpdate(BaseModel):
    version: int
    car_number: CarNumber = None
    name_ko: Title = None
    name_en: TitleEn = None
    affiliation_ko: ShortText = None
    affiliation_en: ShortText = None
    is_active: bool = None


# ---- 예선 기록 ----


class QualifyingLapAdmin(ORMModel):
    id: int
    team_id: int
    team: TeamPublic
    attempt_no: int
    lap_time_ms: int | None
    status: LapStatus
    void_reason: str | None
    recorded_at: datetime
    recorded_by_username: str | None
    version: int
    updated_at: datetime


class QualifyingLapCreate(BaseModel):
    team_id: int
    lap_time_ms: LapTimeMs | None = None
    status: LapInputStatus

    @model_validator(mode="after")
    def _lap_time_rule(self) -> "QualifyingLapCreate":
        if self.status == "valid" and self.lap_time_ms is None:
            raise ValueError("정상 기록에는 랩타임이 필요합니다")
        if self.status == "dnf":
            self.lap_time_ms = None
        return self


class QualifyingLapUpdate(BaseModel):
    version: int
    lap_time_ms: LapTimeMs | None = None
    status: LapInputStatus = None


class QualifyingLapVoid(BaseModel):
    reason: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=500)]
    version: int | None = Field(default=None, description="보내면 낙관적 잠금을 검사한다")


class LeaderboardRow(BaseModel):
    rank: int | None
    team: TeamPublic
    best_lap_ms: int | None
    gap_ms: int | None
    attempts: int
    last_recorded_at: datetime | None


class Leaderboard(BaseModel):
    scoring: Literal["best_lap"]
    rows: list[LeaderboardRow]


# ---- 대진 ----


class BracketSlot(ORMModel):
    id: int
    slot_index: int
    team: TeamPublic | None
    seed_rank: int | None
    source_match_id: int | None
    source_match_label: str | None
    source_rank: int | None
    placeholder_ko: str | None
    placeholder_en: str | None
    result_rank: int | None
    result_text: str | None


class BracketMatch(ORMModel):
    id: int
    round_id: int
    label: str
    sort_order: int
    status: MatchStatus
    scheduled_at: datetime | None
    version: int
    slots: list[BracketSlot]


class BracketRound(ORMModel):
    id: int
    name_ko: str
    name_en: str
    sort_order: int
    matches: list[BracketMatch]


class Bracket(BaseModel):
    rounds: list[BracketRound]


class BracketRoundAdmin(ORMModel):
    id: int
    name_ko: str
    name_en: str
    sort_order: int
    created_at: datetime
    updated_at: datetime


class BracketRoundCreate(BaseModel):
    name_ko: Title
    name_en: TitleEn = ""
    sort_order: int | None = Field(default=None, description="생략하면 맨 뒤")


class BracketRoundUpdate(BaseModel):
    name_ko: Title = None
    name_en: TitleEn = None
    sort_order: int = None


class BracketMatchCreate(BaseModel):
    round_id: int
    label: MatchLabel
    sort_order: int | None = Field(default=None, description="생략하면 라운드의 맨 뒤")
    scheduled_at: AwareDatetime | None = None
    slot_count: SlotCount = 2


class BracketMatchUpdate(BaseModel):
    version: int
    label: MatchLabel = None
    round_id: int = None
    sort_order: int = None
    scheduled_at: AwareDatetime | None = None
    status: Literal["scheduled", "live"] = Field(
        default=None, description="종료는 결과 입력으로만 한다"
    )
    slot_count: SlotCount = None


class BracketSlotUpdate(BaseModel):
    team_id: int | None = None
    seed_rank: PositiveInt | None = None
    source_match_id: int | None = None
    source_rank: PositiveInt | None = None
    placeholder_ko: ShortText = None
    placeholder_en: ShortText = None


class SlotResultInput(BaseModel):
    slot_id: int
    result_rank: PositiveInt
    result_text: ShortText = None


class MatchResultSubmit(BaseModel):
    version: int
    results: list[SlotResultInput] = Field(min_length=1)


class MatchReopen(BaseModel):
    version: int | None = Field(default=None, description="보내면 낙관적 잠금을 검사한다")


class BracketGenerate(BaseModel):
    format: Literal["single_elimination"] = "single_elimination"
    size: Literal[2, 4, 8, 16, 32]
    third_place: bool = Field(default=False, description="3·4위전 추가")


# ---- 진행 상태 ----


class LiveMatchRef(ORMModel):
    id: int
    label: str


class LiveState(ORMModel):
    phase: Phase
    on_track_team: TeamPublic | None
    current_match: LiveMatchRef | None
    message_ko: str | None
    message_en: str | None
    updated_at: datetime


class LiveStateUpdate(BaseModel):
    phase: Phase
    on_track_team_id: int | None = None
    current_match_id: int | None = None
    message_ko: Notice = None
    message_en: Notice = None
