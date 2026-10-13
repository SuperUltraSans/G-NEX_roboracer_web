from datetime import timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import select, update

from app.models import AuditLog, UserSession, utcnow
from tests.conftest import FETCH, PASSWORD, create_user, login

SCHEDULE_BODY = {"starts_at": "2026-11-01T01:00:00Z", "title_ko": "임시 일정"}


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("GET", "/api/admin/auth/me"),
        ("GET", "/api/admin/schedule"),
        ("GET", "/api/admin/qualifying/laps"),
        ("POST", "/api/admin/schedule"),
        ("PUT", "/api/admin/live/state"),
        ("POST", "/api/admin/auth/logout"),
    ],
)
def test_admin_api_requires_login(client: TestClient, method: str, path: str) -> None:
    response = client.request(method, path, headers=FETCH, json={})
    assert response.status_code == 401
    assert response.json() == {"detail": "로그인이 필요합니다.", "code": "UNAUTHENTICATED"}


def test_login_sets_strict_http_only_cookie(app: FastAPI, client: TestClient) -> None:
    create_user(app, "admin1")
    response = login(client, "admin1")
    assert response.status_code == 200
    assert response.json() == {"id": 1, "username": "admin1", "role": "admin"}
    cookie = response.headers["set-cookie"]
    assert cookie.startswith("rr_session=")
    for attribute in ("HttpOnly", "SameSite=strict", "Path=/", "Max-Age=43200"):
        assert attribute in cookie
    assert "Secure" not in cookie
    assert client.get("/api/admin/auth/me").json()["username"] == "admin1"


def test_cookie_path_and_secure_follow_settings(settings, tmp_path) -> None:
    from app.main import create_app

    custom = settings.model_copy(update={"cookie_path": "/roboracer", "cookie_secure": True})
    app = create_app(custom)
    create_user(app, "admin1")
    with TestClient(app, base_url="https://testserver") as client:
        cookie = login(client, "admin1").headers["set-cookie"]
    assert "Path=/roboracer" in cookie
    assert "Secure" in cookie
    app.state.engine.dispose()


def test_wrong_password_and_inactive_user_are_rejected(app: FastAPI, client: TestClient) -> None:
    create_user(app, "admin1")
    create_user(app, "retired", active=False)
    bad = login(client, "admin1", "wrong-password")
    assert bad.status_code == 401
    assert bad.json()["code"] == "INVALID_CREDENTIALS"
    assert login(client, "retired").status_code == 401
    assert login(client, "nobody").status_code == 401


def test_referee_cannot_edit_content(referee_client: TestClient) -> None:
    client = referee_client
    for method, path, body in [
        ("POST", "/api/admin/schedule", SCHEDULE_BODY),
        ("PUT", "/api/admin/settings", {}),
        ("POST", "/api/admin/teams", {"car_number": 1, "name_ko": "Mock Team 01"}),
        ("POST", "/api/admin/rules", {"title_ko": "임시 규칙"}),
        ("GET", "/api/admin/users", None),
        ("POST", "/api/admin/bracket/rounds", {"name_ko": "8강"}),
        ("GET", "/api/admin/audit", None),
    ]:
        response = client.request(method, path, json=body)
        assert response.status_code == 403, path
        assert response.json()["code"] == "FORBIDDEN"


def test_referee_can_record_laps_and_live_state(app: FastAPI, referee_client: TestClient) -> None:
    from tests.conftest import add_teams

    [team_id] = add_teams(app, 1)
    lap = {"team_id": team_id, "lap_time_ms": 42_000, "status": "valid"}
    assert referee_client.post("/api/admin/qualifying/laps", json=lap).status_code == 201
    state = {"phase": "qualifying", "on_track_team_id": team_id}
    assert referee_client.put("/api/admin/live/state", json=state).status_code == 200


