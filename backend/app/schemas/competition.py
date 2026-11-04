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

# 대회에 참가할 수 있는 팀 수 (활성 팀). 비활성 팀은 세지 않는다
MAX_ACTIVE_TEAMS = 15

LAP_TIME_MIN_MS = 1_000
LAP_TIME_MAX_MS = 600_000
# 랩타임은 0.01초 단위 (계시원 두 명의 평균을 소수 셋째 자리에서 반올림, 규칙 4.1.2)
LAP_TIME_STEP_MS = 10

LapTimeMs = Annotated[
    int, Field(ge=LAP_TIME_MIN_MS, le=LAP_TIME_MAX_MS, multiple_of=LAP_TIME_STEP_MS)
]
# valid: 유효 랩, invalid: 무효 랩(충돌·사람 개입 등, 연속 랩이 끊긴다), void: 입력 취소
LapStatus = Literal["valid", "invalid", "void"]
LapInputStatus = Literal["valid", "invalid"]
Mission = Literal["Q1", "Q2", "Q3"]
# fa_lost: FA 달성 불가 판정, rank_drop: 최종 예선 순위 1단계 강등
QualifyingEventKind = Literal["fa_lost", "rank_drop"]
MatchStatus = Literal["scheduled", "live", "finished"]
# 대상 · 최우수상 · 우수상
AwardKind = Literal["grand", "excellence", "merit"]
# practice 는 그룹 연습, free_practice 는 자유 연습
Phase = Literal[
    "idle", "mapping", "practice", "free_practice", "qualifying", "bracket", "break", "finished"
]
MatchLabel = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=20)]
SlotCount = Annotated[int, Field(ge=1, le=16)]


# ---- 팀 ----


class TeamPublic(ORMModel):
    id: int
    name_ko: str
    name_en: str
    affiliation_ko: str | None
    affiliation_en: str | None


class TeamAdmin(TeamPublic):
    is_active: bool
    version: int
    created_at: datetime
    updated_at: datetime


class TeamCreate(BaseModel):
    name_ko: Title
    name_en: TitleEn = ""
    affiliation_ko: ShortText = None
    affiliation_en: ShortText = None
    is_active: bool = True


class TeamUpdate(BaseModel):
    version: int
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
    mission: Mission
    lap_time_ms: int | None
    status: LapStatus
    void_reason: str | None
    recorded_at: datetime
    recorded_by_username: str | None
    version: int
    updated_at: datetime


def _q3_needs_time(mission: str | None, status: str | None, lap_time_ms: int | None) -> None:
    if mission == "Q3" and status == "valid" and lap_time_ms is None:
        raise ValueError("Q3 의 유효 랩에는 랩타임이 필요합니다")


class QualifyingLapCreate(BaseModel):
    team_id: int
    mission: Mission | None = Field(
        default=None,
        description="비우면 서버가 그 팀이 지금 하는 미션으로 정한다 (연속 3랩이면 다음 미션)",
    )
    status: LapInputStatus
    lap_time_ms: LapTimeMs | None = Field(default=None, description="Q3 의 유효 랩은 꼭 필요")

    @model_validator(mode="after")
    def _lap_time_rule(self) -> "QualifyingLapCreate":
        _q3_needs_time(self.mission, self.status, self.lap_time_ms)
        return self


class QualifyingLapUpdate(BaseModel):
    version: int
    mission: Mission = None
    status: LapInputStatus = None
    lap_time_ms: LapTimeMs | None = None


class QualifyingLapVoid(BaseModel):
    reason: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=500)]
    version: int | None = Field(default=None, description="보내면 낙관적 잠금을 검사한다")


class QualifyingEventAdmin(ORMModel):
    id: int
    team_id: int
    team: TeamPublic
    kind: QualifyingEventKind
    reason: str
    recorded_at: datetime
    recorded_by_username: str | None


class QualifyingEventCreate(BaseModel):
    team_id: int
    kind: QualifyingEventKind
    reason: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]


class InspectionEntry(BaseModel):
    team: TeamPublic
    inspected_at: datetime | None
    inspection_order: int | None = Field(
        default=None, description="관리자가 직접 적은 검차 완료 순서. 없으면 null"
    )
    order: int | None = Field(
        description="검사를 마친 순서 (1부터). 직접 적은 순서, 없으면 검사 시각 순. 아직이면 null"
    )


class InspectionUpdate(BaseModel):
    done: bool = Field(description="true 면 지금 시각으로 검사 완료, false 면 취소")


class InspectionOrderItem(BaseModel):
    team_id: int
    order: Annotated[int, Field(ge=1, le=MAX_ACTIVE_TEAMS)] | None = Field(
        description="검차 완료 순서. null 이면 지운다"
    )


class InspectionOrderUpdate(BaseModel):
    items: list[InspectionOrderItem] = Field(
        max_length=MAX_ACTIVE_TEAMS, description="고칠 팀만 보내도 된다"
    )


