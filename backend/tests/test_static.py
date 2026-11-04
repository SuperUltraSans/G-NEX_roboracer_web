from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.schemas.competition import AwardItem
from app.services.results import write_awards
from tests.conftest import add_teams

INDEX = (
    '<!doctype html><html lang="ko"><head><title>RoboRacer</title>'
    '<script type="module" src="/roboracer/assets/app-abc123.js"></script></head>'
    '<body><div id="root"></div></body></html>'
)


@pytest.fixture
def dist(settings: Settings) -> Path:
    root = settings.frontend_dist
    (root / "assets").mkdir(parents=True)
    (root / "index.html").write_text(INDEX)
    (root / "assets" / "app-abc123.js").write_text("console.log(1)")
    (root / "hero").mkdir()
    (root / "hero" / "hero.webp").write_bytes(b"RIFF")
    (root.parent / "secret.txt").write_text("outside dist")
    return root


def test_spa_fallback_and_static_files(dist: Path, client: TestClient) -> None:
    for path in ("/", "/schedule", "/admin/login", "/live?x=1"):
        response = client.get(path)
        assert response.status_code == 200, path
        assert "app-abc123.js" in response.text
        assert response.headers["cache-control"] == "no-cache"

    asset = client.get("/assets/app-abc123.js")
    assert asset.text == "console.log(1)"
    assert "immutable" in asset.headers["cache-control"]
    assert client.get("/hero/hero.webp").content == b"RIFF"
    assert client.head("/schedule").status_code == 200

    # 해시 파일이 없으면 HTML 대신 404
    assert client.get("/assets/old-chunk.js").status_code == 404
    # dist 밖의 파일은 내주지 않는다
    assert "outside" not in client.get("/..%2fsecret.txt").text
    assert "outside" not in client.get("/hero/..%2f..%2fsecret.txt").text


def test_api_and_ws_paths_never_fall_back(dist: Path, client: TestClient) -> None:
    for path in ("/api", "/api/nope", "/api/admin/nope", "/ws/live", "/ws/other"):
        response = client.get(path)
        assert response.status_code == 404, path
        assert response.json()["code"] == "NOT_FOUND"
    assert client.post("/schedule").status_code in (404, 405)
    # 있는 경로에 다른 메서드는 405 그대로
    wrong_method = client.delete("/api/settings/public")
    assert wrong_method.status_code == 405
    assert wrong_method.json()["code"] == "METHOD_NOT_ALLOWED"


def test_without_dist_everything_is_json_404(client: TestClient) -> None:
    response = client.get("/schedule")
    assert response.status_code == 404
    assert response.json()["code"] == "NOT_FOUND"


def test_docs_disabled_in_production(settings: Settings) -> None:
    dev = create_app(settings)
    prod = create_app(settings.model_copy(update={"app_env": "production"}))
    apps: list[FastAPI] = [dev, prod]
    with TestClient(dev) as client:
        assert client.get("/api/openapi.json").status_code == 200
    with TestClient(prod) as client:
        assert client.get("/api/openapi.json").status_code == 404
        assert client.get("/api/docs").status_code == 404
    for app in apps:
        app.state.engine.dispose()


# ---- 검색엔진용 HTML ----


def test_pages_get_title_description_and_readable_body(dist: Path, client: TestClient) -> None:
    home = client.get("/").text
    assert "<title>2026 RoboRacer G-NEX CHAMPIONSHIP | 자율주행 레이싱 대회</title>" in home
    assert '<meta name="description" content="인제대학교 앵커사업단이 주최하는' in home
    assert '"@type": "Event"' in home and '"startDate": "2026-11-01"' in home
    # 화면을 그리기 전에도 읽을 내용과 다른 페이지로 가는 링크가 있다 (배포 경로를 붙여서)
    assert "<h1>2026 RoboRacer G-NEX CHAMPIONSHIP</h1>" in home
    assert '<a href="/roboracer/schedule">일정</a>' in home
    # 공개 주소를 정하지 않았으면 대표 주소·사이트맵을 내지 않는다
    assert 'rel="canonical"' not in home
    assert client.get("/sitemap.xml").status_code == 404

    schedule = client.get("/schedule").text
    assert "<title>일정 | 2026 RoboRacer G-NEX CHAMPIONSHIP</title>" in schedule
    assert "<h1>일정</h1>" in schedule and '"@type": "Event"' not in schedule

    results = client.get("/results").text
    assert "<title>대회 결과 | 2026 RoboRacer G-NEX CHAMPIONSHIP</title>" in results
    assert "<h1>대회 결과</h1>" in results and '<a href="/roboracer/results">결과</a>' in results


