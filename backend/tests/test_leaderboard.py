from datetime import UTC, datetime, timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models import QualifyingLap
from app.services.leaderboard import build_leaderboard
from tests.conftest import add_teams

LAPS = "/api/admin/qualifying/laps"
T0 = datetime(2026, 11, 1, 1, 0, tzinfo=UTC)


def record(client: TestClient, team_id: int, lap_time_ms: int | None, status: str = "valid"):
    body = {"team_id": team_id, "lap_time_ms": lap_time_ms, "status": status}
    return client.post(LAPS, json=body)


def insert_laps(db: Session, rows: list[tuple[int, int | None, str, int]]) -> None:
    """(team_id, lap_time_ms, status, 분) — 분은 T0 기준 기록 시각."""
    attempts: dict[int, int] = {}
    for team_id, lap_time_ms, status, minute in rows:
        attempts[team_id] = attempts.get(team_id, 0) + 1
        db.add(
            QualifyingLap(
                team_id=team_id,
                attempt_no=attempts[team_id],
                lap_time_ms=lap_time_ms,
                status=status,
                void_reason="test" if status == "void" else None,
                recorded_at=T0 + timedelta(minutes=minute),
            )
        )
    db.commit()


# ---- 랩타임 입력 검증 ----


@pytest.mark.parametrize(
    ("lap_time_ms", "status", "expected"),
    [
        (999, "valid", 422),
        (1_000, "valid", 201),
        (600_000, "valid", 201),
        (600_001, "valid", 422),
        (None, "valid", 422),
        (0, "dsq", 422),
        (None, "dsq", 201),
        (45_000, "dsq", 201),
        (None, "dnf", 201),
        (42_000, "void", 422),
        (42_000, "unknown", 422),
    ],
)
def test_lap_time_validation(
    app: FastAPI, admin_client: TestClient, lap_time_ms: int | None, status: str, expected: int
) -> None:
    [team_id] = add_teams(app, 1)
    response = record(admin_client, team_id, lap_time_ms, status)
    assert response.status_code == expected, response.text
    if expected == 422:
        assert response.json()["code"] == "VALIDATION_ERROR"


def test_dnf_drops_lap_time_and_attempts_increment(app: FastAPI, admin_client: TestClient) -> None:
    team_a, team_b = add_teams(app, 2)
    first = record(admin_client, team_a, 42_000).json()
    dnf = record(admin_client, team_a, 41_000, "dnf").json()
    other = record(admin_client, team_b, 43_000).json()
    assert (first["attempt_no"], dnf["attempt_no"], other["attempt_no"]) == (1, 2, 1)
    assert dnf["lap_time_ms"] is None
    assert first["recorded_by_username"] == "admin1"
    assert first["team"]["car_number"] == 1

    voided = admin_client.post(f"{LAPS}/{first['id']}/void", json={"reason": "임시 사유"})
    assert voided.status_code == 200
    # 무효 기록도 시도 번호를 차지한다
    assert record(admin_client, team_a, 40_000).json()["attempt_no"] == 3


def test_unknown_or_inactive_team_rejected(app: FastAPI, admin_client: TestClient) -> None:
    add_teams(app, 2, inactive=(2,))
    assert record(admin_client, 2, 42_000).status_code == 422
    assert record(admin_client, 99, 42_000).status_code == 422


def test_update_and_void_rules(app: FastAPI, admin_client: TestClient) -> None:
    [team_id] = add_teams(app, 1)
    lap = record(admin_client, team_id, 42_000).json()
    url = f"{LAPS}/{lap['id']}"

    edited = admin_client.patch(url, json={"version": 1, "lap_time_ms": 41_500})
    assert edited.status_code == 200
    assert (edited.json()["lap_time_ms"], edited.json()["version"]) == (41_500, 2)
    stale = admin_client.patch(url, json={"version": 1, "lap_time_ms": 41_000})
    assert stale.status_code == 409 and stale.json()["code"] == "VERSION_CONFLICT"
    assert admin_client.patch(url, json={"version": 2, "lap_time_ms": 600_001}).status_code == 422
    assert admin_client.patch(url, json={"version": 2, "status": "void"}).status_code == 422

    as_dnf = admin_client.patch(url, json={"version": 2, "status": "dnf"}).json()
    assert (as_dnf["status"], as_dnf["lap_time_ms"]) == ("dnf", None)
    # DNF 를 정상으로 되돌리려면 랩타임이 필요하다
    assert admin_client.patch(url, json={"version": 3, "status": "valid"}).status_code == 422
    back = admin_client.patch(url, json={"version": 3, "status": "valid", "lap_time_ms": 42_100})
    assert back.status_code == 200

    assert admin_client.post(f"{url}/void", json={"reason": "  "}).status_code == 422
    assert admin_client.post(f"{url}/void", json={"reason": "x", "version": 1}).status_code == 409
    voided = admin_client.post(f"{url}/void", json={"reason": "임시 계측 오류", "version": 4})
    assert voided.status_code == 200
    assert (voided.json()["status"], voided.json()["void_reason"]) == ("void", "임시 계측 오류")
    assert admin_client.post(f"{url}/void", json={"reason": "again"}).status_code == 422
    assert admin_client.patch(url, json={"version": 5, "lap_time_ms": 40_000}).status_code == 422
    assert admin_client.post(f"{LAPS}/999/void", json={"reason": "x"}).status_code == 404


