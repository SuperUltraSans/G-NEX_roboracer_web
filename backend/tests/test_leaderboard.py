from datetime import UTC, datetime, timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models import QualifyingEvent, QualifyingLap, Team
from app.services.leaderboard import build_leaderboard
from tests.conftest import FETCH, add_teams

LAPS = "/api/admin/qualifying/laps"
EVENTS = "/api/admin/qualifying/events"
INSPECTION = "/api/admin/qualifying/inspection"
T0 = datetime(2026, 11, 1, 1, 0, tzinfo=UTC)


def record(
    client: TestClient,
    team_id: int,
    mission: str = "Q3",
    status: str = "valid",
    lap_time_ms: int | None = None,
):
    body = {"team_id": team_id, "mission": mission, "status": status, "lap_time_ms": lap_time_ms}
    return client.post(LAPS, json=body)


def insert_laps(db: Session, rows: list[tuple[int, str, str, int | None]]) -> None:
    """(team_id, mission, status, lap_time_ms) 를 이 순서대로 1분 간격으로 기록한다."""
    attempts: dict[int, int] = {}
    for minute, (team_id, mission, status, lap_time_ms) in enumerate(rows):
        attempts[team_id] = attempts.get(team_id, 0) + 1
        db.add(
            QualifyingLap(
                team_id=team_id,
                attempt_no=attempts[team_id],
                mission=mission,
                lap_time_ms=lap_time_ms,
                status=status,
                void_reason="test" if status == "void" else None,
                recorded_at=T0 + timedelta(minutes=minute),
            )
        )
    db.commit()


def run(team_id: int, q1: str = "", q2: str = "", q3: tuple[int, ...] = ()) -> list[tuple]:
    """v=유효 랩, x=무효 랩. q3 는 유효 랩타임들."""
    laps: list[tuple] = []
    for mission, marks in (("Q1", q1), ("Q2", q2)):
        laps += [(team_id, mission, "valid" if m == "v" else "invalid", None) for m in marks]
    laps += [(team_id, "Q3", "valid", ms) for ms in q3]
    return laps


def summary(db: Session) -> list[tuple]:
    return [
        (r.rank, r.team.id, r.fa, r.missions_passed, r.q1_laps, r.q2_laps, r.q3_best_ms)
        for r in build_leaderboard(db).rows
    ]


# ---- 랩 입력 검증 ----


@pytest.mark.parametrize(
    ("mission", "status", "lap_time_ms", "expected"),
    [
        ("Q3", "valid", None, 422),  # Q3 유효 랩은 랩타임이 기록
        ("Q3", "valid", 999, 422),
        ("Q3", "valid", 1_000, 201),
        ("Q3", "valid", 600_000, 201),
        ("Q3", "valid", 600_001, 422),
        ("Q3", "valid", 42_140, 201),  # 0.01초 단위
        ("Q3", "valid", 42_137, 422),  # 0.001초 단위는 받지 않는다
        ("Q3", "invalid", None, 201),
        ("Q1", "valid", None, 201),  # Q1·Q2 는 랩타임 없이 유효·무효만
        ("Q2", "invalid", None, 201),
        ("Q2", "valid", 41_000, 201),
        ("Q1", "void", None, 422),  # 입력 취소는 따로
        ("Q1", "dnf", None, 422),
        ("Q4", "valid", None, 422),
    ],
)
def test_lap_input_validation(
    app: FastAPI,
    admin_client: TestClient,
    mission: str,
    status: str,
    lap_time_ms: int | None,
    expected: int,
) -> None:
    [team_id] = add_teams(app, 1)
    response = record(admin_client, team_id, mission, status, lap_time_ms)
    assert response.status_code == expected, response.text
    if expected == 422:
        assert response.json()["code"] == "VALIDATION_ERROR"
    else:
        assert response.json()["mission"] == mission


def test_attempts_increment_across_missions(app: FastAPI, admin_client: TestClient) -> None:
    team_a, team_b = add_teams(app, 2)
    first = record(admin_client, team_a, "Q1").json()
    second = record(admin_client, team_a, "Q1", "invalid").json()
    other = record(admin_client, team_b, "Q1").json()
    assert (first["attempt_no"], second["attempt_no"], other["attempt_no"]) == (1, 2, 1)
    assert first["recorded_by_username"] == "admin1"
    assert first["team"]["id"] == 1

    voided = admin_client.post(f"{LAPS}/{first['id']}/void", json={"reason": "임시 사유"})
    assert voided.status_code == 200
    # 입력 취소한 기록도 시도 번호를 차지한다
    assert record(admin_client, team_a, "Q1").json()["attempt_no"] == 3