def test_private_and_unknown_pages(dist: Path, client: TestClient) -> None:
    for path in ("/admin", "/admin/login", "/monitoring-admin"):
        response = client.get(path)
        assert response.status_code == 200 and 'content="noindex"' in response.text, path
    missing = client.get("/no-such-page")
    # 없는 주소도 화면(앱의 '페이지 없음')은 내주되 상태는 404 로 알린다
    assert missing.status_code == 404 and "app-abc123.js" in missing.text
    assert 'content="noindex"' in missing.text
    assert client.get("/schedule/extra").status_code == 404


def test_public_url_canonical_sitemap_and_verification(settings: Settings, dist: Path) -> None:
    settings = settings.model_copy(
        update={
            "public_url": "https://example.com/roboracer/",
            "google_site_verification": "google-code",
            "naver_site_verification": "naver-code",
        }
    )
    app = create_app(settings)
    with TestClient(app, headers={"X-Requested-With": "fetch"}) as client:
        apply = client.get("/apply").text
        assert '<link rel="canonical" href="https://example.com/roboracer/apply" />' in apply
        assert 'content="https://example.com/roboracer/hero/hero-1280.jpg"' in apply
        assert '<meta name="google-site-verification" content="google-code" />' in apply
        assert '<meta name="naver-site-verification" content="naver-code" />' in apply

        sitemap = client.get("/sitemap.xml")
        assert sitemap.headers["content-type"].startswith("application/xml")
        locs = sitemap.text.count("<loc>")
        assert "<loc>https://example.com/roboracer/</loc>" in sitemap.text and locs == 6
    app.state.engine.dispose()


def test_published_content_and_closed_pages_in_body(
    settings: Settings, dist: Path, admin_client: TestClient
) -> None:
    admin_client.post(
        "/api/admin/schedule",
        json={"starts_at": "2026-11-01T00:30:00Z", "title_ko": "임시 <개회식>"},
    )
    # 게시하기 전에는 본문에 없다
    assert "개회식" not in admin_client.get("/schedule").text
    admin_client.post("/api/admin/publish/schedule")
    body = admin_client.get("/schedule").text
    # 대회 시간대로 보이고, 글은 HTML 로 해석되지 않게 이스케이프한다
    assert "11월 1일 (일) 09:30 임시 &lt;개회식&gt;" in body

    closed = {
        page: {"open": page != "schedule", "note_ko": "작업 중입니다", "note_en": None}
        for page in ("schedule", "rules", "live")
    }
    admin_client.put("/api/admin/settings/pages", json=closed)
    admin_client.post("/api/admin/publish/settings")
    body = admin_client.get("/schedule").text
    assert "작업 중입니다" in body and "개회식" not in body


def test_results_body(dist: Path, app: FastAPI, client: TestClient) -> None:
    assert "시상이 끝나면" in client.get("/results").text
    t1, t2, t3 = add_teams(app, 3)
    with app.state.session_factory() as db:
        items = [(t1, "grand"), (t2, "merit"), (t3, "merit")]
        write_awards(db, [AwardItem(team_id=t, award=a) for t, a in items], None)
        db.commit()
    body = client.get("/results").text
    assert "<li>대상 · Mock Team 01</li>" in body
    assert "<li>우수상 · Mock Team 02, Mock Team 03</li>" in body
    assert "위" not in body.split("<main>")[1]
