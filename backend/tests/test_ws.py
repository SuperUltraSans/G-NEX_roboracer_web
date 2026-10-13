import asyncio
from typing import Any

from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import TypeAdapter
from starlette.testclient import WebSocketTestSession

from app.live.hub import LiveHub
from app.schemas.live import LiveMessage
from tests.conftest import add_teams

messages = TypeAdapter(LiveMessage)


def receive(ws: WebSocketTestSession) -> dict[str, Any]:
    message = ws.receive_json()
    messages.validate_python(message)  # schemas/live.py 형식을 지키는지 검사
    return message


def ping(ws: WebSocketTestSession) -> dict[str, Any]:
    """대기 중인 메시지가 없음을 확인할 때 쓴다: 바로 다음 메시지가 pong 이어야 한다."""
    ws.send_json({"type": "ping"})
    return receive(ws)


def test_snapshot_on_connect(app: FastAPI, client: TestClient) -> None:
    add_teams(app, 2)
    with client.websocket_connect("/ws/live") as ws:
        snapshot = receive(ws)
    assert snapshot["type"] == "snapshot"
    assert snapshot["seq"] == 0
    assert snapshot["ts"].endswith("Z")
    data = snapshot["data"]
    assert set(data) == {"live_state", "leaderboard", "bracket"}
    assert data["live_state"]["phase"] == "idle"
    assert [row["team"]["car_number"] for row in data["leaderboard"]["rows"]] == [1, 2]
    assert data["bracket"] == {"rounds": []}
    # REST 와 같은 스키마로 직렬화한다
    assert data["leaderboard"] == client.get("/api/qualifying/leaderboard").json()


def test_ping_pong_and_ignored_messages(client: TestClient) -> None:
    with client.websocket_connect("/ws/live") as ws:
        receive(ws)
        ws.send_text("not json")
        ws.send_json({"type": "subscribe"})
        ws.send_bytes(b"\x00")
        pong = ping(ws)
    assert pong["type"] == "pong"
    assert pong["data"] == {}
    assert pong["seq"] == 0


def test_lap_post_broadcasts_leaderboard(app: FastAPI, admin_client: TestClient) -> None:
    [team_id] = add_teams(app, 1)
    with admin_client.websocket_connect("/ws/live") as ws:
        snapshot = receive(ws)
        lap = {"team_id": team_id, "lap_time_ms": 42_137, "status": "valid"}
        assert admin_client.post("/api/admin/qualifying/laps", json=lap).status_code == 201
        event = receive(ws)
        assert event["type"] == "qualifying.updated"
        assert event["seq"] == snapshot["seq"] + 1
        assert event["data"]["rows"][0]["best_lap_ms"] == 42_137
        assert event["data"]["rows"][0]["rank"] == 1

        # 검증에 실패한 요청은 방송하지 않는다
        bad = {"team_id": team_id, "lap_time_ms": 999, "status": "valid"}
        assert admin_client.post("/api/admin/qualifying/laps", json=bad).status_code == 422
        assert ping(ws)["type"] == "pong"


def test_schedule_change_broadcasts_content_updated(admin_client: TestClient) -> None:
    with admin_client.websocket_connect("/ws/live") as ws:
        receive(ws)
        item = admin_client.post(
            "/api/admin/schedule",
            json={"starts_at": "2026-11-01T01:00:00Z", "title_ko": "임시 일정"},
        ).json()
        created = receive(ws)
        assert created["type"] == "content.updated"
        assert created["data"] == {"resource": "schedule"}

        admin_client.patch(
            f"/api/admin/schedule/{item['id']}", json={"version": 1, "title_ko": "임시 수정"}
        )
        updated = receive(ws)
        assert (updated["type"], updated["data"]) == ("content.updated", {"resource": "schedule"})
        assert updated["seq"] == created["seq"] + 1

        stale = admin_client.patch(
            f"/api/admin/schedule/{item['id']}", json={"version": 1, "title_ko": "x"}
        )
        assert stale.status_code == 409
        assert ping(ws)["type"] == "pong"

        admin_client.post("/api/admin/rules", json={"title_ko": "임시 규칙"})
        assert receive(ws)["data"] == {"resource": "rules"}
        admin_client.put("/api/admin/settings", json={"apply_form_url": "https://example.com"})
        assert receive(ws)["data"] == {"resource": "settings"}


