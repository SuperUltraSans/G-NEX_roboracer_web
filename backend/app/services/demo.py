"""seed-demo 용 가짜 데이터. 실제 대회 정보가 아니므로 문구는 모두 "임시"(영어는 "Temporary")로
시작한다."""

import random
from datetime import datetime, timedelta

from sqlalchemy import delete, exists, select
from sqlalchemy.orm import Session

from app.models import (
    BracketRound,
    Match,
    MatchSlot,
    PublishedContent,
    QualifyingEvent,
    QualifyingLap,
    RuleSection,
    ScheduleItem,
    Team,
    TeamRanking,
    User,
)
from app.schemas.competition import BracketGenerate
from app.services import bracket, publishing, ranking
from app.services.leaderboard import build_leaderboard
from app.services.live_state import get_row

DEMO_TABLES = (
    MatchSlot,
    Match,
    BracketRound,
    TeamRanking,
    QualifyingEvent,
    QualifyingLap,
    Team,
    ScheduleItem,
    RuleSection,
)

VEHICLE_RULES_KO = """임시 차량 규격 본문

- 임시 규격 항목 1
- 임시 규격 항목 2

| 임시 항목 | 임시 기준 |
| --- | --- |
| 임시 크기 | 임시 값 |
| 임시 무게 | 임시 값 |

[임시 참고 링크](https://example.com)"""

VEHICLE_RULES_EN = """Temporary vehicle specification body

- Temporary specification item 1
- Temporary specification item 2

| Temporary item | Temporary limit |
| --- | --- |
| Temporary size | Temporary value |
| Temporary weight | Temporary value |

[Temporary reference link](https://example.com)"""


def is_empty(db: Session) -> bool:
    return not any(db.scalar(select(exists().select_from(model))) for model in DEMO_TABLES)


def clear(db: Session) -> None:
    live = get_row(db)
    live.phase, live.on_track_team_id, live.current_match_id = "idle", None, None
    live.message_ko = live.message_en = None
    live.bracket_frozen_at = None
    db.flush()
    for model in DEMO_TABLES:
        db.execute(delete(model))
    db.execute(delete(PublishedContent))


def _schedule(now: datetime) -> list[ScheduleItem]:
    h = timedelta(hours=1)
    rows = [
        # (시작, 종료, 제목 ko, 제목 en, 장소 ko, 장소 en, 공개)
        (now - 24 * h, now - 22 * h, "임시 참가 등록 및 검차",
         "Temporary registration and inspection", "임시 피트 구역", "Temporary pit area", True),
        (now - h / 2, now + 1.5 * h, "임시 예선 세션", "Temporary qualifying session",
         "임시 메인 트랙", "Temporary main track", True),
        (now + 2 * h, now + 3 * h, "임시 본선 8강", "Temporary quarterfinals",
         "임시 메인 트랙", "Temporary main track", True),
        (now + 3.5 * h, now + 4.5 * h, "임시 4강 및 결승", "",
         "임시 메인 트랙", None, True),
        (now + 5 * h, None, "임시 시상식", "Temporary awards ceremony",
         "임시 강당", None, True),
        (now + 24 * h, None, "임시 비공개 일정 (운영진 메모)", "", None, None, False),
    ]  # fmt: skip
    return [
        ScheduleItem(
            starts_at=start,
            ends_at=end,
            title_ko=title_ko,
            title_en=title_en,
            location_ko=loc_ko,
            location_en=loc_en,
            description_ko="임시 일정 설명" if i == 1 else None,
            description_en="Temporary session description" if i == 1 else None,
            sort_order=i,
            is_published=published,
        )
        for i, (start, end, title_ko, title_en, loc_ko, loc_en, published) in enumerate(rows)
    ]


def _rules() -> list[RuleSection]:
    rows = [
        ("임시 대회 개요", "Temporary overview", "임시 대회 개요 본문",
         "Temporary overview body", True),
        ("임시 차량 규격", "Temporary vehicle specifications", VEHICLE_RULES_KO,
         VEHICLE_RULES_EN, True),
        ("임시 예선 방식", "Temporary qualifying format", "임시 예선 방식 본문", "", True),
        ("임시 본선 방식", "Temporary main event format", "임시 본선 방식 본문",
         "Temporary main event format body", True),
        ("임시 안전 수칙", "", "임시 안전 수칙 본문", "", True),
        ("임시 비공개 초안", "", "임시 공개 전 초안", "", False),
    ]  # fmt: skip
    return [
        RuleSection(
            title_ko=title_ko,
            title_en=title_en,
            body_ko=body_ko,
            body_en=body_en,
            sort_order=i,
            is_published=published,
        )
        for i, (title_ko, title_en, body_ko, body_en, published) in enumerate(rows)
    ]


