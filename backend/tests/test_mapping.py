"""맵핑 순서: 모니터링 관리에서 무작위로 섞고, 공개 진행 상태로 보인다."""

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.errors import AppError
from app.services import mapping
from tests.conftest import FETCH, add_teams
from tests.test_monitor import monitor_client, set_key

ADMIN = "/api/admin"


def order_of(state: dict) -> list[int]:
    assert [e["order"] for e in state["mapping"]] == list(range(1, len(state["mapping"]) + 1))
    return [e["team"]["id"] for e in state["mapping"]]


def test_shuffle_and_done(app: FastAPI, admin_client: TestClient, client: TestClient) -> None:
    ids = add_teams(app, 6, inactive=(6,))
    # 섞기 전에는 빈 목록
    assert client.get("/api/live/state").json()["mapping"] == []

    set_key(admin_client)
    with monitor_client(app) as monitor:
        shuffled = monitor.post(f"{ADMIN}/mapping/shuffle")
        assert shuffled.status_code == 200, shuffled.text
        first = order_of(shuffled.json())
        assert sorted(first) == ids[:5]  # 기권(비활성) 팀은 빠진다
        assert order_of(client.get("/api/live/state").json()) == first

        done = monitor.put(f"{ADMIN}/mapping/{first[0]}", json={"done": True})
        assert done.status_code == 200
        assert done.json()["mapping"][0]["mapped_at"] is not None

        # 다시 섞어도 맵핑을 마친 팀은 맨 앞 그대로. 여러 번 섞으면 나머지 순서는 바뀐다
        seen = set()
        for _ in range(20):
            again = order_of(monitor.post(f"{ADMIN}/mapping/shuffle").json())
            assert again[0] == first[0] and sorted(again) == sorted(first)
            seen.add(tuple(again))
        assert len(seen) > 1

        undone = monitor.put(f"{ADMIN}/mapping/{first[0]}", json={"done": False})
        assert undone.json()["mapping"][0]["mapped_at"] is None
        assert monitor.put(f"{ADMIN}/mapping/{ids[5]}", json={"done": True}).status_code == 422

    # 새로 등록한 팀은 다시 섞기 전까지 순서에 없다
    created = admin_client.post(f"{ADMIN}/teams", json={"name_ko": "늦게 온 팀", "name_en": "Late"})
    assert created.status_code == 201, created.text
    late = created.json()["id"]
    assert late not in order_of(client.get("/api/live/state").json())
    assert admin_client.put(f"{ADMIN}/mapping/{late}", json={"done": True}).status_code == 422

    # 중간에 기권하면 빼고 다시 센다
    current = order_of(client.get("/api/live/state").json())
    team = next(t for t in admin_client.get(f"{ADMIN}/teams").json() if t["id"] == current[1])
    body = {"version": team["version"], "is_active": False}
    assert admin_client.patch(f"{ADMIN}/teams/{current[1]}", json=body).status_code == 200
    assert order_of(client.get("/api/live/state").json()) == [current[0], *current[2:]]

    logs = [log["action"] for log in admin_client.get(f"{ADMIN}/audit").json()["items"]]
    assert "shuffle" in logs

    # 맵핑 전체 취소: 순서와 완료 기록을 모두 지우고, 진행 상태는 그대로
    admin_client.put(f"{ADMIN}/mapping/{current[0]}", json={"done": True})
    live = admin_client.put(
        f"{ADMIN}/live/state", json={"phase": "mapping", "on_track_team_id": current[2]}
    )
    assert live.status_code == 200
    reset = admin_client.delete(f"{ADMIN}/mapping")
    assert reset.status_code == 200
    state = reset.json()
    assert state["mapping"] == [] and state["phase"] == "mapping"
    assert state["on_track_team"]["id"] == current[2]
    assert client.get("/api/live/state").json()["mapping"] == []
    assert admin_client.put(f"{ADMIN}/mapping/{current[0]}", json={"done": True}).status_code == 422
    assert admin_client.get(f"{ADMIN}/audit").json()["items"][0]["action"] == "mapping_reset"
    # 다시 섞으면 완료 기록 없이 처음부터
    again = admin_client.post(f"{ADMIN}/mapping/shuffle").json()["mapping"]
    assert len(again) == 5 and all(e["mapped_at"] is None for e in again)
    assert admin_client.delete(f"{ADMIN}/mapping").status_code == 200
    assert admin_client.delete(f"{ADMIN}/mapping").status_code == 200  # 비어 있어도 된다


def test_mapping_requires_monitor_access(app: FastAPI) -> None:
    add_teams(app, 2)
    with TestClient(app, headers=FETCH) as anonymous:
        assert anonymous.post(f"{ADMIN}/mapping/shuffle").status_code == 401
        assert anonymous.put(f"{ADMIN}/mapping/1", json={"done": True}).status_code == 401
        assert anonymous.delete(f"{ADMIN}/mapping").status_code == 401


