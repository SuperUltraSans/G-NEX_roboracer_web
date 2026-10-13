from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app


@pytest.fixture
def dist(settings: Settings) -> Path:
    root = settings.frontend_dist
    (root / "assets").mkdir(parents=True)
    (root / "index.html").write_text("<!doctype html><title>SPA</title>")
    (root / "assets" / "app-abc123.js").write_text("console.log(1)")
    (root / "hero").mkdir()
    (root / "hero" / "hero.webp").write_bytes(b"RIFF")
    (root.parent / "secret.txt").write_text("outside dist")
    return root


def test_spa_fallback_and_static_files(dist: Path, client: TestClient) -> None:
    for path in ("/", "/schedule", "/admin/login", "/live?x=1"):
        response = client.get(path)
        assert response.status_code == 200, path
        assert "SPA" in response.text
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
