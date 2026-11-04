from datetime import datetime

from sqlalchemy import ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.auth import User
from app.models.base import Base, TimestampMixin, VersionedMixin


class Team(TimestampMixin, VersionedMixin, Base):
    """모든 기록의 기준이 되는 팀 표. 팀은 ID 와 팀 이름(중복 불가)으로 구분한다."""

    __tablename__ = "teams"

    id: Mapped[int] = mapped_column(primary_key=True)
    name_ko: Mapped[str] = mapped_column(unique=True)
    name_en: Mapped[str] = mapped_column(default="")
    affiliation_ko: Mapped[str | None]
    affiliation_en: Mapped[str | None]
    is_active: Mapped[bool] = mapped_column(default=True)
    # 차량 검사를 마친 시각. 예선 순위가 같으면 먼저 마친 팀이 앞선다 (규칙 4.7)
    inspected_at: Mapped[datetime | None]
    # 관리자가 직접 적은 검차 완료 순서(1부터). 공개 리더보드에 보이고, 검사 시각보다 먼저 쓴다
    inspection_order: Mapped[int | None]
    # 맵핑 순서(콘솔에서 무작위로 섞음, 1부터)와 맵핑을 마친 시각
    mapping_order: Mapped[int | None]
    mapped_at: Mapped[datetime | None]
    # 예선 출전 순서. 맵핑을 마친 뒤 맵핑 순서를 동결하며 옮겨 적는다(그 뒤로 맵핑 순서는 못 바꾼다)
    qualifying_order: Mapped[int | None]
    # 그룹 연습 조(A·B·C)와 고른 시각. 차량 검사를 마친 팀이 검사 순서대로 고른다
    practice_group: Mapped[str | None] = mapped_column(String(1))
    practice_group_at: Mapped[datetime | None]


