"""그룹 연습 조: 차량 검사를 마친 팀이 A·B·C조(3·3·4팀)를 먼저 고른다."""

from fastapi import FastAPI
from fastapi.testclient import TestClient

from tests.conftest import FETCH, add_teams

ADMIN = "/api/admin"


def members(state: dict) -> dict[str, list[int]]:
    return {g["name"]: [m["team"]["id"] for m in g["teams"]] for g in state["practice"]}


def inspect(client: TestClient, team_id: int) -> None:
    response = client.put(f"{ADMIN}/qualifying/inspection/{team_id}", json={"done": True})
    assert response.status_code == 200


def pick(client: TestClient, team_id: int, group: str | None):
    return client.put(f"{ADMIN}/practice/{team_id}", json={"group": group})


def test_practice_groups(app: FastAPI, admin_client: TestClient, client: TestClient) -> None:
    ids = add_teams(app, 11)
    state = client.get("/api/live/state").json()
    assert [(g["name"], g["capacity"], g["teams"]) for g in state["practice"]] == [
        ("A", 3, []),
        ("B", 3, []),
        ("C", 4, []),
    ]
    # 조마다 40분: 20:00~20:40, 20:40~21:20, 21:20~22:00 (KST)
    assert [(g["starts_at"], g["ends_at"]) for g in state["practice"]] == [
        ("2026-11-01T11:00:00Z", "2026-11-01T11:40:00Z"),
        ("2026-11-01T11:40:00Z", "2026-11-01T12:20:00Z"),
        ("2026-11-01T12:20:00Z", "2026-11-01T13:00:00Z"),
    ]
    # 검사 전에는 고를 수 없다
    early = pick(admin_client, ids[0], "A")
    assert early.status_code == 422 and "차량 검사" in early.json()["detail"]

    for team_id in ids:
        inspect(admin_client, team_id)
    for team_id in ids[:3]:
        assert pick(admin_client, team_id, "A").status_code == 200
    full = pick(admin_client, ids[3], "A")
    assert full.status_code == 409 and full.json()["code"] == "GROUP_FULL"
    for team_id in ids[3:6]:
        assert pick(admin_client, team_id, "B").status_code == 200
    for team_id in ids[6:10]:
        assert pick(admin_client, team_id, "C").status_code == 200
    assert pick(admin_client, ids[10], "C").status_code == 409
    groups = members(client.get("/api/live/state").json())
    assert groups == {"A": ids[:3], "B": ids[3:6], "C": ids[6:10]}

    # 빼면 자리가 나고, 다른 조로 옮길 수 있다 (같은 조를 다시 고르면 그대로)
    assert pick(admin_client, ids[0], None).status_code == 200
    assert pick(admin_client, ids[10], "A").status_code == 200
    assert pick(admin_client, ids[10], "A").status_code == 200
    assert pick(admin_client, ids[1], "A").status_code == 200
    groups = members(client.get("/api/live/state").json())
    assert groups["A"] == [ids[1], ids[2], ids[10]]

    # 기권한 팀은 조에서 빠진다
    team = next(t for t in admin_client.get(f"{ADMIN}/teams").json() if t["id"] == ids[3])
    body = {"version": team["version"], "is_active": False}
    assert admin_client.patch(f"{ADMIN}/teams/{ids[3]}", json=body).status_code == 200
    assert members(client.get("/api/live/state").json())["B"] == ids[4:6]

    # 그룹 연습과 자유 연습 단계
    for phase in ("practice", "free_practice"):
        r = admin_client.put(f"{ADMIN}/live/state", json={"phase": phase})
        assert r.status_code == 200 and r.json()["phase"] == phase


def test_practice_requires_monitor_access(app: FastAPI) -> None:
    add_teams(app, 1)
    with TestClient(app, headers=FETCH) as anonymous:
        assert anonymous.put(f"{ADMIN}/practice/1", json={"group": "A"}).status_code == 401
