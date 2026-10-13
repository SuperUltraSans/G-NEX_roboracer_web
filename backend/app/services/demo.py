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
    QualifyingLap,
    RuleSection,
    ScheduleItem,
    Team,
    User,
)
from app.schemas.competition import BracketGenerate
from app.services import bracket
from app.services.live_state import get_row

DEMO_TABLES = (MatchSlot, Match, BracketRound, QualifyingLap, Team, ScheduleItem, RuleSection)

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
    db.flush()
    for model in DEMO_TABLES:
        db.execute(delete(model))


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


def _laps(teams: list[Team], recorder: User | None, now: datetime) -> list[QualifyingLap]:
    rng = random.Random(20261012)
    laps: list[QualifyingLap] = []
    recorded_at = now - timedelta(minutes=90)

    def add(team: Team, status: str, lap_time_ms: int | None, reason: str | None = None) -> None:
        nonlocal recorded_at
        recorded_at += timedelta(minutes=2)
        attempt_no = sum(1 for lap in laps if lap.team is team) + 1
        laps.append(
            QualifyingLap(
                team=team,
                attempt_no=attempt_no,
                lap_time_ms=lap_time_ms,
                status=status,
                void_reason=reason,
                recorded_by=recorder.id if recorder else None,
                recorded_at=recorded_at,
            )
        )

    # 앞의 10팀은 정상 기록이 있고, 11번은 DNF 만, 12번은 기록이 없다.
    for i, team in enumerate(teams[:10]):
        base = 38_000 + i * 850 + rng.randint(0, 600)
        if i == 2:
            add(team, "void", base - 3_000, "데모: 계측 오류로 무효 처리")
        for attempt in range(rng.randint(2, 4)):
            if attempt > 0 and rng.random() < 0.2:
                add(team, "dnf", None)
            else:
                add(team, "valid", base + rng.randint(-300, 1_500))
    add(teams[10], "dnf", None)
    return laps


def seed_demo(db: Session, now: datetime) -> None:
    recorder = db.scalar(select(User).where(User.role == "admin", User.is_active).order_by(User.id))
    teams = [
        Team(
            car_number=n,
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
    db.add_all(_laps(teams, recorder, now))
    db.flush()

    bracket.generate(db, BracketGenerate(size=8, third_place=True), recorder)
    start = now + timedelta(hours=2)
    matches = db.scalars(
        select(Match).join(Match.round).order_by(BracketRound.sort_order, Match.sort_order)
    )
    for i, match in enumerate(matches):
        match.scheduled_at = start + timedelta(minutes=15 * i)
    bracket.seed_from_qualifying(db, recorder)

    live = get_row(db)
    live.phase = "qualifying"
    live.on_track_team_id = teams[10].id
    live.current_match_id = None
    live.message_ko = "임시 운영 공지 문구"
    live.message_en = "Temporary operations notice"
    db.flush()
