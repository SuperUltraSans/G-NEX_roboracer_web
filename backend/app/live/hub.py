"""공개 실시간 피드 (/ws/live).

허브가 프로세스 메모리에 있으므로 uvicorn 은 반드시 워커 1개로 실행한다.
"""

import asyncio
import contextlib
import json
import logging
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any

from fastapi import WebSocket
from starlette.concurrency import run_in_threadpool

logger = logging.getLogger(__name__)

SEND_TIMEOUT_SECONDS = 2.0


def _now_iso() -> str:
    return datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


class LiveHub:
    def __init__(self, snapshot_provider: Callable[[], dict[str, Any]]) -> None:
        self._snapshot_provider = snapshot_provider
        self._connections: set[WebSocket] = set()
        self._seq = 0
        # 스냅샷 전송과 브로드캐스트를 직렬화해서 seq 순서가 뒤섞이지 않게 한다.
        self._lock = asyncio.Lock()

    @property
    def connection_count(self) -> int:
        return len(self._connections)

    def _encode(self, type_: str, data: Any) -> str:
        return json.dumps(
            {"type": type_, "seq": self._seq, "ts": _now_iso(), "data": data},
            ensure_ascii=False,
            separators=(",", ":"),
        )

    async def _send(self, websocket: WebSocket, text: str) -> bool:
        try:
            await asyncio.wait_for(websocket.send_text(text), SEND_TIMEOUT_SECONDS)
            return True
        except Exception:
            self._connections.discard(websocket)
            logger.info("live: 전송 실패로 연결을 정리합니다")
            with contextlib.suppress(Exception):
                await asyncio.wait_for(websocket.close(), SEND_TIMEOUT_SECONDS)
            return False

    async def connect(self, websocket: WebSocket) -> bool:
        """accept → (락) 스냅샷 생성 → 등록 → 스냅샷 전송. 전송에 실패하면 False."""
        await websocket.accept()
        async with self._lock:
            data = await run_in_threadpool(self._snapshot_provider)
            self._connections.add(websocket)
            return await self._send(websocket, self._encode("snapshot", data))

    def disconnect(self, websocket: WebSocket) -> None:
        self._connections.discard(websocket)

    async def broadcast(self, type_: str, data: Any) -> None:
        async with self._lock:
            self._seq += 1
            text = self._encode(type_, data)
            targets = list(self._connections)
            await asyncio.gather(*(self._send(ws, text) for ws in targets))

    async def pong(self, websocket: WebSocket) -> None:
        # pong 은 상태 이벤트가 아니므로 seq 를 올리지 않는다.
        async with self._lock:
            await self._send(websocket, self._encode("pong", {}))
