from datetime import datetime

from sqlalchemy import ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, VersionedMixin


class SiteSetting(TimestampMixin, Base):
    __tablename__ = "site_settings"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[str] = mapped_column(default="")
    updated_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))


class ScheduleItem(TimestampMixin, VersionedMixin, Base):
    __tablename__ = "schedule_items"

    id: Mapped[int] = mapped_column(primary_key=True)
    starts_at: Mapped[datetime] = mapped_column(index=True)
    ends_at: Mapped[datetime | None]
    title_ko: Mapped[str]
    title_en: Mapped[str] = mapped_column(default="")
    location_ko: Mapped[str | None]
    location_en: Mapped[str | None]
    description_ko: Mapped[str | None]
    description_en: Mapped[str | None]
    sort_order: Mapped[int] = mapped_column(default=0)
    is_published: Mapped[bool] = mapped_column(default=True)
    updated_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))


class RuleSection(TimestampMixin, VersionedMixin, Base):
    __tablename__ = "rule_sections"

    id: Mapped[int] = mapped_column(primary_key=True)
    title_ko: Mapped[str]
    title_en: Mapped[str] = mapped_column(default="")
    body_ko: Mapped[str] = mapped_column(default="")
    body_en: Mapped[str] = mapped_column(default="")
    sort_order: Mapped[int] = mapped_column(default=0, index=True)
    is_published: Mapped[bool] = mapped_column(default=True)
    updated_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
