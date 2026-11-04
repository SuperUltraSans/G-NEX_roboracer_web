"""모니터링 관리(로그인 없이 주소의 비밀 값으로, 또는 로그인한 운영진)와 랭킹."""

from fastapi import FastAPI
from fastapi.testclient import TestClient

from tests.conftest import FETCH, PASSWORD, add_teams, login

ADMIN = "/api/admin"
KEY = "test-monitor-key"


def monitor_client(app: FastAPI, key: str = KEY) -> TestClient:
    return TestClient(app, headers={**FETCH, "X-Monitor-Key": key})


def set_key(admin_client: TestClient, key: str | None = KEY) -> None:
    response = admin_client.put(f"{ADMIN}/settings/monitor", json={"key": key})
    assert response.status_code == 200, response.text


def test_monitor_key_settings(admin_client: TestClient) -> None:
    set_key(admin_client)
    assert admin_client.get(f"{ADMIN}/settings").json()["monitor_key"] == KEY
    assert "monitor_key" not in admin_client.get("/api/settings/public").json()
    for bad in ("short", "has space 1", "한글키값입니다", "x" * 65):
        response = admin_client.put(f"{ADMIN}/settings/monitor", json={"key": bad})
        assert response.status_code == 422, bad
    # 변경 이력에는 비밀 값 자체를 남기지 않는다 (신청 설정을 저장할 때도)
    audit = admin_client.get(f"{ADMIN}/audit").json()["items"][0]
    assert audit["entity_id"] == "monitor_key" and KEY not in str(audit)
    apply = {"apply_form_url": "https://example.com/form"}
    assert admin_client.put(f"{ADMIN}/settings", json=apply).status_code == 200
    assert KEY not in str(admin_client.get(f"{ADMIN}/audit").json())


def test_monitor_key_allows_monitoring_only(app: FastAPI, admin_client: TestClient) -> None:
    (t1,) = add_teams(app, 1)
    set_key(admin_client)
    with monitor_client(app) as monitor:
        access = monitor.get(f"{ADMIN}/monitor/access")
        assert access.status_code == 200
        assert access.json() == {"via": "key", "username": "monitoring"}
        lap = monitor.post(
            f"{ADMIN}/qualifying/laps",
            json={"team_id": t1, "mission": "Q1", "status": "valid"},
        )
        assert lap.status_code == 201 and lap.json()["recorded_by_username"] == "monitoring"
        assert monitor.get(f"{ADMIN}/qualifying/laps").status_code == 200
        live = monitor.put(
            f"{ADMIN}/live/state",
            json={"phase": "qualifying", "on_track_team_id": t1, "current_match_id": None},
        )
        assert live.status_code == 200
        assert monitor.put(f"{ADMIN}/ranking", json={"team_ids": [t1]}).status_code == 200
        assert monitor.get(f"{ADMIN}/bracket/rounds").status_code == 200
        # 관리자 화면 기능은 열리지 않는다
        for method, path in [
            ("GET", f"{ADMIN}/schedule"),
            ("GET", f"{ADMIN}/teams"),
            ("GET", f"{ADMIN}/settings"),
            ("POST", f"{ADMIN}/bracket/rounds"),
            ("GET", f"{ADMIN}/auth/me"),
        ]:
            assert monitor.request(method, path, json={}).status_code == 401, path
    # 시스템 계정은 계정 목록에 나오지 않고, 어떤 비밀번호로도 로그인되지 않는다
    assert "monitoring" not in [u["username"] for u in admin_client.get(f"{ADMIN}/users").json()]
    with TestClient(app) as anonymous:
        assert login(anonymous, "monitoring", PASSWORD).status_code == 401
        assert login(anonymous, "monitoring", "!").status_code == 401


def test_wrong_or_missing_key(app: FastAPI, admin_client: TestClient) -> None:
    # 비밀 값을 정하지 않았으면 어떤 값도 통하지 않는다
    with monitor_client(app, "anything-at-all") as monitor:
        response = monitor.get(f"{ADMIN}/monitor/access")
        assert response.status_code == 403 and response.json()["code"] == "MONITOR_KEY_INVALID"
    set_key(admin_client)
    with TestClient(app, headers=FETCH) as anonymous:
        assert anonymous.get(f"{ADMIN}/monitor/access").status_code == 401
    # 값을 바꾸면 예전 주소는 바로 막힌다
    set_key(admin_client, "new-monitor-key")
    with monitor_client(app) as old:
        assert old.get(f"{ADMIN}/monitor/access").status_code == 403
    set_key(admin_client, None)
    with monitor_client(app, "new-monitor-key") as cleared:
        assert cleared.get(f"{ADMIN}/monitor/access").status_code == 403


def test_wrong_key_rate_limited(app: FastAPI, admin_client: TestClient) -> None:
    set_key(admin_client)
    with monitor_client(app, "wrong-key-value") as wrong:
        for _ in range(10):
            assert wrong.get(f"{ADMIN}/monitor/access").status_code == 403
        assert wrong.get(f"{ADMIN}/monitor/access").status_code == 429
    # 맞는 값도 제한이 풀릴 때까지 막힌다 (같은 IP)
    with monitor_client(app) as right:
        assert right.get(f"{ADMIN}/monitor/access").status_code == 429


def test_logged_in_staff_can_use_monitoring(admin_client: TestClient) -> None:
    access = admin_client.get(f"{ADMIN}/monitor/access")
    assert access.status_code == 200 and access.json()["via"] == "session"


def test_ranking_rules(app: FastAPI, admin_client: TestClient) -> None:
    t1, t2, t3 = add_teams(app, 3, inactive=(3,))
    empty = admin_client.get(f"{ADMIN}/ranking").json()
    assert empty == {"entries": [], "updated_at": None}
    saved = admin_client.put(f"{ADMIN}/ranking", json={"team_ids": [t2, t1]})
    assert saved.status_code == 200
    assert [(e["rank"], e["team"]["id"]) for e in saved.json()["entries"]] == [(1, t2), (2, t1)]
    for body in ({"team_ids": [t1, t1]}, {"team_ids": [t1, 999]}, {"team_ids": [t3]}):
        response = admin_client.put(f"{ADMIN}/ranking", json=body)
        assert response.status_code == 422, body
    # 빈 목록이면 랭킹을 비운다
    assert admin_client.put(f"{ADMIN}/ranking", json={"team_ids": []}).json()["entries"] == []


def test_current_match_follows_live_state(admin_client: TestClient) -> None:
    created = admin_client.post(f"{ADMIN}/bracket/generate", json={"size": 4})
    matches = [m for r in created.json()["rounds"] for m in r["matches"]]
    m1, m2 = matches[0]["id"], matches[1]["id"]

    def status(match_id: int) -> str:
        rounds = admin_client.get("/api/bracket").json()["rounds"]
        return next(m["status"] for r in rounds for m in r["matches"] if m["id"] == match_id)

    def set_current(match_id: int | None) -> None:
        body = {"phase": "bracket", "on_track_team_id": None, "current_match_id": match_id}
        assert admin_client.put(f"{ADMIN}/live/state", json=body).status_code == 200

    set_current(m1)
    assert status(m1) == "live"
    set_current(m2)
    assert (status(m1), status(m2)) == ("scheduled", "live")
    set_current(None)
    assert status(m2) == "scheduled"


def test_monitoring_username_is_reserved(admin_client: TestClient) -> None:
    for name in ("monitoring", "Monitoring"):
        body = {"username": name, "password": PASSWORD, "role": "admin"}
        response = admin_client.post(f"{ADMIN}/users", json=body)
        assert response.status_code == 422, name