class LeaderboardRow(BaseModel):
    """규칙 4.7 의 예선 순위 한 줄. 순위는 FA → 통과한 미션 수 → 마지막 미션 기록 → 검사 순서,
    그 뒤 강등을 반영한다."""

    rank: int | None = Field(description="아직 기록이 없는 팀은 null")
    team: TeamPublic
    inspection_order: int | None = Field(
        default=None, description="관리자가 직접 적은 검차 완료 순서. 없으면 null"
    )
    run_order: int | None = Field(
        default=None, description="예선 출전 순서 (동결한 맵핑 순서, 1부터). 정하기 전이면 null"
    )
    fa: bool = Field(description="Q1·Q2·Q3 을 모두 통과했고 FA 달성 불가 판정이 없다")
    fa_lost: bool
    missions_passed: int = Field(ge=0, le=3)
    current_mission: Mission = Field(description="지금 기록을 쌓는 미션 (모두 통과했으면 Q3)")
    current_streak: int = Field(description="지금 미션의 끝에서부터 이어지는 유효 랩 수")
    q1_laps: int | None = Field(description="Q1 최대 연속 유효 랩 (최대 3). 기록이 없으면 null")
    q2_laps: int | None = Field(description="Q2 최대 연속 유효 랩. Q1 을 통과하지 못했으면 null")
    q3_best_ms: int | None = Field(description="Q3 최고 유효 랩타임")
    rank_drops: int
    attempts: int
    last_recorded_at: datetime | None


class Leaderboard(BaseModel):
    scoring: Literal["rules"]
    rows: list[LeaderboardRow]


# ---- 대회 결과 (시상) ----


class ResultEntry(BaseModel):
    award: AwardKind
    teams: list[TeamPublic] = Field(description="이 상을 받은 팀 (적은 순서대로)")


class Results(BaseModel):
    entries: list[ResultEntry] = Field(
        description="대상 → 최우수상 → 우수상 순. 받은 팀이 없는 상은 빠지고, 아직 없으면 빈 목록"
    )


class AwardItem(BaseModel):
    team_id: int
    award: AwardKind


# ---- 랭킹 (운영진이 직접 정한 순위) ----


class RankingEntry(BaseModel):
    rank: int
    team: TeamPublic


class Ranking(BaseModel):
    entries: list[RankingEntry]
    updated_at: datetime | None = Field(description="마지막으로 저장한 때 (없으면 null)")


class RankingUpdate(BaseModel):
    team_ids: list[int] = Field(
        max_length=MAX_ACTIVE_TEAMS,
        description="1위부터 차례로 팀 ID. 빠진 팀은 순위 없음으로 둔다",
    )


# ---- 모니터링 관리 ----


class MonitorAccess(BaseModel):
    via: Literal["key", "session"] = Field(description="key: 모니터링 관리 주소, session: 로그인")
    username: str


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


class BracketSlotSwap(BaseModel):
    """두 칸의 자리를 바꾼다 (관리자 화면에서 끌어 놓기)."""

    slot_id: int
    target_slot_id: int
    version: int = Field(description="slot_id 칸이 속한 매치의 version")
    target_version: int = Field(description="target_slot_id 칸이 속한 매치의 version")


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
    # 참가 팀이 최대 15팀이므로 16강까지
    size: Literal[2, 4, 8, 16]
    third_place: bool = Field(default=False, description="3·4위전 추가")


# ---- 진행 상태 ----


class LiveMatchRef(ORMModel):
    id: int
    label: str


class MappingEntry(BaseModel):
    order: int = Field(description="맵핑 순서 (1부터)")
    team: TeamPublic
    mapped_at: datetime | None = Field(description="맵핑을 마친 시각. 아직이면 null")


class QualifyingOrderUpdate(BaseModel):
    team_ids: list[int] = Field(
        max_length=MAX_ACTIVE_TEAMS, description="예선 출전 순서대로 참가 중인 팀 ID 를 모두"
    )


class MappingUpdate(BaseModel):
    done: bool = Field(description="true 면 지금 시각으로 맵핑 완료, false 면 취소")


PracticeGroupName = Literal["A", "B", "C"]


class PracticeMember(BaseModel):
    team: TeamPublic
    chosen_at: datetime | None = Field(description="조를 고른 시각")


class PracticeGroup(BaseModel):
    name: PracticeGroupName
    capacity: int = Field(description="이 조에 들어갈 수 있는 팀 수")
    starts_at: AwareDatetime = Field(description="이 조의 연습 시작 시각")
    ends_at: AwareDatetime = Field(description="이 조의 연습 끝 시각")
    teams: list[PracticeMember] = Field(description="고른 순서대로")


class PracticeUpdate(BaseModel):
    group: PracticeGroupName | None = Field(description="고른 조. null 이면 빼기")


class LiveState(ORMModel):
    phase: Phase
    on_track_team: TeamPublic | None
    current_match: LiveMatchRef | None
    message_ko: str | None
    message_en: str | None
    updated_at: datetime
    mapping: list[MappingEntry] = Field(
        default_factory=list, description="맵핑 순서. 아직 섞지 않았으면 빈 목록"
    )
    mapping_frozen: bool = Field(
        default=False, description="맵핑 순서를 동결해 예선 순서로 쓰는 중 (더는 바꿀 수 없다)"
    )
    bracket_frozen: bool = Field(
        default=False, description="본선 결과를 동결함 (대진·결과를 더는 바꿀 수 없다)"
    )
    practice: list[PracticeGroup] = Field(default_factory=list, description="그룹 연습 조")


class LiveStateUpdate(BaseModel):
    phase: Phase
    on_track_team_id: int | None = None
    current_match_id: int | None = None
    message_ko: Notice = None
    message_en: Notice = None