def test_freeze_mapping_sets_qualifying_order(
    app: FastAPI, admin_client: TestClient, client: TestClient
) -> None:
    ids = add_teams(app, 5)
    first = order_of(admin_client.post(f"{ADMIN}/mapping/shuffle").json())
    admin_client.put(f"{ADMIN}/mapping/{first[0]}", json={"done": True})
    # 동결 전: 기록 없는 팀은 팀 번호 순, 출전 순서 없음
    rows = client.get("/api/qualifying/leaderboard").json()["rows"]
    assert [r["team"]["id"] for r in rows] == ids
    assert all(r["run_order"] is None for r in rows)
    assert client.get("/api/live/state").json()["mapping_frozen"] is False

    with app.state.session_factory() as db:
        mapping.freeze(db, None)
        db.commit()

    # 동결 뒤: 맵핑 탭 순서(완료 여부와 상관없이) 그대로 예선 출전 순서가 된다
    state = client.get("/api/live/state").json()
    assert state["mapping_frozen"] is True and order_of(state) == first
    rows = client.get("/api/qualifying/leaderboard").json()["rows"]
    assert [r["team"]["id"] for r in rows] == first
    assert [r["run_order"] for r in rows] == [1, 2, 3, 4, 5]
    logs = admin_client.get(f"{ADMIN}/audit").json()["items"]
    assert logs[0]["action"] == "freeze"

    # 동결한 맵핑 순서는 섞기·전체 취소·완료 표시 모두 막는다
    for response in (
        admin_client.post(f"{ADMIN}/mapping/shuffle"),
        admin_client.delete(f"{ADMIN}/mapping"),
        admin_client.put(f"{ADMIN}/mapping/{first[1]}", json={"done": True}),
    ):
        assert response.status_code == 409 and response.json()["code"] == "MAPPING_FROZEN"
    with app.state.session_factory() as db, pytest.raises(AppError):
        mapping.freeze(db, None)
    assert order_of(client.get("/api/live/state").json()) == first

    # 랩을 기록한 팀은 순위로 위에 오르고, 남은 팀은 출전 순서대로. 기권한 팀은 빼고 다시 센다
    body = {"team_id": first[2], "mission": "Q1", "status": "valid"}
    assert admin_client.post("/api/admin/qualifying/laps", json=body).status_code == 201
    team = next(t for t in admin_client.get(f"{ADMIN}/teams").json() if t["id"] == first[0])
    body = {"version": team["version"], "is_active": False}
    assert admin_client.patch(f"{ADMIN}/teams/{first[0]}", json=body).status_code == 200
    rows = client.get("/api/qualifying/leaderboard").json()["rows"]
    assert [r["team"]["id"] for r in rows] == [first[2], first[1], first[3], first[4]]
    assert [r["run_order"] for r in rows] == [2, 1, 3, 4]


def test_freeze_needs_mapping_order(app: FastAPI) -> None:
    add_teams(app, 2)
    with app.state.session_factory() as db, pytest.raises(AppError):
        mapping.freeze(db, None)


def test_reorder_qualifying_order(
    app: FastAPI, admin_client: TestClient, client: TestClient
) -> None:
    ids = add_teams(app, 4, inactive=(4,))
    first = order_of(admin_client.post(f"{ADMIN}/mapping/shuffle").json())
    with app.state.session_factory() as db:
        mapping.freeze(db, None)
        db.commit()

    wanted = [first[2], first[0], first[1]]
    saved = admin_client.put(f"{ADMIN}/qualifying/order", json={"team_ids": wanted})
    assert saved.status_code == 200, saved.text
    rows = client.get("/api/qualifying/leaderboard").json()["rows"]
    assert [(r["team"]["id"], r["run_order"]) for r in rows] == [
        (wanted[0], 1),
        (wanted[1], 2),
        (wanted[2], 3),
    ]
    assert [(r["team"]["id"], r["run_order"]) for r in saved.json()["rows"]] == [
        (r["team"]["id"], r["run_order"]) for r in rows
    ]
    # 맵핑 순서와 맵핑 탭은 그대로, 여전히 잠겨 있다
    state = client.get("/api/live/state").json()
    assert order_of(state) == first and state["mapping_frozen"] is True
    log = admin_client.get(f"{ADMIN}/audit").json()["items"][0]
    assert log["action"] == "reorder"

    # 참가 중인 팀을 빠짐없이 한 번씩: 빠지거나 겹치거나 비활성 팀이 있으면 거절
    for bad in (wanted[:2], [*wanted, wanted[0]], [*wanted[:2], ids[3]], [*wanted, ids[3]]):
        response = admin_client.put(f"{ADMIN}/qualifying/order", json={"team_ids": bad})
        assert response.status_code == 422, bad
    with TestClient(app, headers=FETCH) as anonymous:
        response = anonymous.put(f"{ADMIN}/qualifying/order", json={"team_ids": wanted})
        assert response.status_code == 401
