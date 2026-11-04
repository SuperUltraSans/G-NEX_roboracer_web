"""게시: 고친 일정·규칙·사이트 설정은 '게시'해야 공개 사이트에 보인다. 미리보기는 관리자에게만."""

from datetime import datetime
from zoneinfo import ZoneInfo

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.config import Settings
from app.main import create_app
from app.models import PublishedContent, ScheduleItem
from app.services import publishing
from tests.conftest import FETCH, publish
from tests.test_content import OPEN_PAGES, make_item, make_rule

ADMIN = "/api/admin"


def states(client: TestClient) -> dict[str, dict]:
    return {s["resource"]: s for s in client.get(f"{ADMIN}/publish").json()}


def test_schedule_is_a_draft_until_published(admin_client: TestClient) -> None:
    assert not any(s["pending"] for s in states(admin_client).values())
    item = make_item(admin_client)
    # 고친 것은 공개 사이트에 바로 보이지 않고 미리보기에만 보인다
    assert admin_client.get("/api/schedule").json() == []
    assert [i["id"] for i in admin_client.get(f"{ADMIN}/preview/schedule").json()] == [item["id"]]
    assert states(admin_client)["schedule"]["pending"] is True
    assert states(admin_client)["rules"]["pending"] is False

    published = admin_client.post(f"{ADMIN}/publish/schedule").json()
    assert published["pending"] is False and published["published_by"] == "admin1"
    assert [i["id"] for i in admin_client.get("/api/schedule").json()] == [item["id"]]

    # 지워도 게시하기 전까지 공개 사이트에는 남는다
    assert admin_client.delete(f"{ADMIN}/schedule/{item['id']}").status_code == 204
    assert len(admin_client.get("/api/schedule").json()) == 1
    publish(admin_client, "schedule")
    assert admin_client.get("/api/schedule").json() == []


def test_rules_and_audit(admin_client: TestClient) -> None:
    make_rule(admin_client, body_ko="임시 긴 본문")
    assert admin_client.get("/api/rules").json() == []
    assert len(admin_client.get(f"{ADMIN}/preview/rules").json()) == 1
    publish(admin_client, "rules")
    assert len(admin_client.get("/api/rules").json()) == 1
    log = admin_client.get(f"{ADMIN}/audit").json()["items"][0]
    assert (log["action"], log["entity"], log["entity_id"]) == (
        "publish",
        "published_content",
        "rules",
    )
    # 변경 이력에는 본문을 통째로 남기지 않는다
    assert log["after"] == {"titles": ["임시 규칙"]}


def test_settings_and_pages_are_drafts(admin_client: TestClient) -> None:
    admin_client.put(f"{ADMIN}/settings/monitor", json={"key": "secret-key-1"})
    admin_client.put(f"{ADMIN}/settings", json={"apply_form_url": "https://forms.gle/example"})
    closed = {**OPEN_PAGES, "schedule": {"open": False, "note_ko": "작업 중", "note_en": None}}
    admin_client.put(f"{ADMIN}/settings/pages", json=closed)
    make_item(admin_client)
    publish(admin_client, "schedule")

    public = admin_client.get("/api/settings/public").json()
    assert public["apply_form_url"] is None and public["pages"]["schedule"]["open"] is True
    assert len(admin_client.get("/api/schedule").json()) == 1  # 닫기도 게시해야 적용된다
    preview = admin_client.get(f"{ADMIN}/preview/settings").json()
    assert preview["apply_form_url"] == "https://forms.gle/example"
    assert preview["pages"]["schedule"]["open"] is False
    # 미리보기는 닫힌 페이지의 내용도 보여 준다 (게시 전에 실제 화면을 확인하게)
    assert len(admin_client.get(f"{ADMIN}/preview/schedule").json()) == 1

    publish(admin_client, "settings")
    public = admin_client.get("/api/settings/public").json()
    assert public["apply_form_url"] == "https://forms.gle/example"
    assert admin_client.get("/api/schedule").json()["code"] == "PAGE_CLOSED"
    # 모니터링 관리 비밀 값은 게시하지 않고, 공개본·미리보기·변경 이력 어디에도 없다
    assert "monitor_key" not in public and "monitor_key" not in preview
    assert "secret-key-1" not in str(admin_client.get(f"{ADMIN}/audit").json())


def test_publish_needs_admin(app: FastAPI, admin_client: TestClient, settings: Settings) -> None:
    admin_client.put(f"{ADMIN}/settings/monitor", json={"key": "secret-key-1"})
    paths = [
        ("GET", f"{ADMIN}/publish"),
        ("POST", f"{ADMIN}/publish/schedule"),
        ("GET", f"{ADMIN}/preview/settings"),
        ("GET", f"{ADMIN}/preview/schedule"),
        ("GET", f"{ADMIN}/preview/rules"),
    ]
    with TestClient(app, headers={**FETCH, "X-Monitor-Key": "secret-key-1"}) as monitor:
        for method, path in paths:
            assert monitor.request(method, path).status_code == 401, path
    assert admin_client.post(f"{ADMIN}/publish/unknown").status_code == 422


def test_published_copy_survives_restart(settings: Settings, admin_client: TestClient) -> None:
    make_item(admin_client)
    # 서버를 다시 띄워도 게시하지 않은 것이 공개되지 않는다 (처음 한 번만 지금 내용으로 만든다)
    again = create_app(settings)
    with TestClient(again) as client:
        assert client.get("/api/schedule").json() == []
    again.state.engine.dispose()


def test_referee_cannot_publish(referee_client: TestClient) -> None:
    assert referee_client.post(f"{ADMIN}/publish/schedule").status_code == 403
    assert referee_client.get(f"{ADMIN}/preview/schedule").status_code == 403


def test_same_instant_in_other_timezone_is_not_a_change(
    db: Session, admin_client: TestClient
) -> None:
    """같은 시각을 +09:00 으로 들고 있다가 게시해도, 다시 읽으면 '게시 전 변경'이 아니다."""
    start = datetime(2026, 11, 1, 18, 30, tzinfo=ZoneInfo("Asia/Seoul"))
    db.add(ScheduleItem(starts_at=start, title_ko="임시", sort_order=1))
    db.flush()
    publishing.publish(db, "schedule", None)
    db.commit()
    assert states(admin_client)["schedule"]["pending"] is False


def test_new_field_in_old_published_copy_is_not_a_change(
    db: Session, admin_client: TestClient
) -> None:
    """예전에 게시한 공개본에 새 칸(예: 규칙의 level)이 없어도 '게시 전 변경'으로 보지 않는다."""
    make_rule(admin_client)
    publish(admin_client, "rules")
    row = db.get(PublishedContent, "rules")
    row.data = [{k: v for k, v in item.items() if k != "level"} for item in row.data]
    db.commit()
    assert states(admin_client)["rules"]["pending"] is False
    assert admin_client.get("/api/rules").json()[0]["level"] == 2