def test_mission_follows_progress_when_not_given(app: FastAPI, admin_client: TestClient) -> None:
    [team_id] = add_teams(app, 1)

    def auto(status: str = "valid", lap_time_ms: int | None = None):
        body = {"team_id": team_id, "status": status, "lap_time_ms": lap_time_ms}
        return admin_client.post(LAPS, json=body)

    missions = [auto(status).json()["mission"] for status in ("valid", "invalid", "valid")]
    missions += [auto().json()["mission"] for _ in range(2)]  # 무효 랩 뒤 연속 3랩으로 Q1 통과
    missions += [auto().json()["mission"] for _ in range(3)]  # Q2 통과
    assert missions == ["Q1"] * 5 + ["Q2"] * 3
    # 이제 Q3: 유효 랩은 랩타임이 필요하다 (서버가 정한 미션으로 검사)
    missing = auto()
    assert missing.status_code == 422 and missing.json()["code"] == "VALIDATION_ERROR"
    assert auto("valid", 41_000).json()["mission"] == "Q3"


def test_unknown_or_inactive_team_rejected(app: FastAPI, admin_client: TestClient) -> None:
    add_teams(app, 2, inactive=(2,))
    assert record(admin_client, 2, "Q1").status_code == 422
    assert record(admin_client, 99, "Q1").status_code == 422


def test_update_and_void_rules(app: FastAPI, admin_client: TestClient) -> None:
    [team_id] = add_teams(app, 1)
    lap = record(admin_client, team_id, "Q3", "valid", 42_000).json()
    url = f"{LAPS}/{lap['id']}"

    edited = admin_client.patch(url, json={"version": 1, "lap_time_ms": 41_500})
    assert edited.status_code == 200
    assert (edited.json()["lap_time_ms"], edited.json()["version"]) == (41_500, 2)
    stale = admin_client.patch(url, json={"version": 1, "lap_time_ms": 41_000})
    assert stale.status_code == 409 and stale.json()["code"] == "VERSION_CONFLICT"
    assert admin_client.patch(url, json={"version": 2, "lap_time_ms": 600_001}).status_code == 422
    assert admin_client.patch(url, json={"version": 2, "lap_time_ms": 41_505}).status_code == 422
    assert admin_client.patch(url, json={"version": 2, "status": "void"}).status_code == 422

    # 무효 랩으로 바꾸고 시간을 지운 뒤, 다시 Q3 유효로 바꾸려면 랩타임이 필요하다
    invalid = admin_client.patch(url, json={"version": 2, "status": "invalid", "lap_time_ms": None})
    assert (invalid.json()["status"], invalid.json()["lap_time_ms"]) == ("invalid", None)
    assert admin_client.patch(url, json={"version": 3, "status": "valid"}).status_code == 422
    # 미션을 Q2 로 옮기면 시간 없이도 유효
    moved = admin_client.patch(url, json={"version": 3, "mission": "Q2", "status": "valid"})
    assert moved.status_code == 200 and moved.json()["mission"] == "Q2"
    assert admin_client.patch(url, json={"version": 4, "mission": "Q3"}).status_code == 422

    assert admin_client.post(f"{url}/void", json={"reason": "  "}).status_code == 422
    assert admin_client.post(f"{url}/void", json={"reason": "x", "version": 1}).status_code == 409
    voided = admin_client.post(f"{url}/void", json={"reason": "임시 입력 실수", "version": 4})
    assert voided.status_code == 200
    assert (voided.json()["status"], voided.json()["void_reason"]) == ("void", "임시 입력 실수")
    assert admin_client.post(f"{url}/void", json={"reason": "again"}).status_code == 422
    assert admin_client.patch(url, json={"version": 5, "lap_time_ms": 40_000}).status_code == 422
    assert admin_client.post(f"{LAPS}/999/void", json={"reason": "x"}).status_code == 404


