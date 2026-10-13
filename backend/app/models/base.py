from datetime import UTC, datetime
from typing import Any

from sqlalchemy import DateTime, Dialect, MetaData
from sqlalchemy.orm import DeclarativeBase, Mapped, declared_attr, mapped_column
from sqlalchemy.types import TypeDecorator


def utcnow() -> datetime:
    return datetime.now(UTC)


class UTCDateTime(TypeDecorator[datetime]):
    """UTC 로 저장하고 항상 tz-aware UTC 로 돌려준다. naive 값은 거부한다."""

    impl = DateTime
    cache_ok = True

    def process_bind_param(self, value: datetime | None, dialect: Dialect) -> datetime | None:
        if value is None:
            return None
        if value.tzinfo is None:
            raise ValueError("naive datetime 은 저장할 수 없습니다")
        return value.astimezone(UTC).replace(tzinfo=None)

    def process_result_value(self, value: Any, dialect: Dialect) -> datetime | None:
        return value.replace(tzinfo=UTC) if value is not None else None


# SQLite batch 마이그레이션에서 제약조건을 이름으로 찾을 수 있게 규칙을 고정한다.
NAMING_CONVENTION = {
    "ix": "ix_%(table_name)s_%(column_0_N_name)s",
    "uq": "uq_%(table_name)s_%(column_0_N_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING_CONVENTION)
    type_annotation_map = {datetime: UTCDateTime()}


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(default=utcnow, onupdate=utcnow)


class VersionedMixin:
    """낙관적 잠금. 값은 애플리케이션이 올리고, UPDATE 는 이전 값을 WHERE 에 넣는다."""

    version: Mapped[int] = mapped_column(default=1)

    @declared_attr.directive
    def __mapper_args__(cls) -> dict[str, Any]:
        return {"version_id_col": cls.version, "version_id_generator": False}

    def bump_version(self) -> None:
        self.version += 1
