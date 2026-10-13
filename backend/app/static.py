from collections.abc import Callable
from pathlib import Path

from fastapi import Request
from fastapi.responses import FileResponse, Response

RESERVED_PREFIXES = ("api", "ws")
# Vite 가 해시를 붙여 내보내는 파일들
IMMUTABLE_DIR = "assets"


def spa_fallback(dist: Path) -> Callable[[Request], Response | None]:
    """라우트가 없는 GET 요청에 FRONTEND_DIST 의 파일이나 index.html 을 돌려준다.

    /api, /ws 아래 경로와 dist 가 없을 때는 None 을 돌려 JSON 404 가 나가게 한다.
    """

    def fallback(request: Request) -> Response | None:
        if request.method not in ("GET", "HEAD"):
            return None
        path = request.url.path.lstrip("/")
        if path.split("/", 1)[0] in RESERVED_PREFIXES:
            return None
        root = dist.resolve()
        index = root / "index.html"
        if not index.is_file():
            return None
        candidate = (root / path).resolve()
        if candidate.is_relative_to(root) and candidate.is_file():
            if candidate.parent.name == IMMUTABLE_DIR:
                headers = {"Cache-Control": "public, max-age=31536000, immutable"}
            else:
                headers = {"Cache-Control": "no-cache"}
            return FileResponse(candidate, headers=headers)
        # 해시 파일이 없으면 HTML 대신 404 를 돌려 프론트가 새 배포를 알아챌 수 있게 한다.
        if path.startswith(f"{IMMUTABLE_DIR}/"):
            return None
        return FileResponse(index, headers={"Cache-Control": "no-cache"})

    return fallback
