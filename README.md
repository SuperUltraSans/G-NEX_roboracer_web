# 2026 Roboracer 글로벌 혁신 페스타 G-NEX CHAMPIONSHIP

학교 주최 RoboRacer(구 F1TENTH) 대회 홈페이지. 공개 페이지 5개(소개, 일정, 규칙, 신청, 모니터링)와 관리자 화면, 실시간 예선 리더보드·본선 대진을 제공한다.

- 프론트엔드: Vite + React + TypeScript (`frontend/`)
- 백엔드: FastAPI + SQLite (`backend/`), 실시간은 WebSocket `/ws/live`

아직 정해지지 않은 대회 정보(일시, 장소, 주최, 후원, 소개 문구 등)는 "임시 ~"(영어는 "Temporary ~")로 들어 있다. 채워야 할 곳은 이렇게 찾는다.

```bash
grep -rn "임시\|Temporary" frontend/src/i18n/locales
```

화면 문구는 `frontend/src/i18n/locales/ko.json`, `en.json`에 있다. 일정, 규칙, 팀, 기록 같은 대회 데이터는 관리자 화면에서 입력한다.

## 개발

필요한 도구: [uv](https://docs.astral.sh/uv/), Node.js 20.19 이상, npm.

```bash
# 백엔드 (http://127.0.0.1:8000)
cd backend
uv sync
cp .env.example .env
uv run alembic upgrade head
uv run python -m app.cli seed-demo          # 데모 데이터 (가짜 팀 12개, 일정, 규칙, 예선 기록, 8강 대진)
uv run python -m app.cli create-user --username admin --role admin
uv run uvicorn app.main:app --reload --port 8000

# 프론트엔드 (http://localhost:5173, /api 와 /ws 는 백엔드로 프록시)
cd frontend
npm ci
npm run dev
```

- 백엔드 없이 화면만 보려면 `VITE_USE_MOCK=true npm run dev`. 가짜 데이터로 동작하고 3초마다 랩 기록이 추가된다. 관리자 화면은 읽기 전용이다.
- 백엔드가 8000이 아닌 포트에 있으면 `DEV_BACKEND=http://127.0.0.1:8765 npm run dev`.
- API 문서는 개발 모드에서 `/api/docs`.
- 백엔드 API를 바꾸면 타입을 다시 만든다.

  ```bash
  cd backend && uv run python -m app.cli export-openapi --out ../frontend/src/api/openapi.json
  cd frontend && npm run gen:api
  ```

검사:

```bash
cd backend && uv run pytest && uv run ruff check . && uv run ruff format --check .
cd frontend && npm test && npm run lint && npm run typecheck
```

### 규칙 문서 (Markdown)

대회 규칙은 서버 안의 Markdown 문서와 항상 같은 내용으로 유지된다.

- 위치: `backend/data/rules/rules.ko.md`, `rules.en.md` (설정 `RULES_DIR`, 기본 `./data/rules`. Docker에서는 `backend/data` 볼륨 안이라 그대로 남는다)
- 형식: `## 제목` 한 줄이 규칙 섹션 하나다. 맨 위의 `# 문서 제목` 줄은 무시한다. 섹션 제목 바로 아래에 `<!-- hidden -->`을 두면 비공개 섹션이다(한국어 문서만). 본문 소제목은 `###`부터 쓴다(`## `는 섹션 구분이라 본문에 쓸 수 없다).
- 웹에서 규칙을 추가·수정·삭제·순서 변경·공개 전환하면 두 문서를 바로 다시 쓴다. 바뀐 경우 이전 내용은 `rules.<lang>.md.bak`으로 남는다.
- 관리자 → 규칙 → Markdown 문서에서 문서를 올리면 섹션을 순서대로 교체하고, 열려 있는 공개 페이지에 바로 반영된다. 같은 곳에서 현재 문서를 내려받을 수 있다(Markdown만, 또는 그림까지 담은 ZIP).
  - 한국어 문서: 섹션을 순서대로 덮어쓰고, 남는 섹션은 지우고, 모자라면 새로 만든다.
  - 영어 문서: 같은 순서의 섹션에 영어 제목과 본문을 넣는다. 영어 섹션이 한국어보다 많으면 거부한다.
  - 노션에서 내보낸 표처럼 칸 안에 줄바꿈이 그대로 들어간 표는 올릴 때 그 줄들을 `<br>`로 이어 한 행으로 만든다.
- 그림이 있으면 Markdown 문서 하나와 그림을 ZIP으로 묶어 올린다(노션 내보내기 ZIP도 그대로 된다).
  - 그림 주소는 상대 경로(`images/qr.png`), 패키지 기준 절대 경로(`/images/qr.png`), 작성한 컴퓨터의 경로(`/Users/kim/…/qr.png`, `C:\Users\kim\…\qr.png`, `file:///…`, `%20` 같은 인코딩 포함) 모두 ZIP 안의 파일로 찾는다. 못 찾으면 경로 뒷부분이 가장 길게 같은 파일, 그다음 이름이 같은 파일이 하나뿐이면 그 파일을 쓴다. 찾지 못한 주소, 그림이 아닌 파일, 쓰지 않은 그림은 적용 결과에 "확인할 것"으로 보인다.
  - 찾은 그림은 `RULES_DIR/files/<패키지 경로>`에 저장하고, 본문의 주소는 `/<패키지 경로>`로 바꾼다. 이때 공백, `%`, `#`, `?`, 괄호, `&`, 따옴표 같은 ASCII 문자는 `%20`처럼 퍼센트 인코딩하고 한글은 그대로 둔다(예: `![QR](/규칙%20자료/qr%20%281%29.png)`). 공개 주소는 `GET /api/rules/files/<패키지 경로>`. 모든 파일이 한 폴더 안에 있으면 그 폴더가 패키지 루트다.
  - 그림은 png, jpg, gif, webp, avif만 받는다(SVG는 받지 않는다). 한도: ZIP 50MB, 압축을 푼 크기 200MB, 항목 1,000개.
  - 문서만(.md) 다시 올리면 이미 저장된 그림을 경로나 파일 이름으로 찾는다.
  - 문서를 올릴 때마다 어느 섹션 본문(한국어·영어)도 쓰지 않는 그림을 `RULES_DIR/files`에서 지운다. 웹에서 본문을 고칠 때는 지우지 않는다.
  - 한 언어의 ZIP이 다른 언어 본문이 쓰는 그림을 바꾸지 않는다. 같은 경로에 내용이 다른 그림이 있으면 새 그림은 `image-1a2b3c4d.png`처럼 내용 해시를 붙여 저장한다.
  - 리버스 프록시 뒤에 두면 요청 본문 한도를 50MB 이상으로 올린다(nginx `client_max_body_size 50m;`). 기본 1MB면 ZIP 올리기가 413으로 실패한다.
- 서버의 문서 파일을 직접 고쳤다면 다음 웹 수정이나 재시작 전에 가져와야 한다(그러지 않으면 DB 내용으로 다시 쓰이고 직접 고친 내용은 `.bak`에만 남는다).

  ```bash
  cd backend && uv run python -m app.cli import-rules --lang ko          # 기본: RULES_DIR/rules.ko.md
  uv run python -m app.cli import-rules --lang en --file ~/rules.en.md
  uv run python -m app.cli import-rules --lang ko --file ~/규칙.zip       # 문서 + 그림 ZIP
  uv run python -m app.cli export-rules                                   # DB → 문서 파일 (그림은 RULES_DIR/files 에 그대로)
  # Docker: docker compose exec app python -m app.cli import-rules --lang ko
  ```

  CLI로 가져오면 열려 있는 공개 페이지는 새로고침해야 바뀐다(웹 업로드는 바로 반영된다).

### 히어로 이미지

원본은 `frontend/assets-src/hero/hero-source.png`(가로형), 세로형이 있으면 `hero-mobile-source.png`. 바꾼 뒤 아래 명령으로 반응형 이미지(avif, webp, jpg)를 다시 만들고 `frontend/public/hero/`를 함께 커밋한다.

```bash
cd frontend && npm run build:hero
```

### 디자인 점검 스크린샷

```bash
cd frontend
VITE_USE_MOCK=true npx vite --port 5180 &
SHOTS_URL=http://localhost:5180 SHOTS_ROUND=round4 npm run shots
```

결과는 `design-review/`(git 제외)에 저장된다.

## 배포

FastAPI 프로세스 하나가 API, WebSocket, 빌드된 프론트엔드를 모두 제공한다. `/api`와 `/ws`가 아닌 경로 중 파일이 없는 경로는 `index.html`을 돌려준다(SPA fallback).

> **uvicorn 워커는 반드시 1개다.** 실시간 허브가 프로세스 메모리에 있으므로 워커를 늘리면 일부 브라우저가 갱신을 받지 못한다.

### Docker Compose (권장)

```bash
git clone https://github.com/SuperUltraSans/G-NEX_roboracer_web.git
cd G-NEX_roboracer_web
cp backend/.env.example backend/.env       # 필요하면 수정. APP_ENV=production 권장
docker compose up -d --build                # http://<서버>:8000
docker compose exec app python -m app.cli create-user --username admin --role admin
```

- 컨테이너가 시작할 때 `alembic upgrade head`를 먼저 실행한다.
- DB는 `backend/data/`에 남는다(볼륨). 컨테이너는 uid 1000으로 돈다.
- 포트를 바꾸려면 `APP_PORT=8080 docker compose up -d`.
- 서브패스 아래에 둘 때는 빌드 인자로 경로를 넘긴다: `VITE_BASE_PATH=/roboracer/ docker compose up -d --build`. 프록시가 그 프리픽스를 떼고 넘겨야 한다.

업데이트:

```bash
git pull
docker compose up -d --build
```

### 직접 실행

1. 최초 설치

   ```bash
   git clone https://github.com/SuperUltraSans/G-NEX_roboracer_web.git
   cd G-NEX_roboracer_web/frontend && npm ci && npm run build
   cd ../backend && uv sync --no-dev
   cp .env.example .env                     # APP_ENV=production, 필요하면 COOKIE_SECURE=true
   uv run alembic upgrade head
   uv run python -m app.cli create-user --username admin --role admin
   uv run uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 1
   ```

2. 업데이트: `git pull` → `frontend`에서 `npm ci && npm run build` → `backend`에서 `uv sync --no-dev && uv run alembic upgrade head` → 재시작. DB 파일은 `backend/data/`에 있어 그대로 유지된다.

### 백업

대회 기간에는 주기적으로 백업한다. SQLite 온라인 백업 API를 써서 서버가 돌고 있어도 안전하다.

```bash
cd backend && uv run python -m app.cli backup --out ../backups/roboracer-$(date +%Y%m%d-%H%M).db
# Docker: docker compose exec app python -m app.cli backup --out data/backup-$(date +%Y%m%d-%H%M).db
```

### 검색엔진 (구글·네이버)

- 서버가 공개 페이지마다 제목·설명·대표 그림(OG)·구조화 데이터(구글 행사 정보)를 HTML 에 넣고, `#root` 안에 게시한 내용으로 만든 본문을 미리 넣는다(`backend/app/seo.py`). 자바스크립트를 돌리지 않는 검색엔진도 내용을 읽는다. 관리자 화면·모니터링 관리는 `noindex`, 없는 주소는 404 상태로 낸다.
- `PUBLIC_URL`(끝에 `/`)을 정하면 대표 주소(canonical)와 사이트맵(`<PUBLIC_URL>sitemap.xml`, 닫아 게시한 페이지는 빠짐)을 낸다.
- 구글 서치 콘솔은 "URL 접두어" 속성으로 등록하고, 확인 방법 "HTML 태그"의 content 값을 `GOOGLE_SITE_VERIFICATION` 에 넣는다. 네이버 서치어드바이저는 `NAVER_SITE_VERIFICATION`. 넣은 뒤 `docker compose up -d` 로 다시 띄우면 된다(빌드 불필요).

### 미리보기와 게시

일정, 규칙, 사이트 설정(신청 폼·접수 기간, 페이지 열고 닫기)은 관리자 화면에서 저장해도 공개 사이트에 바로 보이지 않는다. 각 화면 위의 '미리보기 ↗'로 공개 화면 모습을 확인하고 '게시'를 누르면 올라간다. 대회 기록(예선·본선·진행 상태)과 팀은 실시간이라 게시가 없다. 서버에서 직접 고친 뒤(예: `import-rules`)에는 게시 명령을 쓴다.

```bash
docker compose exec app python -m app.cli publish --resource rules   # schedule | rules | settings | all
```

### 모니터링 관리 주소

대회 당일 입력(진행 상태, 예선 기록, 랭킹·시드, 본선 결과)은 `/monitoring-admin` 에서 한다. 로그인한 운영진은 그대로 열고, 로그인 없이 쓰려면 비밀 값을 정해 `/monitoring-admin?pw=<값>` 주소를 나눠 준다. 관리자 화면 "사이트 설정 → 모니터링 관리 주소"에서 정하거나 서버 명령으로 바꾼다.

```bash
docker compose exec app python -m app.cli monitor-key --generate   # 무작위 값으로 바꾸고 출력
docker compose exec app python -m app.cli monitor-key --off        # 주소 끄기
```

값을 바꾸면 예전 주소는 바로 막힌다. 주소가 서버 접속 기록에 남으므로 새었다고 생각되면 바로 바꾼다.

### 리버스 프록시 뒤에서 운영할 때

- `/ws/live`에 WebSocket Upgrade 헤더를 넘겨야 한다. nginx 예:

  ```nginx
  location /ws/ {
      proxy_pass http://127.0.0.1:8000;
      proxy_http_version 1.1;
      proxy_set_header Upgrade $http_upgrade;
      proxy_set_header Connection "upgrade";
      proxy_set_header Host $host;
      proxy_read_timeout 120s;
  }
  ```

- HTTPS를 적용하면 `.env`에서 `COOKIE_SECURE=true`.
- 로그인·모니터링 관리 주소 시도 제한은 IP 기준이다. 프록시가 127.0.0.1이 아니면(예: 다른 컨테이너) uvicorn의 `FORWARDED_ALLOW_IPS`에 프록시 주소(또는 그 도커 네트워크 대역)를 넣어야 실제 방문자 IP가 쓰인다. 넣지 않으면 모든 요청이 프록시 IP 하나에서 온 것으로 보여 한 사람이 틀리면 모두가 막힌다. `"*"`는 쓰지 않는다: 방문자가 `X-Forwarded-For`를 꾸며 제한을 피하거나 다른 사람의 IP를 막을 수 있다.
- 서브패스(예: `/roboracer/`) 아래에 두면 프론트를 그 경로로 빌드하고(`VITE_BASE_PATH`), 세션 쿠키 범위도 `COOKIE_PATH`로 맞춘다.

### 기계별 설정 (서브패스 배포 예시)

서버마다 다른 설정(공개 경로, 프록시 네트워크, 포트 등)은 `docker-compose.override.yml`에 둔다. 이 파일은 git에 올리지 않고, `docker compose`가 `docker-compose.yml`과 함께 자동으로 읽는다. 리버스 프록시 뒤 `/roboracer/` 경로에 두는 예시는 [`docker-compose.override.example.yml`](docker-compose.override.example.yml)에 있다.

```bash
cp docker-compose.override.example.yml docker-compose.override.yml   # 고쳐서 쓴다
docker compose up -d --build
```