def test_recent_laps_list(app: FastAPI, admin_client: TestClient) -> None:
    team_a, team_b = add_teams(app, 2)
    for ms in (41_000, 42_000, 43_000):
        record(admin_client, team_a, "Q3", "valid", ms)
    record(admin_client, team_b, "Q3", "valid", 44_000)
    laps = admin_client.get(LAPS).json()
    assert [lap["lap_time_ms"] for lap in laps] == [44_000, 43_000, 42_000, 41_000]
    assert [lap["lap_time_ms"] for lap in admin_client.get(LAPS, params={"limit": 2}).json()] == [
        44_000,
        43_000,
    ]
    only_a = admin_client.get(LAPS, params={"team_id": team_a}).json()
    assert {lap["team_id"] for lap in only_a} == {team_a}


# ---- 미션 진행 ----


def test_mission_progress_and_streaks(app: FastAPI, db: Session) -> None:
    t1, t2, t3, t4 = add_teams(app, 4)
    insert_laps(
        db,
        run(t1, q1="vxvvv", q2="vvx")  # Q1 은 무효 랩 뒤에 다시 연속 3랩으로 통과
        + run(t2, q1="vvxv")
        + run(t3, q1="vvv", q2="vvv", q3=(41_000, 40_500))
        + [(t3, "Q3", "invalid", None)]
        # Q1 을 통과하지 못했는데 들어온 Q2·Q3 기록은 순위에 쓰지 않는다
        + run(t4, q1="vx", q2="vvv", q3=(30_000,)),
    )
    rows = {r.team.id: r for r in build_leaderboard(db).rows}

    assert (rows[t1].missions_passed, rows[t1].current_mission) == (1, "Q2")
    assert (rows[t1].q1_laps, rows[t1].q2_laps, rows[t1].current_streak) == (3, 2, 0)
    assert (rows[t2].missions_passed, rows[t2].q1_laps, rows[t2].q2_laps) == (0, 2, None)
    assert (rows[t2].current_mission, rows[t2].current_streak) == ("Q1", 1)
    assert (rows[t3].missions_passed, rows[t3].q3_best_ms, rows[t3].fa) == (3, 40_500, True)
    assert rows[t3].current_mission == "Q3" and rows[t3].attempts == 9
    assert (rows[t4].missions_passed, rows[t4].q1_laps, rows[t4].q3_best_ms) == (0, 1, None)


# ---- 순위 (규칙 4.7) ----


def test_ranking_follows_rule_order(app: FastAPI, db: Session) -> None:
    teams = add_teams(app, 10, inactive=(10,))
    a, b, c, d, e, f, g, h, i, j = teams
    insert_laps(
        db,
        run(a, "vvv", "vvv", (43_000,))  # FA, 느림
        + run(b, "vvv", "vvv", (40_000,))  # FA 실패 판정, 빠름
        + run(c, "vvv", "vvv", (41_000, 39_000))  # FA, 빠름
        + run(d, "vvv", "vvv")  # Q2 통과, Q3 유효 기록 없음
        + [(d, "Q3", "invalid", None)]
        + run(e, "vvv", "vvx")  # Q2 탈락 2랩
        + run(f, "vvv", "vx")  # Q2 탈락 1랩
        + run(g, "vvx")  # Q1 탈락 2랩
        + run(h, "vvx")  # Q1 탈락 2랩: g 와 같은 기록, 검사는 h 가 먼저
        + [(h, "Q1", "void", None)]
        + run(j, "vvv", "vvv", (30_000,)),  # 비활성 팀은 빠진다
    )
    db.add(QualifyingEvent(team_id=b, kind="fa_lost", reason="t", recorded_at=T0))
    db.get(Team, g).inspected_at = T0 + timedelta(minutes=10)
    db.get(Team, h).inspected_at = T0 + timedelta(minutes=5)
    db.commit()

    assert summary(db) == [
        (1, c, True, 3, 3, 3, 39_000),
        (2, a, True, 3, 3, 3, 43_000),
        # FA 를 이룬 팀은 랩타임이 더 느려도 앞선다
        (3, b, False, 3, 3, 3, 40_000),
        (4, d, False, 2, 3, 3, None),
        (5, e, False, 1, 3, 2, None),
        (6, f, False, 1, 3, 1, None),
        (7, h, False, 0, 2, None, None),
        (8, g, False, 0, 2, None, None),
        # 기록이 없는 팀은 순위 없이 맨 아래
        (None, i, False, 0, None, None, None),
    ]