def test_mutation_without_fetch_header_is_forbidden(app: FastAPI, client: TestClient) -> None:
    create_user(app, "admin1")
    # 로그인 자체도 헤더가 필요하다
    response = client.post(
        "/api/admin/auth/login", json={"username": "admin1", "password": PASSWORD}
    )
    assert response.status_code == 403
    # CSRF 검사가 세션 검사보다 먼저다
    assert client.post("/api/admin/schedule", json=SCHEDULE_BODY).status_code == 403

    assert login(client, "admin1").status_code == 200
    response = client.post("/api/admin/schedule", json=SCHEDULE_BODY)
    assert response.status_code == 403
    assert response.json()["code"] == "FORBIDDEN"
    # GET 은 헤더 없이도 된다
    assert client.get("/api/admin/schedule").status_code == 200
    assert client.post("/api/admin/schedule", json=SCHEDULE_BODY, headers=FETCH).status_code == 201


def test_login_rate_limit_after_five_failures(app: FastAPI, client: TestClient) -> None:
    create_user(app, "admin1")
    now = [1000.0]
    app.state.login_limiter._clock = lambda: now[0]
    for _ in range(5):
        assert login(client, "admin1", "wrong-password").status_code == 401
    # 6번째는 비밀번호가 맞아도 429
    blocked = login(client, "admin1")
    assert blocked.status_code == 429
    assert blocked.json()["code"] == "RATE_LIMITED"
    # 다른 username 은 영향 없음
    create_user(app, "admin2")
    assert login(client, "admin2").status_code == 200
    # 10분이 지나면 다시 시도할 수 있다
    now[0] += 601
    assert login(client, "admin1").status_code == 200


def test_successful_login_resets_failures(app: FastAPI, client: TestClient) -> None:
    create_user(app, "admin1")
    for _ in range(4):
        login(client, "admin1", "wrong-password")
    assert login(client, "admin1").status_code == 200
    for _ in range(4):
        assert login(client, "admin1", "wrong-password").status_code == 401
    assert login(client, "admin1").status_code == 200


def test_logout_deletes_session(admin_client: TestClient) -> None:
    response = admin_client.post("/api/admin/auth/logout")
    assert response.status_code == 204
    assert 'rr_session=""' in response.headers["set-cookie"]
    assert admin_client.get("/api/admin/auth/me").status_code == 401


def test_expired_session_is_rejected(app: FastAPI, admin_client: TestClient, db) -> None:
    db.execute(update(UserSession).values(expires_at=utcnow() - timedelta(seconds=1)))
    db.commit()
    assert admin_client.get("/api/admin/auth/me").status_code == 401


def test_users_crud_and_session_revocation(app: FastAPI, admin_client: TestClient, db) -> None:
    created = admin_client.post(
        "/api/admin/users",
        json={"username": "referee1", "password": "long-enough-1", "role": "referee"},
    )
    assert created.status_code == 201
    referee = created.json()
    assert referee["role"] == "referee" and referee["is_active"] is True
    assert "password_hash" not in referee

    duplicate = admin_client.post(
        "/api/admin/users",
        json={"username": "referee1", "password": "long-enough-1", "role": "referee"},
    )
    assert duplicate.status_code == 409
    assert duplicate.json()["code"] == "DUPLICATE"

    short = admin_client.post(
        "/api/admin/users", json={"username": "x-user", "password": "short", "role": "referee"}
    )
    assert short.status_code == 422

    # 심판이 로그인한 상태에서 비활성화하면 세션이 사라진다
    with TestClient(app) as referee_client:
        assert login(referee_client, "referee1", "long-enough-1").status_code == 200
        url = f"/api/admin/users/{referee['id']}"
        assert admin_client.patch(url, json={"is_active": False}).json()["is_active"] is False
        assert referee_client.get("/api/admin/auth/me").status_code == 401
        assert login(referee_client, "referee1", "long-enough-1").status_code == 401

        admin_client.patch(url, json={"is_active": True})
        assert login(referee_client, "referee1", "long-enough-1").status_code == 200
        # 비밀번호 재설정도 세션을 지운다
        assert admin_client.patch(url, json={"password": "another-pass-2"}).status_code == 200
        assert referee_client.get("/api/admin/auth/me").status_code == 401
        assert login(referee_client, "referee1", "another-pass-2").status_code == 200

    users = admin_client.get("/api/admin/users").json()
    assert [u["username"] for u in users] == ["admin1", "referee1"]
    resets = db.scalars(select(AuditLog).where(AuditLog.action == "password_reset")).all()
    assert [log.entity_id for log in resets] == [str(referee["id"])]


