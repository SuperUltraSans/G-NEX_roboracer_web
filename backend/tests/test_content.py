from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models import SiteSetting

SCHEDULE = "/api/admin/schedule"
RULES = "/api/admin/rules"


def make_item(client: TestClient, **overrides: object) -> dict:
    body = {"starts_at": "2026-11-01T01:00:00Z", "title_ko": "임시 일정", **overrides}
    response = client.post(SCHEDULE, json=body)
    assert response.status_code == 201, response.text
    return response.json()


def make_rule(client: TestClient, **overrides: object) -> dict:
    response = client.post(RULES, json={"title_ko": "임시 규칙", **overrides})
    assert response.status_code == 201, response.text
    return response.json()


# ---- 신청 설정 ----


def test_settings_defaults_and_update(admin_client: TestClient) -> None:
    empty = {"apply_form_url": None, "apply_open_at": None, "apply_close_at": None}
    assert admin_client.get("/api/admin/settings").json() == empty
    public = admin_client.get("/api/settings/public")
    assert public.json() == {**empty, "event_timezone": "Asia/Seoul"}
    assert public.headers["cache-control"] == "no-store"

    body = {
        "apply_form_url": " https://forms.gle/example ",
        "apply_open_at": "2026-10-20T09:00:00+09:00",
        "apply_close_at": "2026-10-31T23:59:00+09:00",
    }
    saved = admin_client.put("/api/admin/settings", json=body).json()
    assert saved == {
        "apply_form_url": "https://forms.gle/example",
        "apply_open_at": "2026-10-20T00:00:00Z",
        "apply_close_at": "2026-10-31T14:59:00Z",
    }
    assert (
        admin_client.get("/api/settings/public").json()["apply_open_at"] == saved["apply_open_at"]
    )

    cleared = admin_client.put("/api/admin/settings", json={"apply_form_url": ""}).json()
    assert cleared == empty


def test_settings_validation(admin_client: TestClient) -> None:
    for body in (
        {"apply_form_url": "http://forms.gle/example"},
        {"apply_form_url": "javascript:alert(1)"},
        {"apply_form_url": "https://"},
        {"apply_open_at": "2026-10-20T09:00:00"},  # naive
        {"apply_open_at": "2026-10-31T00:00:00Z", "apply_close_at": "2026-10-30T00:00:00Z"},
    ):
        response = admin_client.put("/api/admin/settings", json=body)
        assert response.status_code == 422, body
        assert response.json()["code"] == "VALIDATION_ERROR"


def test_leftover_settings_rows_are_ignored(admin_client: TestClient, db: Session) -> None:
    # 예전 버전이 남긴 design 행이 있어도 읽기·쓰기에 나오지 않고 그대로 남는다
    db.add(SiteSetting(key="design", value="poster"))
    db.commit()
    assert "design" not in admin_client.get("/api/admin/settings").json()
    assert "design" not in admin_client.get("/api/settings/public").json()

    body = {"apply_form_url": "https://forms.gle/example", "design": "sensor"}
    saved = admin_client.put("/api/admin/settings", json=body)
    assert saved.status_code == 200 and "design" not in saved.json()
    db.expire_all()
    assert db.get(SiteSetting, "design").value == "poster"


# ---- 일정 ----


def test_schedule_crud_and_public_visibility(admin_client: TestClient) -> None:
    item = make_item(admin_client, ends_at="2026-11-01T02:00:00Z", location_ko="  ")
    assert item["version"] == 1
    assert item["is_published"] is True
    assert item["title_en"] == "" and item["location_ko"] is None
    hidden = make_item(admin_client, title_ko="임시 비공개", is_published=False)

    public = admin_client.get("/api/schedule")
    assert public.headers["cache-control"] == "no-store"
    assert [i["id"] for i in public.json()] == [item["id"]]
    assert "is_published" not in public.json()[0]
    assert {i["id"] for i in admin_client.get(SCHEDULE).json()} == {item["id"], hidden["id"]}

    updated = admin_client.patch(
        f"{SCHEDULE}/{item['id']}", json={"version": 1, "title_en": "Temporary session"}
    )
    assert updated.status_code == 200
    assert updated.json()["version"] == 2
    assert updated.json()["title_en"] == "Temporary session"
    assert updated.json()["title_ko"] == "임시 일정"

    published = admin_client.patch(
        f"{SCHEDULE}/{hidden['id']}", json={"version": 1, "is_published": True}
    )
    assert published.status_code == 200
    assert len(admin_client.get("/api/schedule").json()) == 2

    assert admin_client.delete(f"{SCHEDULE}/{item['id']}").status_code == 204
    assert admin_client.delete(f"{SCHEDULE}/{item['id']}").status_code == 404
    assert [i["id"] for i in admin_client.get("/api/schedule").json()] == [hidden["id"]]


def test_schedule_version_conflict(admin_client: TestClient) -> None:
    item = make_item(admin_client)
    url = f"{SCHEDULE}/{item['id']}"
    assert admin_client.patch(url, json={"version": 1, "title_ko": "임시 A"}).status_code == 200
    stale = admin_client.patch(url, json={"version": 1, "title_ko": "임시 B"})
    assert stale.status_code == 409
    assert stale.json()["code"] == "VERSION_CONFLICT"
    assert admin_client.get(SCHEDULE).json()[0]["title_ko"] == "임시 A"
    missing = admin_client.patch(f"{SCHEDULE}/999", json={"version": 1})
    assert missing.status_code == 404


