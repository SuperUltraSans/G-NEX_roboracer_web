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
# 모니터링 관리 주소(?pw=...)의 비밀 값. 화면은 이 헤더로 보낸다
MONITOR_KEY_HEADER = "x-monitor-key"
# 모니터링 관리 주소로 바꾼 기록의 작업자로 남는 시스템 계정
MONITOR_USERNAME = "monitoring"

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
    if user.is_system or not verify_password(user.password_hash, password) or not user.is_active:
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

    PRUNE_AT = 1024

    def __init__(
        self,
        max_failures: int = 5,
        window_seconds: float = 600,
        clock: Callable[[], float] = time.monotonic,
        message: str = "로그인 시도가 너무 많습니다. 잠시 후 다시 시도하세요.",
    ) -> None:
        self.max_failures = max_failures
        self.message = message
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
                raise AppError(429, "RATE_LIMITED", self.message)

    def record_failure(self, key: tuple[str, str]) -> None:
        with self._lock:
            # 여러 IP 에서 틀리면 기록이 계속 쌓이므로, 많아지면 시간이 지난 것을 한꺼번에 지운다
            if len(self._failures) >= self.PRUNE_AT:
                for other in list(self._failures):
                    self._recent(other)
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


# ---- 모니터링 관리: 로그인 없이 주소의 비밀 값으로, 또는 로그인한 운영진이 쓴다 ----


def monitor_user(db: Session) -> User:
    """모니터링 관리 주소로 들어온 작업의 작업자(시스템 계정). 없으면 만든다."""
    user = db.scalar(select(User).where(User.username == MONITOR_USERNAME))
    if user is not None and not user.is_system:
        # 예약 전에 사람이 같은 이름으로 만든 계정이 있으면 그 사람 이름으로 기록되지 않게 막는다
        raise AppError(
            409,
            "MONITOR_USER_TAKEN",
            f"'{MONITOR_USERNAME}' 아이디를 사람 계정이 쓰고 있어"
            " 모니터링 관리 주소를 쓸 수 없습니다.",
        )
    if user is None:
        # 비밀번호 해시가 아닌 값이라 어떤 비밀번호로도 로그인되지 않는다
        user = User(username=MONITOR_USERNAME, password_hash="!", role="referee", is_system=True)
        db.add(user)
        db.flush()
    return user


def get_monitor_actor(request: Request, db: DbSession) -> User:
    session_id = request.cookies.get(SESSION_COOKIE)
    session = db.get(UserSession, session_id) if session_id else None
    if (
        session is not None
        and session.expires_at > utcnow()
        and session.user.is_active
        and session.user.role in ROLES
    ):
        return session.user
    key = request.headers.get(MONITOR_KEY_HEADER)
    if not key:
        raise AppError(401, "UNAUTHENTICATED", "로그인이 필요합니다.")
    from app.services.site_settings import read_monitor_key

    limiter: LoginRateLimiter = request.app.state.monitor_limiter
    limit_key = (request.client.host if request.client else "unknown", "monitor")
    limiter.check(limit_key)
    stored = read_monitor_key(db)
    if stored and secrets.compare_digest(key.encode(), stored.encode()):
        limiter.reset(limit_key)
        return monitor_user(db)
    limiter.record_failure(limit_key)
    raise AppError(
        403,
        "MONITOR_KEY_INVALID",
        "모니터링 관리 주소가 맞지 않습니다. 운영진에게 새 주소를 받으세요.",
    )


MonitorActor = Annotated[User, Depends(get_monitor_actor)]