def test_inspection_order_breaks_ties_uninspected_last(app: FastAPI, db: Session) -> None:
    t1, t2, t3 = add_teams(app, 3)
    insert_laps(db, run(t1, "vx") + run(t2, "vx") + run(t3, "vx"))
    db.get(Team, t3).inspected_at = T0
    db.get(Team, t2).inspected_at = T0 + timedelta(minutes=1)
    db.commit()
    assert [r.team.id for r in build_leaderboard(db).rows] == [t3, t2, t1]


def test_rank_drops_move_each_team_down(app: FastAPI, db: Session) -> None:
    t1, t2, t3, t4 = add_teams(app, 4)
    insert_laps(db, run(t1, "vvv") + run(t2, "vvx") + run(t3, "vx") + run(t4, "x"))
    for team_id, count in ((t1, 1), (t2, 1), (t4, 2)):
        for _ in range(count):
            db.add(QualifyingEvent(team_id=team_id, kind="rank_drop", reason="t", recorded_at=T0))
    db.commit()
    rows = build_leaderboard(db).rows
    # 순서 t1 t2 t3 t4 → t1·t2 는 한 칸씩 내려가고, 맨 아래 t4 는 더 내려갈 곳이 없다
    assert [(r.rank, r.team.id, r.rank_drops) for r in rows] == [
        (1, t3, 0),
        (2, t1, 1),
        (3, t2, 1),
        (4, t4, 2),
    ]


# ---- 판정 · 검사 순서 API ----


def test_events_api(app: FastAPI, admin_client: TestClient) -> None:
    t1, t2, t3 = add_teams(app, 3, inactive=(3,))
    for mission in ("Q1", "Q1", "Q1", "Q2", "Q2", "Q2"):
        record(admin_client, t1, mission)
    record(admin_client, t1, "Q3", "valid", 41_000)
    record(admin_client, t2, "Q1", "invalid")

    fa = admin_client.post(EVENTS, json={"team_id": t1, "kind": "fa_lost", "reason": "5초 정지"})
    assert fa.status_code == 201 and fa.json()["recorded_by_username"] == "admin1"
    again = admin_client.post(EVENTS, json={"team_id": t1, "kind": "fa_lost", "reason": "또"})
    assert again.status_code == 422
    for reason in ("경로 수정", "조이스틱"):
        body = {"team_id": t1, "kind": "rank_drop", "reason": reason}
        assert admin_client.post(EVENTS, json=body).status_code == 201
    for body in (
        {"team_id": t3, "kind": "rank_drop", "reason": "x"},  # 비활성 팀
        {"team_id": t1, "kind": "warning", "reason": "x"},
        {"team_id": t1, "kind": "rank_drop", "reason": "  "},
    ):
        assert admin_client.post(EVENTS, json=body).status_code == 422

    rows = admin_client.get("/api/qualifying/leaderboard").json()["rows"]
    # 강등 2번으로 맨 아래
    last = rows[-1]
    assert (last["team"]["id"], last["fa"], last["fa_lost"]) == (t1, False, True)
    assert last["rank_drops"] == 2
    listed = admin_client.get(EVENTS, params={"team_id": t1}).json()
    assert [e["kind"] for e in listed] == ["fa_lost", "rank_drop", "rank_drop"]

    assert admin_client.delete(f"{EVENTS}/{fa.json()['id']}").status_code == 204
    assert admin_client.delete(f"{EVENTS}/{fa.json()['id']}").status_code == 404
    rows = admin_client.get("/api/qualifying/leaderboard").json()["rows"]
    assert next(r for r in rows if r["team"]["id"] == t1)["fa"] is True


