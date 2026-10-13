#!/bin/sh
# 마이그레이션을 적용한 뒤 서버를 띄운다.
# 실시간 허브가 메모리에 있으므로 워커는 반드시 1개다.
set -e
alembic upgrade head
exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 1 --proxy-headers