def test_recent_laps_list(app: FastAPI, admin_client: TestClient) -> None:
    team_a, team_b = add_teams(app, 2)
    for ms in (41_000, 42_000, 43_000):
        record(admin_client, team_a, ms)
    record(admin_client, team_b, 44_000)
    laps = admin_client.get(LAPS).json()
    assert [lap["lap_time_ms"] for lap in laps] == [44_000, 43_000, 42_000, 41_000]
    assert [lap["lap_time_ms"] for lap in admin_client.get(LAPS, params={"limit": 2}).json()] == [
        44_000,
        43_000,
    ]
    only_a = admin_client.get(LAPS, params={"team_id": team_a}).json()
    assert {lap["team_id"] for lap in only_a} == {team_a}


# ---- 리더보드 ----


def test_leaderboard_sorting_and_exclusions(app: FastAPI, db: Session) -> None:
    t1, t2, t3, t4, t5, t6 = add_teams(app, 6, inactive=(6,))
    insert_laps(
        db,
        [
            (t1, 45_000, "valid", 1),
            (t1, 41_000, "valid", 5),  # t1 최고
            (t1, 30_000, "void", 6),  # 무효는 제외
            (t2, 40_000, "valid", 2),  # 1위
            (t2, None, "dnf", 3),
            (t3, 35_000, "dsq", 1),  # 실격 기록은 제외
            (t3, 43_000, "valid", 4),
            (t4, None, "dnf", 1),  # 기록 없음
            (t6, 39_000, "valid", 1),  # 비활성 팀은 제외
        ],
    )
    board = build_leaderboard(db)
    assert board.scoring == "best_lap"
    rows = [(r.rank, r.team.car_number, r.best_lap_ms, r.gap_ms, r.attempts) for r in board.rows]
    assert rows == [
        (1, 2, 40_000, 0, 2),
        (2, 1, 41_000, 1_000, 2),
        (3, 3, 43_000, 3_000, 2),
        # 기록 없는 팀은 맨 아래에 차량 번호 순
        (None, 4, None, None, 1),
        (None, 5, None, None, 0),
    ]
    assert board.rows[1].last_recorded_at == T0 + timedelta(minutes=5)
    assert board.rows[4].last_recorded_at is None


def test_leaderboard_tie_goes_to_earlier_record(app: FastAPI, db: Session) -> None:
    t1, t2, t3 = add_teams(app, 3)
    insert_laps(
        db,
        [
            (t1, 41_000, "valid", 10),
            (t2, 41_000, "valid", 5),  # 같은 기록을 먼저 냄
            (t3, 41_000, "valid", 10),  # t1 과 시각도 같으면 먼저 입력된 기록(id) 순
        ],
    )
    board = build_leaderboard(db)
    assert [(r.rank, r.team.car_number, r.gap_ms) for r in board.rows] == [
        (1, 2, 0),
        (2, 1, 0),
        (3, 3, 0),
    ]


def test_leaderboard_endpoint_follows_api_changes(app: FastAPI, admin_client: TestClient) -> None:
    t1, t2 = add_teams(app, 2)
    record(admin_client, t1, 42_000)
    fast = record(admin_client, t2, 41_000).json()
    board = admin_client.get("/api/qualifying/leaderboard")
    assert board.headers["cache-control"] == "no-store"
    assert [r["team"]["id"] for r in board.json()["rows"]] == [t2, t1]

    admin_client.post(f"{LAPS}/{fast['id']}/void", json={"reason": "임시"})
    rows = admin_client.get("/api/qualifying/leaderboard").json()["rows"]
    assert [(r["rank"], r["team"]["id"], r["attempts"]) for r in rows] == [
        (1, t1, 1),
        (None, t2, 0),
    ]