def test_inspection_api(app: FastAPI, admin_client: TestClient) -> None:
    t1, t2, t3 = add_teams(app, 3, inactive=(3,))
    assert [e["order"] for e in admin_client.get(INSPECTION).json()] == [None, None]
    assert admin_client.put(f"{INSPECTION}/{t2}", json={"done": True}).status_code == 200
    entries = admin_client.put(f"{INSPECTION}/{t1}", json={"done": True}).json()
    assert [(e["team"]["id"], e["order"]) for e in entries] == [(t1, 2), (t2, 1)]
    first_time = entries[1]["inspected_at"]
    # 다시 눌러도 처음 시각을 유지한다
    entries = admin_client.put(f"{INSPECTION}/{t2}", json={"done": True}).json()
    assert entries[1]["inspected_at"] == first_time
    entries = admin_client.put(f"{INSPECTION}/{t2}", json={"done": False}).json()
    assert [(e["team"]["id"], e["order"]) for e in entries] == [(t1, 1), (t2, None)]
    assert admin_client.put(f"{INSPECTION}/{t3}", json={"done": True}).status_code == 422


def test_inspection_order_typed_by_admin(
    app: FastAPI, admin_client: TestClient, client: TestClient
) -> None:
    """관리자가 직접 적은 검차 순서는 공개 리더보드에 보이고, 검사 시각보다 먼저 동률을 가른다."""
    t1, t2, t3, t4 = add_teams(app, 4, inactive=(4,))
    for team_id in (t1, t2, t3):
        record(admin_client, team_id, "Q1", "invalid")
    # 검사 완료는 t1 → t2 → t3 순서로 눌렀지만, 실제 검차 순서는 t3 → t1 (t2 는 아직 안 적음)
    for team_id in (t1, t2, t3):
        admin_client.put(f"{INSPECTION}/{team_id}", json={"done": True})
    items = [{"team_id": t3, "order": 1}, {"team_id": t1, "order": 2}]
    saved = admin_client.put(f"{INSPECTION}-order", json={"items": items})
    assert saved.status_code == 200, saved.text
    entries = {e["team"]["id"]: (e["inspection_order"], e["order"]) for e in saved.json()}
    assert entries == {t1: (2, 2), t2: (None, 3), t3: (1, 1)}

    rows = client.get("/api/qualifying/leaderboard").json()["rows"]
    assert [(r["rank"], r["team"]["id"], r["inspection_order"]) for r in rows] == [
        (1, t3, 1),
        (2, t1, 2),
        (3, t2, None),
    ]

    # 같은 번호를 두 팀에 줄 수 없다. 거절하면 아무것도 바꾸지 않는다
    clash = [{"team_id": t2, "order": 1}, {"team_id": t1, "order": 3}]
    refused = admin_client.put(f"{INSPECTION}-order", json={"items": clash})
    assert refused.status_code == 409 and refused.json()["code"] == "INSPECTION_ORDER_TAKEN"
    kept = admin_client.get(INSPECTION).json()
    assert {e["team"]["id"]: e["inspection_order"] for e in kept} == {t1: 2, t2: None, t3: 1}
    # 한 번에 보내면 서로 바꿀 수 있고, null 이면 지운다
    swap = [
        {"team_id": t3, "order": 2},
        {"team_id": t1, "order": 1},
        {"team_id": t2, "order": None},
    ]
    assert admin_client.put(f"{INSPECTION}-order", json={"items": swap}).status_code == 200
    rows = client.get("/api/qualifying/leaderboard").json()["rows"]
    assert [r["team"]["id"] for r in rows] == [t1, t3, t2]

    for bad in ({"team_id": t4, "order": 3}, {"team_id": t1, "order": 0}):
        response = admin_client.put(f"{INSPECTION}-order", json={"items": [bad]})
        assert response.status_code == 422
    with TestClient(app, headers=FETCH) as anonymous:
        response = anonymous.put(f"{INSPECTION}-order", json={"items": []})
        assert response.status_code == 401


def test_leaderboard_endpoint_follows_api_changes(app: FastAPI, admin_client: TestClient) -> None:
    t1, t2 = add_teams(app, 2)
    record(admin_client, t1, "Q1", "invalid")
    good = record(admin_client, t2, "Q1").json()
    board = admin_client.get("/api/qualifying/leaderboard")
    assert board.headers["cache-control"] == "no-store"
    assert board.json()["scoring"] == "rules"
    assert [r["team"]["id"] for r in board.json()["rows"]] == [t2, t1]

    admin_client.post(f"{LAPS}/{good['id']}/void", json={"reason": "임시"})
    rows = admin_client.get("/api/qualifying/leaderboard").json()["rows"]
    assert [(r["rank"], r["team"]["id"], r["attempts"]) for r in rows] == [
        (1, t1, 1),
        (None, t2, 0),
    ]
