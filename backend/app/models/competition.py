from datetime import datetime

from sqlalchemy import ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.auth import User
from app.models.base import Base, TimestampMixin, VersionedMixin


class Team(TimestampMixin, VersionedMixin, Base):
    __tablename__ = "teams"

    id: Mapped[int] = mapped_column(primary_key=True)
    car_number: Mapped[int] = mapped_column(unique=True)
    name_ko: Mapped[str]
    name_en: Mapped[str] = mapped_column(default="")
    affiliation_ko: Mapped[str | None]
    affiliation_en: Mapped[str | None]
    is_active: Mapped[bool] = mapped_column(default=True)


class QualifyingLap(TimestampMixin, VersionedMixin, Base):
    __tablename__ = "qualifying_laps"
    __table_args__ = (UniqueConstraint("team_id", "attempt_no"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    team_id: Mapped[int] = mapped_column(ForeignKey("teams.id"), index=True)
    attempt_no: Mapped[int]
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

    on_track_team: Mapped[Team | None] = relationship()
    current_match: Mapped[Match | None] = relationship()