def test_schedule_time_validation(admin_client: TestClient) -> None:
    bad = admin_client.post(
        SCHEDULE,
        json={
            "starts_at": "2026-11-01T01:00:00Z",
            "ends_at": "2026-11-01T00:59:00Z",
            "title_ko": "임시",
        },
    )
    assert bad.status_code == 422
    naive = admin_client.post(SCHEDULE, json={"starts_at": "2026-11-01T01:00:00", "title_ko": "x"})
    assert naive.status_code == 422

    item = make_item(admin_client, ends_at="2026-11-01T02:00:00Z")
    url = f"{SCHEDULE}/{item['id']}"
    moved = admin_client.patch(url, json={"version": 1, "starts_at": "2026-11-01T03:00:00Z"})
    assert moved.status_code == 422
    # 종료 시각을 지우면 시작만 옮길 수 있다
    ok = admin_client.patch(
        url, json={"version": 1, "starts_at": "2026-11-01T03:00:00Z", "ends_at": None}
    )
    assert ok.status_code == 200
    assert ok.json()["ends_at"] is None
    assert admin_client.patch(url, json={"version": 2, "title_ko": None}).status_code == 422


def test_schedule_public_order_and_reorder(admin_client: TestClient) -> None:
    late = make_item(admin_client, starts_at="2026-11-01T05:00:00Z", title_ko="임시 늦은")
    a = make_item(admin_client, title_ko="임시 A")
    b = make_item(admin_client, title_ko="임시 B")
    titles = [i["title_ko"] for i in admin_client.get("/api/schedule").json()]
    assert titles == ["임시 A", "임시 B", "임시 늦은"]

    reordered = admin_client.put(f"{SCHEDULE}/order", json={"ids": [b["id"], a["id"], late["id"]]})
    assert reordered.status_code == 200
    titles = [i["title_ko"] for i in admin_client.get("/api/schedule").json()]
    assert titles == ["임시 B", "임시 A", "임시 늦은"]

    partial = admin_client.put(f"{SCHEDULE}/order", json={"ids": [a["id"], b["id"]]})
    assert partial.status_code == 422
    duplicated = admin_client.put(f"{SCHEDULE}/order", json={"ids": [a["id"], a["id"], b["id"]]})
    assert duplicated.status_code == 422


# ---- 규칙 ----


def test_rules_crud_order_and_visibility(admin_client: TestClient) -> None:
    first = make_rule(admin_client, body_ko="- 임시 항목\n\n| a | b |\n|---|---|\n| 1 | 2 |")
    second = make_rule(admin_client, title_ko="임시 두 번째")
    draft = make_rule(admin_client, title_ko="임시 초안", is_published=False)
    assert [first["sort_order"], second["sort_order"], draft["sort_order"]] == [1, 2, 3]

    public = admin_client.get("/api/rules").json()
    assert [r["id"] for r in public] == [first["id"], second["id"]]
    assert public[0]["body_ko"].startswith("- 임시 항목")
    assert "updated_at" in public[0]

    order = [draft["id"], second["id"], first["id"]]
    assert admin_client.put(f"{RULES}/order", json={"ids": order}).status_code == 200
    assert [r["id"] for r in admin_client.get(RULES).json()] == order
    assert [r["id"] for r in admin_client.get("/api/rules").json()] == [second["id"], first["id"]]

    url = f"{RULES}/{first['id']}"
    edited = admin_client.patch(url, json={"version": 1, "body_en": "Temporary body"})
    assert edited.status_code == 200 and edited.json()["version"] == 2
    stale = admin_client.patch(url, json={"version": 1, "body_en": "x"})
    assert stale.status_code == 409 and stale.json()["code"] == "VERSION_CONFLICT"
    assert admin_client.patch(url, json={"version": 2, "title_ko": "   "}).status_code == 422

    assert admin_client.delete(url).status_code == 204
    assert [r["id"] for r in admin_client.get("/api/rules").json()] == [second["id"]]


# ---- 팀 ----


def test_teams_crud_and_public_filter(admin_client: TestClient) -> None:
    created = admin_client.post(
        "/api/admin/teams",
        json={"car_number": 7, "name_ko": "Mock Team 07", "affiliation_ko": "Mock University"},
    )
    assert created.status_code == 201
    team = created.json()
    assert team["version"] == 1 and team["is_active"] is True and team["name_en"] == ""
    other = admin_client.post("/api/admin/teams", json={"car_number": 3, "name_ko": "Mock 03"})

    duplicate = admin_client.post("/api/admin/teams", json={"car_number": 7, "name_ko": "Dup"})
    assert duplicate.status_code == 409 and duplicate.json()["code"] == "DUPLICATE"

    assert [t["car_number"] for t in admin_client.get("/api/teams").json()] == [3, 7]
    url = f"/api/admin/teams/{team['id']}"
    deactivated = admin_client.patch(url, json={"version": 1, "is_active": False})
    assert deactivated.status_code == 200 and deactivated.json()["version"] == 2
    public = admin_client.get("/api/teams").json()
    assert [t["car_number"] for t in public] == [3]
    assert "is_active" not in public[0]
    assert len(admin_client.get("/api/admin/teams").json()) == 2

    stale = admin_client.patch(url, json={"version": 1, "name_ko": "x"})
    assert stale.status_code == 409 and stale.json()["code"] == "VERSION_CONFLICT"
    clash = admin_client.patch(url, json={"version": 2, "car_number": 3})
    assert clash.status_code == 409 and clash.json()["code"] == "DUPLICATE"
    assert other.json()["car_number"] == 3
    # 팀 삭제는 제공하지 않는다
    assert admin_client.delete(url).status_code == 405
