import json

from fastapi import APIRouter, WebSocket

router = APIRouter()


def _is_ping(text: str | None) -> bool:
    if not text:
        return False
    try:
        message = json.loads(text)
    except ValueError:
        return False
    return isinstance(message, dict) and message.get("type") == "ping"


@router.websocket("/ws/live")
async def live_feed(websocket: WebSocket) -> None:
    """서버 → 클라이언트 단방향 피드. 클라이언트는 {"type":"ping"} 만 보낸다."""
    hub = websocket.app.state.hub
    if not await hub.connect(websocket):
        return
    try:
        while True:
            message = await websocket.receive()
            if message["type"] == "websocket.disconnect":
                break
            if _is_ping(message.get("text")):
                await hub.pong(websocket)
    finally:
        hub.disconnect(websocket)
