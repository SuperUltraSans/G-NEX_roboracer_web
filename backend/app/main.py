import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import APIRouter, Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from fastapi.routing import APIRoute
from starlette.exceptions import HTTPException as StarletteHTTPException

from app import seo
from app.auth import LoginRateLimiter, csrf_protect
from app.config import Settings, get_settings
from app.db import DbSession, create_db_engine, create_session_factory
from app.errors import install_error_handlers
from app.live.events import snapshot_provider
from app.live.hub import LiveHub
from app.routers import admin_auth, admin_competition, admin_content, admin_publish, public, ws
from app.routers.common import ERROR_RESPONSES, no_store
from app.services import publishing, rules_document
from app.static import spa_fallback


def _operation_id(route: APIRoute) -> str:
    return route.name


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    logging.basicConfig(level=settings.log_level.upper())

    engine = create_db_engine(settings.database_url)
    session_factory = create_session_factory(engine)

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        # 서버의 규칙 문서를 DB 와 맞춘다. 실패해도 로그만 남기고 시작한다.
        rules_document.sync_on_startup(session_factory, settings.rules_dir)
        # 공개본이 없으면(처음 배포 등) 지금 내용으로 만든다. 그 뒤로는 '게시'해야 바뀐다
        publishing.ensure_published(session_factory)
        yield
        engine.dispose()

    app = FastAPI(
        title="RoboRacer API",
        version="0.1.0",
        lifespan=lifespan,
        docs_url=None if settings.is_production else "/api/docs",
        redoc_url=None,
        openapi_url=None if settings.is_production else "/api/openapi.json",
        generate_unique_id_function=_operation_id,
        separate_input_output_schemas=False,
    )
    app.state.settings = settings
    app.state.engine = engine
    app.state.session_factory = session_factory
    app.state.hub = LiveHub(snapshot_provider(session_factory))
    app.state.login_limiter = LoginRateLimiter()
    app.state.monitor_limiter = LoginRateLimiter(
        max_failures=10,
        message="모니터링 관리 주소를 너무 많이 틀렸습니다. 10분쯤 뒤에 다시 시도하세요.",
    )

    if settings.cors_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=settings.cors_origins,
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )

    admin = APIRouter(
        prefix="/api/admin",
        # CSRF 검사가 세션 검사보다 먼저 실행된다 (라우터 의존성이 앞에 붙는다).
        dependencies=[Depends(csrf_protect), Depends(no_store)],
        responses=ERROR_RESPONSES,
    )
    admin.include_router(admin_auth.router)
    admin.include_router(admin_content.router)
    admin.include_router(admin_competition.router)
    admin.include_router(admin_publish.router)

    app.include_router(public.router)
    app.include_router(public.files_router)
    app.include_router(admin)
    app.include_router(ws.router)
    install_error_handlers(app, spa_fallback(settings.frontend_dist))

    @app.get("/sitemap.xml", include_in_schema=False)
    def get_sitemap(db: DbSession) -> Response:
        """검색엔진용 사이트맵 (공개 주소 PUBLIC_URL 을 정했을 때만)"""
        xml = seo.sitemap(db, settings)
        if xml is None:
            raise StarletteHTTPException(404)
        return Response(xml, media_type="application/xml", headers={"Cache-Control": "no-cache"})

    return app


app = create_app()