def test_password_minimum_is_eight_characters(admin_client: TestClient) -> None:
    def create(password: str) -> int:
        body = {"username": "x-user", "password": password, "role": "referee"}
        return admin_client.post("/api/admin/users", json=body).status_code

    assert create("1234567") == 422
    assert create("12345678") == 201


def test_last_admin_cannot_be_demoted_or_deactivated(admin_client: TestClient) -> None:
    me = admin_client.get("/api/admin/auth/me").json()
    url = f"/api/admin/users/{me['id']}"
    for body in ({"role": "referee"}, {"is_active": False}):
        response = admin_client.patch(url, json=body)
        assert response.status_code == 409
        assert response.json()["code"] == "LAST_ADMIN"

    admin_client.post(
        "/api/admin/users",
        json={"username": "admin2", "password": "long-enough-1", "role": "admin"},
    )
    assert admin_client.patch(url, json={"role": "referee"}).status_code == 200


def test_patch_user_rejects_null_and_unknown_user(admin_client: TestClient) -> None:
    assert admin_client.patch("/api/admin/users/1", json={"role": None}).status_code == 422
    missing = admin_client.patch("/api/admin/users/999", json={"is_active": False})
    assert missing.status_code == 404
    assert missing.json()["code"] == "NOT_FOUND"


def test_mutations_are_audited(admin_client: TestClient, db) -> None:
    item = admin_client.post("/api/admin/schedule", json=SCHEDULE_BODY).json()
    admin_client.patch(
        f"/api/admin/schedule/{item['id']}", json={"version": 1, "title_ko": "임시 바뀐 일정"}
    )
    admin_client.delete(f"/api/admin/schedule/{item['id']}")

    logs = db.scalars(select(AuditLog).where(AuditLog.entity == "schedule_items")).all()
    assert [log.action for log in logs] == ["create", "update", "delete"]
    assert logs[1].before["title_ko"] == "임시 일정"
    assert logs[1].after["title_ko"] == "임시 바뀐 일정"
    assert logs[1].after["version"] == 2
    assert logs[2].after is None

    page = admin_client.get("/api/admin/audit", params={"limit": 2}).json()
    assert page["total"] == 4  # login 포함
    assert [i["action"] for i in page["items"]] == ["delete", "update"]
    assert page["items"][0]["username"] == "admin1"
    filtered = admin_client.get("/api/admin/audit", params={"entity": "users"}).json()
    assert [i["action"] for i in filtered["items"]] == ["login"]


def test_failed_mutation_leaves_no_audit_row(admin_client: TestClient, db) -> None:
    admin_client.post("/api/admin/schedule", json=SCHEDULE_BODY)
    conflict = admin_client.patch("/api/admin/schedule/1", json={"version": 9, "title_ko": "x"})
    assert conflict.status_code == 409
    actions = db.scalars(select(AuditLog.action).where(AuditLog.entity == "schedule_items")).all()
    assert actions == ["create"]


def test_validation_error_format(admin_client: TestClient) -> None:
    response = admin_client.post("/api/admin/schedule", json={"title_ko": ""})
    assert response.status_code == 422
    body = response.json()
    assert body["code"] == "VALIDATION_ERROR"
    assert "starts_at" in body["detail"] and "title_ko" in body["detail"]
    assert {tuple(e["loc"]) for e in body["errors"]} >= {("body", "starts_at")}
