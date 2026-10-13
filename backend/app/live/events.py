from collections.abc import Callable
from typing import Annotated, Any

from fastapi import BackgroundTasks, Depends, Request
from sqlalchemy.orm import Session, sessionmaker

from app.db import DbSession
from app.schemas.live import ContentResource, SnapshotData
from app.services.bracket import build_bracket
from app.services.leaderboard import build_leaderboard
from app.services.live_state import build_live_state


def build_snapshot(db: Session) -> SnapshotData:
    return SnapshotData(
        live_state=build_live_state(db),
        leaderboard=build_leaderboard(db),
        bracket=build_bracket(db),
    )


def snapshot_provider(session_factory: sessionmaker[Session]) -> Callable[[], dict[str, Any]]:
    def provide() -> dict[str, Any]:
        with session_factory() as db:
            return build_snapshot(db).model_dump(mode="json")

    return provide


class LiveEvents:
    """관리자 라우트가 커밋한 뒤 호출한다. payload 는 지금 만들고 전송은 응답 뒤로 미룬다."""

    def __init__(self, request: Request, background_tasks: BackgroundTasks, db: DbSession) -> None:
        self._hub = request.app.state.hub
        self._tasks = background_tasks
        self._db = db

    def _publish(self, type_: str, data: dict[str, Any]) -> None:
        self._tasks.add_task(self._hub.broadcast, type_, data)

    def content(self, resource: ContentResource) -> None:
        self._publish("content.updated", {"resource": resource})

    def live_state(self) -> None:
        self._publish("live_state.updated", build_live_state(self._db).model_dump(mode="json"))

    def qualifying(self) -> None:
        self._publish("qualifying.updated", build_leaderboard(self._db).model_dump(mode="json"))

    def bracket(self) -> None:
        self._publish("bracket.updated", build_bracket(self._db).model_dump(mode="json"))


Events = Annotated[LiveEvents, Depends()]
