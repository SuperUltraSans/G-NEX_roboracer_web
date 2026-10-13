from fastapi.testclient import TestClient


def test_health(client: TestClient) -> None:
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
    assert response.headers["cache-control"] == "no-store"


def test_unknown_api_path_is_json_404(client: TestClient) -> None:
    response = client.get("/api/nope")
    assert response.status_code == 404
    assert response.json()["code"] == "NOT_FOUND"
