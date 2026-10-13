# /ws/live 메시지 형식. 프론트의 frontend/src/features/live/types.ts 와 같은 구조로 유지한다.
# (WebSocket 메시지는 OpenAPI 에 들어가지 않으므로 두 파일을 함께 고친다.)
from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.competition import Bracket, Leaderboard, LiveState

ContentResource = Literal["schedule", "rules", "settings", "teams"]


class SnapshotData(BaseModel):
    live_state: LiveState
    leaderboard: Leaderboard
    bracket: Bracket


class ContentUpdatedData(BaseModel):
    resource: ContentResource


class EmptyData(BaseModel):
    model_config = ConfigDict(extra="forbid")


class _Envelope(BaseModel):
    # snapshot 과 pong 은 seq 를 올리지 않고 현재 값을 담는다.
    seq: int
    ts: datetime


class SnapshotMessage(_Envelope):
    type: Literal["snapshot"]
    data: SnapshotData


class LiveStateUpdatedMessage(_Envelope):
    type: Literal["live_state.updated"]
    data: LiveState


class QualifyingUpdatedMessage(_Envelope):
    type: Literal["qualifying.updated"]
    data: Leaderboard


class BracketUpdatedMessage(_Envelope):
    type: Literal["bracket.updated"]
    data: Bracket


class ContentUpdatedMessage(_Envelope):
    type: Literal["content.updated"]
    data: ContentUpdatedData


class PongMessage(_Envelope):
    type: Literal["pong"]
    data: EmptyData


LiveMessage = Annotated[
    SnapshotMessage
    | LiveStateUpdatedMessage
    | QualifyingUpdatedMessage
    | BracketUpdatedMessage
    | ContentUpdatedMessage
    | PongMessage,
    Field(discriminator="type"),
]


class PingMessage(BaseModel):
    """클라이언트 → 서버. 그 외 메시지는 무시한다."""

    type: Literal["ping"]
