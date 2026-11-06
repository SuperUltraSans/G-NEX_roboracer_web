# 1) 프론트엔드 빌드
FROM node:24-slim AS frontend
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
# 서브패스 아래에 배포할 때 넘긴다. 예: /roboracer/
ARG VITE_BASE_PATH=/
ENV VITE_BASE_PATH=${VITE_BASE_PATH}
# 테스트 사이트로 빌드할 때만 넘긴다: 모든 화면 맨 위에 테스트 띠, 그 띠의 '실제 사이트' 링크
ARG VITE_TEST_SITE=
ARG VITE_REAL_SITE_URL=
ENV VITE_TEST_SITE=${VITE_TEST_SITE} \
    VITE_REAL_SITE_URL=${VITE_REAL_SITE_URL}
# 관리자 기능을 프록시에서 잠갔을 때 true 로 넘긴다: 운영진 로그인 링크를 숨긴다
ARG VITE_HIDE_ADMIN_LINK=
ENV VITE_HIDE_ADMIN_LINK=${VITE_HIDE_ADMIN_LINK}
RUN npm run build

# 2) 백엔드 런타임
FROM python:3.12-slim AS runtime
COPY --from=ghcr.io/astral-sh/uv:0.11 /uv /bin/uv
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never \
    PYTHONUNBUFFERED=1 \
    PATH=/app/backend/.venv/bin:$PATH

RUN useradd --uid 1000 --create-home app
WORKDIR /app/backend
COPY backend/pyproject.toml backend/uv.lock backend/.python-version ./
RUN uv sync --frozen --no-dev
COPY backend/ ./
COPY --from=frontend /app/frontend/dist /app/frontend/dist
COPY docker/entrypoint.sh /entrypoint.sh
RUN mkdir -p data && chown -R app:app data

USER app
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=3)"]
ENTRYPOINT ["/entrypoint.sh"]
