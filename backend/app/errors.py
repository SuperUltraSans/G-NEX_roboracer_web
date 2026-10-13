import logging
from collections.abc import Callable

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, Response
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm.exc import StaleDataError
from starlette.exceptions import HTTPException as StarletteHTTPException

logger = logging.getLogger(__name__)

HTTP_CODES = {
    400: "BAD_REQUEST",
    401: "UNAUTHENTICATED",
    403: "FORBIDDEN",
    404: "NOT_FOUND",
    405: "METHOD_NOT_ALLOWED",
    409: "CONFLICT",
    422: "VALIDATION_ERROR",
    429: "RATE_LIMITED",
}


class AppError(Exception):
    def __init__(self, status_code: int, code: str, detail: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.code = code
        self.detail = detail


def not_found(what: str = "대상") -> AppError:
    return AppError(404, "NOT_FOUND", f"{what}을(를) 찾을 수 없습니다.")


def invalid(detail: str) -> AppError:
    return AppError(422, "VALIDATION_ERROR", detail)


def version_conflict() -> AppError:
    return AppError(
        409, "VERSION_CONFLICT", "다른 사람이 먼저 수정했습니다. 최신 값을 다시 불러오세요."
    )


def check_version(current: int, sent: int) -> None:
    if current != sent:
        raise version_conflict()


def duplicate(detail: str) -> AppError:
    return AppError(409, "DUPLICATE", detail)


def error_response(status_code: int, code: str, detail: str, **extra: object) -> JSONResponse:
    return JSONResponse({"detail": detail, "code": code, **extra}, status_code=status_code)


def _format_loc(loc: tuple[int | str, ...]) -> str:
    parts = [str(p) for p in loc if p not in ("body", "query", "path")]
    return ".".join(parts) or "요청"


def install_error_handlers(
    app: FastAPI, not_found_fallback: Callable[[Request], Response | None] | None = None
) -> None:
    @app.exception_handler(AppError)
    async def handle_app_error(_: Request, exc: AppError) -> JSONResponse:
        return error_response(exc.status_code, exc.code, exc.detail)

    @app.exception_handler(StarletteHTTPException)
    async def handle_http_error(request: Request, exc: StarletteHTTPException) -> Response:
        if exc.status_code == 404 and not_found_fallback is not None:
            fallback = not_found_fallback(request)
            if fallback is not None:
                return fallback
        code = HTTP_CODES.get(exc.status_code, "HTTP_ERROR")
        response = error_response(exc.status_code, code, str(exc.detail))
        if exc.headers:
            response.headers.update(exc.headers)
        return response

    @app.exception_handler(RequestValidationError)
    async def handle_validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
        errors = [
            {"loc": list(err.get("loc", ())), "msg": str(err.get("msg", ""))}
            for err in exc.errors()
        ]
        detail = "; ".join(f"{_format_loc(tuple(e['loc']))}: {e['msg']}" for e in errors)
        return error_response(
            422, "VALIDATION_ERROR", detail or "입력값이 올바르지 않습니다.", errors=errors
        )

    @app.exception_handler(StaleDataError)
    async def handle_stale(_: Request, __: StaleDataError) -> JSONResponse:
        err = version_conflict()
        return error_response(err.status_code, err.code, err.detail)

    @app.exception_handler(IntegrityError)
    async def handle_integrity(_: Request, exc: IntegrityError) -> JSONResponse:
        if "UNIQUE" in str(exc.orig):
            return error_response(409, "DUPLICATE", "이미 존재하는 값입니다.")
        logger.warning("integrity error: %s", exc.orig)
        return error_response(422, "VALIDATION_ERROR", "참조하는 데이터가 올바르지 않습니다.")

    @app.exception_handler(Exception)
    async def handle_unexpected(_: Request, exc: Exception) -> JSONResponse:
        logger.exception("unhandled error", exc_info=exc)
        return error_response(500, "INTERNAL_ERROR", "서버 오류가 발생했습니다.")