# 팀별 예선 진행: (Q1, Q2, Q3 유효 랩 수). v=유효 랩, x=무효 랩
_RUNS = [
    ("vvv", "vvv", 3),
    ("vvv", "vxvvv", 2),  # FA 달성 불가 판정
    ("vvv", "vvv", 3),  # 입력 취소 한 건
    ("vxvvv", "vvv", 2),
    ("vvv", "vvv", 1),  # 순위 강등 판정
    ("vvv", "vvv", 0),  # Q3 유효 랩 없음
    ("vvv", "vvxv", 0),  # Q2 최대 연속 2랩
    ("vvv", "vx", 0),
    ("vvxvv", "", 0),  # Q1 최대 연속 2랩
    ("vx", "", 0),
    ("xx", "", 0),
    # 12번 팀은 아직 기록이 없다
]


def _laps(teams: list[Team], recorder: User | None, now: datetime) -> list[QualifyingLap]:
    rng = random.Random(20261012)
    laps: list[QualifyingLap] = []
    recorded_at = now - timedelta(minutes=90)

    def add(
        team: Team, mission: str, status: str, lap_time_ms: int | None, reason: str | None = None
    ) -> None:
        nonlocal recorded_at
        recorded_at += timedelta(seconds=20)
        attempt_no = sum(1 for lap in laps if lap.team is team) + 1
        laps.append(
            QualifyingLap(
                team=team,
                attempt_no=attempt_no,
                mission=mission,
                lap_time_ms=lap_time_ms,
                status=status,
                void_reason=reason,
                recorded_by=recorder.id if recorder else None,
                recorded_at=recorded_at,
            )
        )

    for i, (team, (q1, q2, q3)) in enumerate(zip(teams, _RUNS, strict=False)):
        base = 38_000 + i * 850 + rng.randint(0, 60) * 10
        for mission, marks in (("Q1", q1), ("Q2", q2)):
            for mark in marks:
                add(team, mission, "valid" if mark == "v" else "invalid", None)
        if i == 2:
            add(team, "Q3", "void", base - 3_000, "데모: 계측 오류로 입력 취소")
        if q2 and q2.endswith("vvv"):
            if q3 == 0:
                add(team, "Q3", "invalid", None)
            for _ in range(q3):
                add(team, "Q3", "valid", base + rng.randint(-30, 150) * 10)
    return laps


def _judgements(teams: list[Team], recorder: User | None, now: datetime) -> list[QualifyingEvent]:
    def event(team: Team, kind: str, reason: str) -> QualifyingEvent:
        return QualifyingEvent(
            team=team,
            kind=kind,
            reason=reason,
            recorded_by=recorder.id if recorder else None,
            recorded_at=now - timedelta(minutes=30),
        )

    return [
        event(teams[1], "fa_lost", "데모: 5초 넘게 멈춤"),
        event(teams[4], "rank_drop", "데모: 사람이 경로를 고침"),
    ]


def seed_demo(db: Session, now: datetime) -> None:
    recorder = db.scalar(select(User).where(User.role == "admin", User.is_active).order_by(User.id))
    teams = [
        Team(
            name_ko=f"Mock Team {n:02d}",
            name_en=f"Mock Team {n:02d}",
            affiliation_ko="Mock University",
            affiliation_en="Mock University",
        )
        for n in range(1, 13)
    ]
    db.add_all(teams)
    db.add_all(_schedule(now))
    db.add_all(_rules())
    # 12번 팀만 아직 차량 검사 전
    for i, team in enumerate(teams[:11]):
        team.inspected_at = now - timedelta(hours=20) + timedelta(minutes=5 * i)
    db.add_all(_laps(teams, recorder, now))
    db.add_all(_judgements(teams, recorder, now))
    db.flush()

    bracket.generate(db, BracketGenerate(size=8, third_place=True), recorder)
    start = now + timedelta(hours=2)
    matches = db.scalars(
        select(Match).join(Match.round).order_by(BracketRound.sort_order, Match.sort_order)
    )
    for i, match in enumerate(matches):
        match.scheduled_at = start + timedelta(minutes=15 * i)
    # 데모 랭킹은 예선 자동 순위로 넣고(실제로는 운영진이 확인해 저장한다), 그 순위로 시드를 채운다
    order = [row.team.id for row in build_leaderboard(db).rows if row.rank is not None]
    ranking.write_ranking(db, order, recorder)
    bracket.seed_from_ranking(db, recorder)

    live = get_row(db)
    live.phase = "qualifying"
    live.on_track_team_id = teams[10].id
    live.current_match_id = None
    live.message_ko = "임시 운영 공지 문구"
    live.message_en = "Temporary operations notice"
    db.flush()
    # 데모는 넣은 그대로 공개 사이트에 보이게 게시한다
    for resource in publishing.RESOURCES:
        publishing.publish(db, resource, recorder)
