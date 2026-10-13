import secrets
import threading
import time
from collections import deque
from collections.abc import Callable
from datetime import timedelta
from typing import Annotated

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError
from fastapi import Depends, Request, Response
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.config import Settings
from app.db import DbSession
from app.errors import AppError
from app.models import User, UserSession, utcnow

SESSION_COOKIE = "rr_session"
PASSWORD_MIN_LENGTH = 8
ROLES = ("admin", "referee")

_hasher = PasswordHasher()
# 없는 사용자로 로그인할 때도 같은 시간이 걸리게 해서 계정 존재 여부를 숨긴다.
_DUMMY_HASH = _hasher.hash(secrets.token_urlsafe(16))


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password_hash: str, password: str) -> bool:
    try:
        return _hasher.verify(password_hash, password)
    except (VerificationError, InvalidHashError):
        return False


def authenticate(db: Session, username: str, password: str) -> User | None:
    user = db.scalar(select(User).where(User.username == username))
    if user is None:
        verify_password(_DUMMY_HASH, password)
        return None
    if not verify_password(user.password_hash, password) or not user.is_active:
        return None
    if _hasher.check_needs_rehash(user.password_hash):
        user.password_hash = hash_password(password)
    return user


def create_session(db: Session, user: User, settings: Settings) -> UserSession:
    now = utcnow()
    db.execute(delete(UserSession).where(UserSession.expires_at <= now))
    session = UserSession(
        id=secrets.token_urlsafe(32),
        user_id=user.id,
        expires_at=now + timedelta(hours=settings.session_ttl_hours),
    )
    db.add(session)
    return session


def revoke_sessions(db: Session, user_id: int) -> None:
    db.execute(delete(UserSession).where(UserSession.user_id == user_id))


def set_session_cookie(response: Response, session_id: str, settings: Settings) -> None:
    response.set_cookie(
        SESSION_COOKIE,
        session_id,
        max_age=settings.session_ttl_hours * 3600,
        path=settings.cookie_path,
        secure=settings.cookie_secure,
        httponly=True,
        samesite="strict",
    )


def clear_session_cookie(response: Response, settings: Settings) -> None:
    response.delete_cookie(
        SESSION_COOKIE,
        path=settings.cookie_path,
        secure=settings.cookie_secure,
        httponly=True,
        samesite="strict",
    )


class LoginRateLimiter:
    """(IP, username) 별 실패 시각을 메모리에 둔다. 워커 1개 운영을 전제로 한다."""

    def __init__(
        self,
        max_failures: int = 5,
        window_seconds: float = 600,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.max_failures = max_failures
        self.window_seconds = window_seconds
        self._clock = clock
        self._failures: dict[tuple[str, str], deque[float]] = {}
        self._lock = threading.Lock()

    def _recent(self, key: tuple[str, str]) -> deque[float]:
        cutoff = self._clock() - self.window_seconds
        failures = self._failures.get(key, deque())
        while failures and failures[0] <= cutoff:
            failures.popleft()
        if not failures:
            self._failures.pop(key, None)
        return failures

    def check(self, key: tuple[str, str]) -> None:
        with self._lock:
            if len(self._recent(key)) >= self.max_failures:
                raise AppError(
                    429, "RATE_LIMITED", "로그인 시도가 너무 많습니다. 잠시 후 다시 시도하세요."
                )

    def record_failure(self, key: tuple[str, str]) -> None:
        with self._lock:
            self._failures.setdefault(key, self._recent(key)).append(self._clock())

    def reset(self, key: tuple[str, str]) -> None:
        with self._lock:
            self._failures.pop(key, None)


def get_settings_from_app(request: Request) -> Settings:
    return request.app.state.settings


AppSettings = Annotated[Settings, Depends(get_settings_from_app)]

SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})


def csrf_protect(request: Request) -> None:
    """SameSite=Strict 에 더해, 관리자 변경 요청은 fetch 전용 헤더를 요구한다."""
    if request.method in SAFE_METHODS:
        return
    if request.headers.get("x-requested-with", "").lower() != "fetch":
        raise AppError(403, "FORBIDDEN", "X-Requested-With: fetch 헤더가 필요합니다.")


def get_current_session(request: Request, db: DbSession) -> UserSession:
    session_id = request.cookies.get(SESSION_COOKIE)
    session = db.get(UserSession, session_id) if session_id else None
    if session is None or session.expires_at <= utcnow() or not session.user.is_active:
        raise AppError(401, "UNAUTHENTICATED", "로그인이 필요합니다.")
    return session


CurrentSession = Annotated[UserSession, Depends(get_current_session)]


def get_current_user(session: CurrentSession) -> User:
    return session.user


CurrentUser = Annotated[User, Depends(get_current_user)]


def require_role(*roles: str) -> Callable[[User], User]:
    def dependency(user: CurrentUser) -> User:
        if user.role not in roles:
            raise AppError(403, "FORBIDDEN", "이 작업을 할 권한이 없습니다.")
        return user

    return dependency


AdminUser = Annotated[User, Depends(require_role("admin"))]
StaffUser = Annotated[User, Depends(require_role("admin", "referee"))]
