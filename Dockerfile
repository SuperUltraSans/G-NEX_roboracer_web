# 1) 프론트엔드 빌드
FROM node:24-slim AS frontend
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
# 서브패스 아래에 배포할 때 넘긴다. 예: /roboracer/
ARG VITE_BASE_PATH=/
ENV VITE_BASE_PATH=${VITE_BASE_PATH}
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
