from datetime import datetime
from typing import Annotated, Any, Literal

from pydantic import BaseModel, Field, StringConstraints

from app.auth import PASSWORD_MIN_LENGTH
from app.schemas.common import ORMModel

Role = Literal["admin", "referee"]
Username = Annotated[
    str, StringConstraints(strip_whitespace=True, pattern=r"^[A-Za-z0-9_.-]{3,32}$")
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