class QualifyingLap(TimestampMixin, VersionedMixin, Base):
    """예선 랩 하나. 미션(Q1·Q2·Q3)마다 유효(valid)·무효(invalid)를 기록한다. void 는 입력 취소."""

    __tablename__ = "qualifying_laps"
    __table_args__ = (UniqueConstraint("team_id", "attempt_no"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    team_id: Mapped[int] = mapped_column(ForeignKey("teams.id"), index=True)
    attempt_no: Mapped[int]
    mission: Mapped[str] = mapped_column(String(2), default="Q1")
    lap_time_ms: Mapped[int | None]
    status: Mapped[str] = mapped_column(String(8))
    void_reason: Mapped[str | None]
    # null 은 CLI(seed-demo) 같은 시스템 입력
    recorded_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    recorded_at: Mapped[datetime] = mapped_column(index=True)

    team: Mapped[Team] = relationship()
    recorder: Mapped[User | None] = relationship()

    @property
    def recorded_by_username(self) -> str | None:
        return self.recorder.username if self.recorder else None


class QualifyingEvent(TimestampMixin, Base):
    """예선 중 팀에 내린 판정. fa_lost: FA 달성 불가, rank_drop: 최종 예선 순위 1단계 강등.

    지우면 판정을 취소한 것이다 (변경 이력에는 남는다).
    """

    __tablename__ = "qualifying_events"

    id: Mapped[int] = mapped_column(primary_key=True)
    team_id: Mapped[int] = mapped_column(ForeignKey("teams.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(16))
    reason: Mapped[str]
    recorded_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    recorded_at: Mapped[datetime]

    team: Mapped[Team] = relationship()
    recorder: Mapped[User | None] = relationship()

    @property
    def recorded_by_username(self) -> str | None:
        return self.recorder.username if self.recorder else None


class Award(TimestampMixin, Base):
    """대회 시상(팀 ID → 상). 순위는 두지 않는다 (공개 '결과' 페이지는 상만 보인다).

    본선 결과에서 자동으로 만들지 않고 운영진이 정한 대로 적는다.
    """

    __tablename__ = "awards"

    team_id: Mapped[int] = mapped_column(
        ForeignKey("teams.id", ondelete="CASCADE"), primary_key=True
    )
    # grand: 대상, excellence: 최우수상, merit: 우수상
    award: Mapped[str] = mapped_column(String(16))
    # 같은 상 안에서 보이는 순서
    sort_order: Mapped[int] = mapped_column(default=0)

    team: Mapped[Team] = relationship()


class TeamRanking(TimestampMixin, Base):
    """운영진이 직접 정한 랭킹(팀 ID → 순위). 본선의 '예선 N위' 슬롯은 이 순위로 채운다."""

    __tablename__ = "team_rankings"

    team_id: Mapped[int] = mapped_column(
        ForeignKey("teams.id", ondelete="CASCADE"), primary_key=True
    )
    rank: Mapped[int] = mapped_column(unique=True)

    team: Mapped[Team] = relationship()


class BracketRound(TimestampMixin, Base):
    __tablename__ = "bracket_rounds"

    id: Mapped[int] = mapped_column(primary_key=True)
    name_ko: Mapped[str]
    name_en: Mapped[str] = mapped_column(default="")
    sort_order: Mapped[int] = mapped_column(default=0)

    matches: Mapped[list["Match"]] = relationship(
        back_populates="round",
        cascade="all, delete-orphan",
        order_by="(Match.sort_order, Match.id)",
    )


class Match(TimestampMixin, VersionedMixin, Base):
    __tablename__ = "matches"

    id: Mapped[int] = mapped_column(primary_key=True)
    round_id: Mapped[int] = mapped_column(
        ForeignKey("bracket_rounds.id", ondelete="CASCADE"), index=True
    )
    label: Mapped[str] = mapped_column(String(20), unique=True)
    sort_order: Mapped[int] = mapped_column(default=0)
    status: Mapped[str] = mapped_column(String(16), default="scheduled")
    scheduled_at: Mapped[datetime | None]

    round: Mapped[BracketRound] = relationship(back_populates="matches")
    slots: Mapped[list["MatchSlot"]] = relationship(
        back_populates="match",
        foreign_keys="MatchSlot.match_id",
        cascade="all, delete-orphan",
        order_by="MatchSlot.slot_index",
    )


class MatchSlot(TimestampMixin, Base):
    __tablename__ = "match_slots"
    __table_args__ = (UniqueConstraint("match_id", "slot_index"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    match_id: Mapped[int] = mapped_column(ForeignKey("matches.id", ondelete="CASCADE"), index=True)
    slot_index: Mapped[int]
    team_id: Mapped[int | None] = mapped_column(ForeignKey("teams.id"))
    seed_rank: Mapped[int | None]
    source_match_id: Mapped[int | None] = mapped_column(
        ForeignKey("matches.id", ondelete="SET NULL"), index=True
    )
    source_rank: Mapped[int | None]
    placeholder_ko: Mapped[str | None]
    placeholder_en: Mapped[str | None]
    result_rank: Mapped[int | None]
    result_text: Mapped[str | None]

    match: Mapped[Match] = relationship(back_populates="slots", foreign_keys=[match_id])
    team: Mapped[Team | None] = relationship()
    source_match: Mapped[Match | None] = relationship(foreign_keys=[source_match_id])

    @property
    def source_match_label(self) -> str | None:
        return self.source_match.label if self.source_match else None


class LiveState(TimestampMixin, Base):
    __tablename__ = "live_state"

    id: Mapped[int] = mapped_column(primary_key=True)
    phase: Mapped[str] = mapped_column(String(16), default="idle")
    on_track_team_id: Mapped[int | None] = mapped_column(
        ForeignKey("teams.id", ondelete="SET NULL")
    )
    current_match_id: Mapped[int | None] = mapped_column(
        ForeignKey("matches.id", ondelete="SET NULL")
    )
    message_ko: Mapped[str | None]
    message_en: Mapped[str | None]
    # 본선 결과를 동결한 시각. 있으면 대진·결과를 더는 바꿀 수 없다 (풀려면 서버에서 비운다)
    bracket_frozen_at: Mapped[datetime | None]

    on_track_team: Mapped[Team | None] = relationship()
    current_match: Mapped[Match | None] = relationship()
