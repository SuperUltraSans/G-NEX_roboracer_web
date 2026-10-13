import json
from typing import Any

from sqlalchemy import ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.auth import User
from app.models.base import Base, TimestampMixin


class AuditLog(TimestampMixin, Base):
    __tablename__ = "audit_logs"

    id: Mapped[int] = mapped_column(primary_key=True)
    # null 은 CLI 같은 시스템 작업
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), index=True)
    action: Mapped[str] = mapped_column(String(32))
    entity: Mapped[str] = mapped_column(String(64))
    entity_id: Mapped[str] = mapped_column(String(64))
    before_json: Mapped[str | None]
    after_json: Mapped[str | None]

    user: Mapped[User | None] = relationship()

    @property
    def username(self) -> str | None:
        return self.user.username if self.user else None

    @property
    def before(self) -> dict[str, Any] | None:
        return json.loads(self.before_json) if self.before_json else None

    @property
    def after(self) -> dict[str, Any] | None:
        return json.loads(self.after_json) if self.after_json else None
