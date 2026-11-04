from datetime import datetime
from typing import Annotated, Any, Literal

from pydantic import AfterValidator, BaseModel, Field, StringConstraints

from app.auth import MONITOR_USERNAME, PASSWORD_MIN_LENGTH
from app.schemas.common import ORMModel

Role = Literal["admin", "referee"]


def _not_reserved(username: str) -> str:
    # 모니터링 관리 주소로 남긴 기록의 작업자(시스템 계정) 이름은 사람이 쓸 수 없다
    if username.lower() == MONITOR_USERNAME:
        raise ValueError(f"'{MONITOR_USERNAME}'은(는) 시스템 아이디입니다. 다른 아이디를 쓰세요.")
    return username


Username = Annotated[
    str,
    StringConstraints(strip_whitespace=True, pattern=r"^[A-Za-z0-9_.-]{3,32}$"),
    AfterValidator(_not_reserved),
]
Password = Annotated[str, Field(min_length=PASSWORD_MIN_LENGTH, max_length=256)]


class LoginRequest(BaseModel):
    username: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=64)]
    password: Annotated[str, Field(min_length=1, max_length=256)]


class UserOut(ORMModel):
    id: int
    username: str
    role: Role


class UserAdmin(UserOut):
    is_active: bool
    created_at: datetime
    updated_at: datetime


class UserCreate(BaseModel):
    username: Username
    password: Password
    role: Role


class UserUpdate(BaseModel):
    role: Role = None
    is_active: bool = None
    password: Password = None


class AuditLogOut(ORMModel):
    id: int
    created_at: datetime
    user_id: int | None
    username: str | None
    action: str
    entity: str
    entity_id: str
    before: dict[str, Any] | None
    after: dict[str, Any] | None


class AuditLogPage(BaseModel):
    items: list[AuditLogOut]
    total: int
    limit: int
    offset: int
