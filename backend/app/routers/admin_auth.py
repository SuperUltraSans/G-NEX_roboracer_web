from typing import Annotated

from fastapi import APIRouter, Query, Request, Response, status
from sqlalchemy import func, select
from sqlalchemy.orm import selectinload

from app.auth import (
    AdminUser,
    AppSettings,
    CurrentSession,
    CurrentUser,
    authenticate,
    clear_session_cookie,
    create_session,
    hash_password,
    revoke_sessions,
    set_session_cookie,
)
from app.db import DbSession
from app.errors import AppError, duplicate, not_found
from app.models import AuditLog, User
from app.schemas.auth import (
    AuditLogOut,
    AuditLogPage,
    LoginRequest,
    UserAdmin,
    UserCreate,
    UserOut,
    UserUpdate,
)
from app.services import audit

router = APIRouter()


@router.post("/auth/login", response_model=UserOut, tags=["auth"])
def login(
    body: LoginRequest, request: Request, response: Response, db: DbSession, settings: AppSettings
) -> UserOut:
    limiter = request.app.state.login_limiter
    key = (request.client.host if request.client else "unknown", body.username.lower())
    limiter.check(key)
    user = authenticate(db, body.username, body.password)
    if user is None:
        limiter.record_failure(key)
        raise AppError(401, "INVALID_CREDENTIALS", "아이디 또는 비밀번호가 올바르지 않습니다.")
    limiter.reset(key)
    session = create_session(db, user, settings)
    audit.record(db, user, "login", "users", user.id)
    db.commit()
    set_session_cookie(response, session.id, settings)
    return UserOut.model_validate(user)


@router.post("/auth/logout", status_code=status.HTTP_204_NO_CONTENT, tags=["auth"])
def logout(session: CurrentSession, db: DbSession, settings: AppSettings) -> Response:
    audit.record(db, session.user, "logout", "users", session.user_id)
    db.delete(session)
    db.commit()
    response = Response(status_code=status.HTTP_204_NO_CONTENT)
    clear_session_cookie(response, settings)
    return response


@router.get("/auth/me", response_model=UserOut, tags=["auth"])
def me(user: CurrentUser) -> UserOut:
    return UserOut.model_validate(user)


@router.get("/users", response_model=list[UserAdmin], tags=["users"])
def list_users(_: AdminUser, db: DbSession) -> list[UserAdmin]:
    # 시스템 계정(모니터링 관리 주소의 작업자)은 목록에 내지 않는다
    users = db.scalars(select(User).where(User.is_system.is_(False)).order_by(User.id))
    return [UserAdmin.model_validate(u) for u in users]


@router.post(
    "/users", response_model=UserAdmin, status_code=status.HTTP_201_CREATED, tags=["users"]
)
def create_user(body: UserCreate, actor: AdminUser, db: DbSession) -> UserAdmin:
    if db.scalar(select(User.id).where(User.username == body.username)) is not None:
        raise duplicate("이미 있는 아이디입니다.")
    user = User(username=body.username, password_hash=hash_password(body.password), role=body.role)
    db.add(user)
    audit.record_change(db, actor, "create", user, None)
    db.commit()
    return UserAdmin.model_validate(user)


def _active_admin_count(db: DbSession) -> int:
    return db.scalar(
        select(func.count()).select_from(User).where(User.role == "admin", User.is_active)
    )


@router.patch("/users/{user_id}", response_model=UserAdmin, tags=["users"])
def update_user(user_id: int, body: UserUpdate, actor: AdminUser, db: DbSession) -> UserAdmin:
    user = db.get(User, user_id)
    if user is None or user.is_system:
        raise not_found("사용자")
    before = audit.snapshot(user)
    changes = body.model_dump(exclude_unset=True)
    loses_admin = (
        user.role == "admin"
        and user.is_active
        and (changes.get("role", "admin") != "admin" or changes.get("is_active", True) is False)
    )
    if loses_admin and _active_admin_count(db) <= 1:
        raise AppError(409, "LAST_ADMIN", "마지막 관리자 계정은 비활성화하거나 강등할 수 없습니다.")
    if "role" in changes:
        user.role = changes["role"]
    if "is_active" in changes:
        user.is_active = changes["is_active"]
    if "password" in changes:
        user.password_hash = hash_password(changes["password"])
        # 스냅샷에는 해시가 빠지므로 재설정 사실을 따로 남긴다
        audit.record(db, actor, "password_reset", "users", user.id)
    if changes.get("is_active") is False or "password" in changes:
        revoke_sessions(db, user.id)
    audit.record_change(db, actor, "update", user, before)
    db.commit()
    return UserAdmin.model_validate(user)


@router.get("/audit", response_model=AuditLogPage, tags=["audit"])
def list_audit_logs(
    _: AdminUser,
    db: DbSession,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
    entity: str | None = None,
) -> AuditLogPage:
    query = select(AuditLog)
    if entity:
        query = query.where(AuditLog.entity == entity)
    total = db.scalar(select(func.count()).select_from(query.subquery()))
    rows = db.scalars(
        query.options(selectinload(AuditLog.user))
        .order_by(AuditLog.id.desc())
        .limit(limit)
        .offset(offset)
    )
    return AuditLogPage(
        items=[AuditLogOut.model_validate(r) for r in rows], total=total, limit=limit, offset=offset
    )