def test_team_change_broadcasts_everything_that_shows_teams(
    app: FastAPI, admin_client: TestClient
) -> None:
    [team_id] = add_teams(app, 1)
    with admin_client.websocket_connect("/ws/live") as ws:
        receive(ws)
        admin_client.patch(
            f"/api/admin/teams/{team_id}", json={"version": 1, "name_en": "Temporary renamed"}
        )
        events = [receive(ws) for _ in range(4)]
    assert [e["type"] for e in events] == [
        "content.updated",
        "qualifying.updated",
        "bracket.updated",
        "live_state.updated",
    ]
    assert events[0]["data"] == {"resource": "teams"}
    assert events[1]["data"]["rows"][0]["team"]["name_en"] == "Temporary renamed"
    assert [e["seq"] for e in events] == [1, 2, 3, 4]


def test_bracket_and_live_state_broadcasts(app: FastAPI, admin_client: TestClient) -> None:
    [team_id] = add_teams(app, 1)
    with admin_client.websocket_connect("/ws/live") as ws:
        receive(ws)
        admin_client.post("/api/admin/bracket/generate", json={"size": 2})
        event = receive(ws)
        assert event["type"] == "bracket.updated"
        assert event["data"]["rounds"][0]["matches"][0]["label"] == "M1"

        admin_client.put(
            "/api/admin/live/state", json={"phase": "qualifying", "on_track_team_id": team_id}
        )
        event = receive(ws)
        assert event["type"] == "live_state.updated"
        assert event["data"]["on_track_team"]["id"] == team_id


def test_snapshot_reflects_state_and_seq_after_events(
    app: FastAPI, admin_client: TestClient
) -> None:
    [team_id] = add_teams(app, 1)
    with admin_client.websocket_connect("/ws/live") as first:
        receive(first)
        admin_client.post(
            "/api/admin/qualifying/laps",
            json={"team_id": team_id, "lap_time_ms": 40_000, "status": "valid"},
        )
        assert receive(first)["seq"] == 1
        # 나중에 붙은 클라이언트의 스냅샷은 최신 상태와 현재 seq 를 담는다
        with admin_client.websocket_connect("/ws/live") as second:
            snapshot = receive(second)
            assert snapshot["seq"] == 1
            assert snapshot["data"]["leaderboard"]["rows"][0]["best_lap_ms"] == 40_000
            admin_client.post("/api/admin/rules", json={"title_ko": "임시 규칙"})
            assert receive(first)["seq"] == receive(second)["seq"] == 2
    assert app.state.hub.connection_count == 0


class _BrokenSocket:
    def __init__(self) -> None:
        self.closed = False

    async def accept(self) -> None:
        pass

    async def send_text(self, text: str) -> None:
        raise RuntimeError("connection lost")

    async def close(self) -> None:
        self.closed = True


class _SlowSocket(_BrokenSocket):
    async def send_text(self, text: str) -> None:
        await asyncio.sleep(10)


class _RecordingSocket(_BrokenSocket):
    def __init__(self) -> None:
        super().__init__()
        self.sent: list[str] = []

    async def send_text(self, text: str) -> None:
        self.sent.append(text)


def test_hub_drops_failed_and_slow_connections(monkeypatch) -> None:
    monkeypatch.setattr("app.live.hub.SEND_TIMEOUT_SECONDS", 0.05)
    hub = LiveHub(lambda: {"ok": True})
    good, broken, slow = _RecordingSocket(), _BrokenSocket(), _SlowSocket()

    async def scenario() -> None:
        assert await hub.connect(good)
        assert not await hub.connect(broken)
        hub._connections.add(slow)
        await hub.broadcast("content.updated", {"resource": "rules"})

    asyncio.run(scenario())
    assert hub.connection_count == 1
    assert broken.closed and slow.closed
    assert len(good.sent) == 2
    assert '"seq":1' in good.sent[1]
