# RoboRacer 대회 홈페이지 템플릿 — 구현 지시서

- 작성일: 2026-10-12
- 대상: 이 저장소를 구현하는 코딩 에이전트
- 상태: 템플릿 구현용. 실제 콘텐츠와 데이터는 학교 서버에서 운영진이 입력한다.

---

## 0. 에이전트 작업 규칙

1. 이 문서를 끝까지 읽은 뒤, 10장의 단계 순서대로 구현한다. 단계마다 완료 기준을 확인하고 커밋한다.
2. 이 문서와 다른 결정이 필요하면 임의로 바꾸지 않는다. `docs/DECISIONS.md`에 사유와 대안을 기록하고 사용자에게 확인을 받는다.
3. 실제 대회명, 일시, 장소, 규칙, 후원사 같은 콘텐츠를 지어내지 않는다. 모든 자리표시 문자열은 `TBD:`로 시작하게 해서 나중에 grep으로 찾을 수 있게 한다. 예: `"TBD: 대회명"`.
4. 팀원 실명, 연락처, 이메일, 학번 같은 개인정보 컬럼은 어떤 테이블에도 추가하지 않는다. 참가 신청은 구글 폼이 받는다.
5. Python 패키지는 uv로 관리하고 전역 설치하지 않는다. Node 패키지는 npm을 쓰고 lockfile을 커밋한다.
6. 의존성은 이 문서에 적힌 것 위주로 쓰고, 새로 추가할 때는 `docs/DECISIONS.md`에 이유를 한 줄 남긴다.
7. 저장소에 `.env`, DB 파일, 빌드 산출물을 커밋하지 않는다.

---

## 1. 프로젝트 개요

### 1.1 배경

학교에서 주최하는 RoboRacer(구 F1TENTH) 대회의 홈페이지를 만든다. 이번 작업은 템플릿 단계이고 흐름은 다음과 같다.

1. 미니PC에서 템플릿(프론트 + 백엔드 골격)을 구현한다.
2. GitHub 저장소에 올린다.
3. 학교 서버가 저장소를 받아 가동한다.
4. 운영진이 학교 서버의 관리자 페이지에서 일정, 규칙, 팀, 경기 기록을 입력한다.

### 1.2 범위

포함:

- 공개 페이지 5개: 대회 소개, 일정, 대회 규칙, 대회 신청, 대회 모니터링
- 관리자 페이지: 콘텐츠(일정, 규칙, 신청 설정) 편집, 팀 관리, 예선 기록 입력, 본선 대진 관리, 현재 진행 상태 설정
- REST API, WebSocket 실시간 브로드캐스트, SQLite DB
- 한국어/영어 지원
- 개발용 mock 모드와 데모 시드 데이터

제외:

- 실제 콘텐츠 작성
- 외부 공개 경로, 도메인, HTTPS, 리버스 프록시 설정 (미정)
- 참가 신청 데이터 처리 (구글 폼이 담당)
- 영상 중계

### 1.3 확정 사항

| 항목 | 결정 |
|---|---|
| 프론트엔드 | Vite + React + TypeScript, 스타일은 CSS Modules + 전역 CSS 변수 |
| 백엔드 | FastAPI (Python 3.12) |
| DB | SQLite (SQLAlchemy 2.x + Alembic) |
| 로그인 | 관리자 계정만 존재. 일반 방문자 로그인 없음 |
| 참가 신청 | 구글 폼 외부 링크 버튼만 제공. URL은 관리자 페이지에서 설정 |
| 소개 페이지 | 코드에서 관리하는 정적 페이지 (텍스트는 i18n 파일) |
| 일정, 규칙 | 관리자 페이지에서 추가·수정 → API → DB → 공개 페이지에 새로고침 없이 반영 |
| 실시간 데이터 | 심판이 관리자 페이지에서 수동 입력 |
| 모니터링 내용 | 예선 랩타임 리더보드, 본선 대진과 진출 결과, 현재 진행 상태 |
| 본선 형식 | 미정. 라운드·매치·슬롯 기반의 범용 구조로 설계 |
| 언어 | 한국어(기본), 영어 |

---

## 2. 기술 스택

작성 시점의 최신 안정 버전을 쓰고 lockfile로 고정한다.

프론트엔드:

- `vite`, `react`, `react-dom`, `typescript`
- `react-router` (라우팅)
- `@tanstack/react-query` (서버 상태, WebSocket 이벤트 기반 무효화)
- `i18next`, `react-i18next` (다국어)
- `react-markdown`, `remark-gfm` (규칙 본문 렌더링, raw HTML 비활성)
- `openapi-typescript` (백엔드 OpenAPI → TS 타입 생성, devDependency)
- `vitest`, `eslint`, `prettier`

백엔드:

- `fastapi`, `uvicorn[standard]`
- `sqlalchemy` 2.x, `alembic`
- `pydantic-settings`
- `argon2-cffi` (비밀번호 해시)
- `pytest`, `httpx`, `ruff`

---

## 3. 저장소 구조

```
roboracer-site/
├── INSTRUCTIONS.md
├── DESIGN.md
├── README.md
├── .gitignore
├── docs/
│   └── DECISIONS.md
├── frontend/
│   ├── package.json
│   ├── vite.config.ts            # dev proxy: /api, /ws → 127.0.0.1:8000
│   ├── .env.example
│   ├── index.html
│   ├── assets-src/
│   │   └── hero/                 # 히어로 원본 이미지 (DESIGN.md 6.1)
│   ├── scripts/
│   │   └── build-hero.mjs        # 히어로 이미지 변환 (DESIGN.md 6.8)
│   ├── public/
│   │   └── hero/                 # 변환된 히어로 이미지
│   └── src/
│       ├── main.tsx
│       ├── app/                  # Router, Layout, Providers(Query, I18n, Live)
│       ├── pages/
│       │   ├── HomePage.tsx
│       │   ├── SchedulePage.tsx
│       │   ├── RulesPage.tsx
│       │   ├── ApplyPage.tsx
│       │   ├── LivePage.tsx
│       │   ├── NotFoundPage.tsx
│       │   └── admin/
│       ├── components/           # 공용 UI (Button, Card, Badge, Table, ...)
│       ├── features/
│       │   ├── live/             # LiveProvider, useLiveFeed, Leaderboard, Bracket
│       │   └── content/          # 일정·규칙·설정 조회 훅
│       ├── api/
│       │   ├── openapi.json      # 백엔드에서 내보낸 스키마 (생성물, 커밋)
│       │   ├── schema.d.ts       # openapi-typescript 생성물 (커밋)
│       │   ├── client.ts
│       │   └── mock/             # mock 모드 fixture와 가짜 실시간 발생기
│       ├── i18n/
│       │   ├── index.ts
│       │   └── locales/
│       │       ├── ko.json
│       │       └── en.json
│       ├── lib/                  # 랩타임 포맷/파싱, 다국어 필드 선택, 시간대 포맷
│       └── styles/
│           ├── tokens.css
│           └── global.css
└── backend/
    ├── pyproject.toml
    ├── .env.example
    ├── alembic.ini
    ├── alembic/
    ├── data/                     # SQLite 파일 위치 (gitignore, .gitkeep만 커밋)
    ├── app/
    │   ├── main.py
    │   ├── config.py
    │   ├── db.py
    │   ├── models/
    │   ├── schemas/
    │   ├── services/             # leaderboard.py, bracket.py, audit.py
    │   ├── routers/
    │   │   ├── public.py
    │   │   ├── admin_auth.py
    │   │   ├── admin_content.py
    │   │   ├── admin_competition.py
    │   │   └── ws.py
    │   ├── live/
    │   │   └── hub.py
    │   ├── auth.py
    │   └── cli.py
    └── tests/
```

---

## 4. 공통 규칙

### 4.1 다국어

- UI 문자열은 `frontend/src/i18n/locales/{ko,en}.json`에 둔다. 컴포넌트에 문자열을 직접 쓰지 않는다.
- DB 콘텐츠는 언어별 컬럼 쌍으로 저장한다. 예: `title_ko`, `title_en`.
- 영어 값이 비어 있으면 한국어 값으로 대체 표시한다. 이 로직은 `lib/localized.ts`의 `pickLocalized(obj, "title", lang)` 하나로 통일한다.
- 언어 선택: 헤더의 KO/EN 토글. 선택값은 localStorage에 저장하되 읽기/쓰기를 try/catch로 감싼다. 초기값은 저장값 → 브라우저 언어가 `ko`로 시작하면 ko → 그 외 en 순서로 정한다. 전환 시 `<html lang>`도 바꾼다.
- URL에는 언어 접두사를 넣지 않는다.

### 4.2 시간

- DB와 API의 모든 시각은 UTC 기준 timezone-aware 값이다. API는 ISO 8601 문자열에 오프셋(`Z`)을 포함해서 주고받는다.
- 화면 표시는 백엔드 설정 `EVENT_TIMEZONE`(기본 `Asia/Seoul`) 기준으로 한다. 프론트는 이 값을 `/api/settings/public`에서 받는다.
- 관리자 입력 폼에서 받은 현지 시각은 프론트에서 UTC로 변환해서 보낸다.

### 4.3 랩타임

- 저장 단위는 정수 밀리초(`lap_time_ms`).
- 표시 형식: `m:ss.SSS` (예: `0:42.137`). 격차는 `+0.512`.
- 입력 허용 형식: `ss.SSS` 또는 `m:ss.SSS`. 그 외 형식은 거부한다.
- 유효 범위: 1,000 ms 이상 600,000 ms 이하. 범위 밖은 422로 거부한다.
- 파싱·포맷 함수는 `frontend/src/lib/laptime.ts`에 두고 단위 테스트를 작성한다.

### 4.4 API 오류 형식

```json
{ "detail": "사람이 읽을 메시지", "code": "VERSION_CONFLICT" }
```

| 상태 | code 예시 | 상황 |
|---|---|---|
| 401 | `UNAUTHENTICATED` | 로그인 필요 |
| 403 | `FORBIDDEN` | 권한 부족 |
| 404 | `NOT_FOUND` | 대상 없음 |
| 409 | `VERSION_CONFLICT`, `DOWNSTREAM_FINISHED` | 동시 수정 충돌, 후속 매치 종료됨 |
| 422 | `VALIDATION_ERROR` | 입력 검증 실패 |
| 429 | `RATE_LIMITED` | 로그인 시도 초과 |

### 4.5 동시 수정 방지

편집 가능한 리소스(일정, 규칙 섹션, 팀, 예선 기록, 매치)는 정수 `version` 컬럼을 가진다. PATCH 요청은 현재 `version`을 함께 보내고, 서버 값과 다르면 409 `VERSION_CONFLICT`를 반환한다. 성공하면 `version`을 1 올린다.

---

## 5. 프론트엔드

### 5.1 라우트

| 경로 | 페이지 | 내비 탭 노출 |
|---|---|---|
| `/` | 대회 소개 | O (기본 탭) |
| `/schedule` | 일정 | O |
| `/rules` | 대회 규칙 | O |
| `/apply` | 대회 신청 | O |
| `/live` | 대회 모니터링 | O |
| `/admin/login` | 관리자 로그인 | X |
| `/admin/*` | 관리자 화면 | X |
| `*` | 404 | X |

### 5.2 공통 레이아웃

- 헤더: 로고 자리(`TBD` 텍스트 로고), 탭 내비, 언어 토글. 현재 탭 강조.
- 좁은 화면(768px 미만)에서는 탭 내비를 메뉴 버튼으로 접는다.
- 본문은 최대 폭 컨테이너. 360px 폭에서 페이지 전체에 가로 스크롤이 생기지 않아야 한다 (대진표 영역 내부 스크롤은 허용).
- 푸터: 주최, 문의처 자리 (`TBD`).
- mock 모드일 때 화면 구석에 `MOCK` 배지를 표시한다.

### 5.3 공개 페이지

#### 대회 소개 (`/`)

정적 페이지. 텍스트는 i18n 파일의 `home.*` 키에 `TBD:` 자리표시로 넣는다.

- 히어로: 전체 화면 배경 이미지 위에 대회명, 일시, 장소, 버튼 2개(신청하기 → `/apply`, 실시간 보기 → `/live`). 아래로 스크롤하면 소개 섹션으로 이어진다. 세부 사항은 `DESIGN.md` 6장을 따른다.
- 대회 소개 섹션 (`id="intro"`)
- 진행 방식 섹션: 예선(타임어택) → 본선(토너먼트) 순서가 드러나게 표시. 표현 방식은 `DESIGN.md` 7장을 따른다.
- 주최·후원 로고 자리 (4~6개)
- 선택(P2): `/api/schedule`에서 다음 일정 1건을 가져와 "다음 일정" 카드로 표시

#### 일정 (`/schedule`)

- `GET /api/schedule` 결과를 날짜별로 묶어 타임라인으로 표시한다. 각 항목은 시각(시작~종료), 제목, 장소, 설명.
- 공개(`is_published=true`) 항목만 표시한다.
- 빈 상태 문구를 둔다.
- 관리자가 수정하면 새로고침 없이 반영된다 (5.5 참고).

#### 대회 규칙 (`/rules`)

- `GET /api/rules`의 섹션을 `sort_order` 순서로 렌더링한다. 본문은 Markdown이다.
- `react-markdown` + `remark-gfm`을 쓰고 raw HTML은 렌더링하지 않는다. 외부 링크에는 `target="_blank" rel="noopener noreferrer"`를 붙인다.
- 넓은 화면에서는 섹션 제목으로 만든 목차를 옆에 고정하고, 좁은 화면에서는 상단에 둔다.
- 섹션별 최종 수정 시각을 표시한다.

#### 대회 신청 (`/apply`)

- 안내문(i18n, `TBD`)과 신청 버튼 하나.
- `GET /api/settings/public`의 `apply_form_url`, `apply_open_at`, `apply_close_at`으로 버튼 상태를 정한다.

| 조건 | 버튼 |
|---|---|
| URL 없음 | 비활성, "준비 중" |
| 현재 < 시작 시각 | 비활성, "접수 예정 (시작 시각)" |
| 현재 > 마감 시각 | 비활성, "접수 마감" |
| 그 외 | 활성, 새 탭으로 폼 열기 (`rel="noopener noreferrer"`) |

- 접수 기간을 버튼 아래에 표시한다.

#### 대회 모니터링 (`/live`)

- 상단 상태 바: 현재 단계(대기/예선/본선/휴식/종료), 트랙 위 팀, 진행 중 매치, 운영 공지 문구, 연결 상태(연결됨/재연결 중/끊김).
- 섹션 1 — 예선 리더보드: 순위, 차량 번호, 팀명, 소속, 최고 랩, 1위와의 격차, 시도 횟수. 갱신된 행은 1~2초간 강조한다. 기록이 없는 팀은 아래쪽에 `—`로 표시한다.
- 섹션 2 — 본선 대진: 라운드를 열(column)로, 매치를 카드로 표시한다. 슬롯에는 팀(차량 번호 + 팀명), 또는 자리표시("예선 3위", "M2 1위" 등)를 표시한다. 순위 1위 슬롯을 강조하고 매치 상태 배지(예정/진행 중/종료)를 단다. 좁은 화면에서는 대진 영역만 가로 스크롤한다.
- 매치 간 연결선은 선택(P2).
- 단계가 `idle`이면 "현재 진행 중인 경기가 없습니다"를 표시하되 기존 결과는 그대로 보인다.
- 리더보드 갱신 알림용으로 `aria-live="polite"` 영역을 하나 둔다.

### 5.4 관리자 화면

- 로그인 후 진입. 세션이 없으면 `/admin/login`으로 보낸다.
- 심판이 트랙 옆에서 휴대폰·태블릿으로 쓰는 것을 전제로, 입력 화면은 모바일 우선으로 만든다.
- 관리자 UI도 i18n 키를 쓴다. 영어 번역은 우선순위가 낮다(P2).

| 경로 | 기능 | 권한 |
|---|---|---|
| `/admin` | 대시보드: 현재 상태 요약, 각 메뉴 바로가기 | admin, referee |
| `/admin/live` | 현재 단계, 트랙 위 팀, 진행 중 매치, 공지 문구(ko/en) 설정 | admin, referee |
| `/admin/qualifying` | 예선 기록 입력·수정·무효 처리 | admin, referee |
| `/admin/bracket` | 라운드·매치·슬롯 편집, 결과 입력, 결과 되돌리기, 예선 시드 채우기 | 편집: admin / 결과 입력: admin, referee |
| `/admin/teams` | 팀 등록·수정·비활성화 | admin |
| `/admin/schedule` | 일정 추가·수정·삭제·순서 변경·공개 여부 | admin |
| `/admin/rules` | 규칙 섹션 추가·수정·삭제·순서 변경·공개 여부 | admin |
| `/admin/settings` | 신청 폼 URL, 접수 기간 | admin |
| `/admin/users` | 심판·관리자 계정 생성, 비활성화, 비밀번호 재설정 | admin |
| `/admin/audit` | 변경 이력 조회 (P2) | admin |

화면별 요구사항:

- 예선 기록 입력: 팀 선택(차량 번호로 검색) → 랩타임 입력(`inputmode="decimal"`) → 상태 선택(정상/DNF/실격) → 확인 후 저장. 아래에 최근 입력 20건을 보여주고 각 건에서 수정과 무효 처리(사유 입력 필수)를 할 수 있게 한다.
- 일정·규칙 편집: 한국어/영어 필드를 나란히 배치한다. 규칙 본문은 Markdown 입력창과 미리보기를 함께 둔다. 저장 시 409를 받으면 "다른 사람이 먼저 수정했습니다"를 띄우고 최신 값을 다시 불러온다.
- 대진 결과 입력: 매치를 선택하고 슬롯마다 순위(1, 2, ...)와 결과 메모(예: 기록, "DNF")를 입력한 뒤 종료 처리한다. 종료하면 후속 슬롯이 자동으로 채워진다 (6.3.2 참고).
- 파괴적 동작(삭제, 무효, 결과 되돌리기)은 확인 대화상자를 거친다.

### 5.5 데이터 계층

- `api/client.ts`: `fetch` 래퍼. 기본 URL은 `VITE_API_BASE`(비어 있으면 같은 origin). 관리자 요청은 `credentials: "include"`, 변경 요청(POST/PUT/PATCH/DELETE)에는 `X-Requested-With: fetch` 헤더를 붙인다. 오류 응답은 4.4 형식으로 파싱해서 throw한다.
- 타입: 백엔드 CLI로 `frontend/src/api/openapi.json`을 내보내고, `npm run gen:api`로 `schema.d.ts`를 생성한다. REST 응답 타입은 생성된 타입만 쓴다.
- WebSocket 메시지 타입은 OpenAPI에 포함되지 않으므로 `features/live/types.ts`에 백엔드 `schemas/live.py`와 같은 구조로 작성한다. 두 파일 상단에 서로를 가리키는 주석을 남긴다.
- 서버 상태는 TanStack Query로 관리한다. 쿼리 키 예: `["schedule"]`, `["rules"]`, `["settings","public"]`, `["teams"]`.
- `LiveProvider`를 앱 루트에 두고 WebSocket을 한 번만 연결한다. 모든 공개 페이지가 이 연결을 공유한다.
  - `snapshot`, `live_state.updated`, `qualifying.updated`, `bracket.updated`는 메시지의 `data`로 해당 쿼리 캐시를 직접 갱신한다 (`setQueryData`).
  - `content.updated`는 `data.resource`에 해당하는 쿼리를 무효화해서 REST로 다시 가져오게 한다.
  - 재연결에 성공하면 모든 콘텐츠 쿼리를 무효화한다 (끊긴 동안 놓친 이벤트 보완).
- 이 구조로 "관리자 수정 → 열려 있는 공개 페이지에 새로고침 없이 반영"을 만족시킨다.

### 5.6 mock 모드

- `VITE_USE_MOCK=true`이면 `api/mock/`의 fixture로 응답하고, 실제 WebSocket 대신 가짜 발생기가 3초마다 랩 기록을 추가하고 가끔 매치를 종료시킨다.
- fixture의 팀명은 `Mock Team 01` 같은 명백한 가짜 이름을 쓴다.
- 관리자 화면은 mock 모드에서 읽기 전용으로 동작해도 된다.

### 5.7 스타일

- UI 프레임워크 없이 CSS Modules를 쓴다.
- `styles/tokens.css`에 색, 간격, 반경, 서체 등 디자인 토큰을 CSS 변수로 정의하고, 컴포넌트는 토큰만 참조한다.
- 시각 디자인(색, 서체, 레이아웃, 모션, 히어로)은 `DESIGN.md`를 따른다. 두 문서가 충돌하면 디자인에 관해서는 `DESIGN.md`가 우선한다.
- 히어로·헤더·푸터는 남색, 본문은 흰 바탕에 어두운 글씨로 고정한다. 사용자가 고르는 라이트/다크 모드 전환은 만들지 않는다.

---

## 6. 백엔드

### 6.1 설정 (`backend/.env`)

```
APP_ENV=development            # development | production
DATABASE_URL=sqlite:///./data/roboracer.db
SESSION_TTL_HOURS=12
COOKIE_SECURE=false            # HTTPS 환경에서 true
EVENT_TIMEZONE=Asia/Seoul
FRONTEND_DIST=../frontend/dist # 존재하면 FastAPI가 정적 파일 제공
CORS_ORIGINS=                  # 기본 비움 (같은 origin 운영)
LOG_LEVEL=info
```

`pydantic-settings`로 읽고, `.env.example`을 커밋한다.

### 6.2 DB

SQLite 연결 시 PRAGMA를 설정한다: `journal_mode=WAL`, `foreign_keys=ON`, `busy_timeout=5000`. Alembic은 SQLite ALTER 제약 때문에 `render_as_batch=True`로 설정한다. 앱 시작 시 `create_all`을 쓰지 않고 마이그레이션으로만 스키마를 만든다.

모든 테이블에 `created_at`, `updated_at`(UTC)을 둔다. 아래 표에서는 생략한다.

#### users

| 컬럼 | 타입 | 비고 |
|---|---|---|
| id | int PK | |
| username | text unique | |
| password_hash | text | argon2 |
| role | text | `admin` \| `referee` |
| is_active | bool | |

#### sessions

| 컬럼 | 타입 | 비고 |
|---|---|---|
| id | text PK | `secrets.token_urlsafe(32)` |
| user_id | int FK | |
| expires_at | datetime | |

#### site_settings

| 컬럼 | 타입 | 비고 |
|---|---|---|
| key | text PK | `apply_form_url`, `apply_open_at`, `apply_close_at` |
| value | text | 빈 값 허용 |
| updated_by | int FK nullable | |

`apply_form_url`은 `https://` URL만 허용한다.

#### schedule_items

| 컬럼 | 타입 | 비고 |
|---|---|---|
| id | int PK | |
| starts_at | datetime | |
| ends_at | datetime nullable | `starts_at` 이후여야 함 |
| title_ko, title_en | text | ko 필수 |
| location_ko, location_en | text nullable | |
| description_ko, description_en | text nullable | |
| sort_order | int | 같은 시각일 때 정렬 |
| is_published | bool | |
| version | int | |
| updated_by | int FK nullable | |

#### rule_sections

| 컬럼 | 타입 | 비고 |
|---|---|---|
| id | int PK | |
| title_ko, title_en | text | ko 필수 |
| body_ko, body_en | text | Markdown |
| sort_order | int | |
| is_published | bool | |
| version | int | |
| updated_by | int FK nullable | |

#### teams

| 컬럼 | 타입 | 비고 |
|---|---|---|
| id | int PK | |
| car_number | int unique | |
| name_ko, name_en | text | ko 필수 |
| affiliation_ko, affiliation_en | text nullable | |
| is_active | bool | |
| version | int | |

개인정보 컬럼을 추가하지 않는다.

#### qualifying_laps

| 컬럼 | 타입 | 비고 |
|---|---|---|
| id | int PK | |
| team_id | int FK | |
| attempt_no | int | 팀별 자동 증가 |
| lap_time_ms | int nullable | DNF면 null |
| status | text | `valid` \| `dnf` \| `dsq` \| `void` |
| void_reason | text nullable | `void`일 때 필수 |
| recorded_by | int FK | |
| recorded_at | datetime | |
| version | int | |

기록은 삭제하지 않고 `void`로 무효 처리한다.

#### bracket_rounds

| 컬럼 | 타입 | 비고 |
|---|---|---|
| id | int PK | |
| name_ko, name_en | text | 예: "8강", "Quarterfinal" |
| sort_order | int | |

#### matches

| 컬럼 | 타입 | 비고 |
|---|---|---|
| id | int PK | |
| round_id | int FK | |
| label | text unique | 예: `M1` |
| sort_order | int | |
| status | text | `scheduled` \| `live` \| `finished` |
| scheduled_at | datetime nullable | |
| version | int | |

#### match_slots

| 컬럼 | 타입 | 비고 |
|---|---|---|
| id | int PK | |
| match_id | int FK | |
| slot_index | int | 매치 안에서 0부터 |
| team_id | int FK nullable | 확정된 팀 |
| seed_rank | int nullable | 예선 N위로 채울 슬롯 |
| source_match_id | int FK nullable | 이전 매치 결과로 채울 슬롯 |
| source_rank | int nullable | 이전 매치의 몇 위인지 |
| placeholder_ko, placeholder_en | text nullable | 팀 미정일 때 표시할 문구 |
| result_rank | int nullable | 이 매치에서의 순위 |
| result_text | text nullable | 기록, "DNF" 등 메모 |

검증: `seed_rank`와 `(source_match_id, source_rank)`는 동시에 설정할 수 없다. `source_match_id`는 같은 매치를 가리킬 수 없고, 순환 참조를 만들 수 없다.

슬롯 수는 매치마다 자유롭다(2대 이상 동시 주행도 표현 가능). 싱글/더블 엘리미네이션은 `source_rank` 1(승자), 2(패자) 연결로 표현한다.

#### live_state (단일 행, id=1)

| 컬럼 | 타입 | 비고 |
|---|---|---|
| phase | text | `idle` \| `qualifying` \| `bracket` \| `break` \| `finished` |
| on_track_team_id | int FK nullable | |
| current_match_id | int FK nullable | |
| message_ko, message_en | text nullable | 운영 공지 |

#### audit_logs

| 컬럼 | 타입 | 비고 |
|---|---|---|
| id | int PK | |
| user_id | int FK | |
| action | text | `create` \| `update` \| `delete` \| `void` \| `finish` \| `reopen` ... |
| entity | text | 테이블명 |
| entity_id | text | |
| before_json, after_json | text nullable | |

모든 관리자 변경 요청은 같은 트랜잭션 안에서 audit 로그를 남긴다.

### 6.3 도메인 로직

#### 6.3.1 예선 리더보드 (`services/leaderboard.py`)

- 집계 대상: `is_active` 팀, `status=valid` 기록.
- 기본 산정 방식은 팀별 최고 랩(`best_lap`). 산정 방식은 미정 사항이므로 함수 하나로 분리해서 나중에 "N랩 합산" 같은 방식으로 바꿀 수 있게 한다.
- 정렬: 최고 랩 오름차순 → 동률이면 그 기록을 먼저 낸 팀 우선 → 기록 없는 팀은 맨 아래에 차량 번호 순.
- 행 구조: `rank`(기록 없으면 null), `team`, `best_lap_ms`, `gap_ms`(1위 대비), `attempts`(void 제외 시도 수), `last_recorded_at`.

#### 6.3.2 대진 진출 처리 (`services/bracket.py`)

- 결과 입력: `POST /api/admin/matches/{id}/result`에 슬롯별 `result_rank`, `result_text`, 매치 `version`을 보낸다. 모든 슬롯에 팀이 확정되어 있어야 하고 순위는 1부터 빠짐없이 매겨야 한다. 성공하면 `status=finished`.
- 전파: 이 매치를 `source_match_id`로 가리키는 모든 슬롯에 대해, `source_rank`와 같은 `result_rank`를 받은 팀으로 `team_id`를 채운다.
- 되돌리기: `POST /api/admin/matches/{id}/reopen`. 이 매치에서 팀을 받은 후속 매치 중 하나라도 `finished`면 409 `DOWNSTREAM_FINISHED`. 아니면 후속 슬롯의 `team_id`와 이 매치의 결과를 비우고 `status=scheduled`로 돌린다.
- 시드 채우기: `POST /api/admin/bracket/seed-from-qualifying`. `seed_rank`가 있는 슬롯을 현재 리더보드 순위의 팀으로 채운다. 해당 순위 팀이 없으면 비워 둔다. 이미 결과가 입력된 매치의 슬롯은 건드리지 않는다.
- 선택(P2): `POST /api/admin/bracket/generate` — `{format: "single_elimination", size: 8}`처럼 요청하면 라운드·매치·슬롯과 `seed_rank`, `source` 연결을 자동 생성한다. 기존 대진이 있으면 거부한다.

### 6.4 REST API

모든 경로는 `/api` 아래에 둔다. 공개 GET 응답에는 `Cache-Control: no-store`를 붙인다.

공개 (인증 없음, GET만):

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/api/health` | 상태 확인 |
| GET | `/api/settings/public` | `apply_form_url`, `apply_open_at`, `apply_close_at`, `event_timezone` |
| GET | `/api/schedule` | 공개 일정 |
| GET | `/api/rules` | 공개 규칙 섹션 |
| GET | `/api/teams` | 활성 팀 공개 정보 |
| GET | `/api/qualifying/leaderboard` | 리더보드 |
| GET | `/api/bracket` | 라운드 → 매치 → 슬롯 중첩 구조 |
| GET | `/api/live/state` | 현재 진행 상태 |

관리자 (`/api/admin`, 세션 필요):

| 메서드 | 경로 | 권한 |
|---|---|---|
| POST | `/auth/login`, `/auth/logout` | 공개 / 로그인 |
| GET | `/auth/me` | 로그인 |
| GET, POST | `/users` | admin |
| PATCH | `/users/{id}` (역할, 활성, 비밀번호 재설정) | admin |
| GET, PUT | `/settings` | admin |
| GET, POST | `/schedule` (비공개 포함 목록) | admin |
| PATCH, DELETE | `/schedule/{id}` | admin |
| PUT | `/schedule/order` | admin |
| GET, POST | `/rules` | admin |
| PATCH, DELETE | `/rules/{id}` | admin |
| PUT | `/rules/order` | admin |
| GET, POST | `/teams` | admin |
| PATCH | `/teams/{id}` | admin |
| GET, POST | `/qualifying/laps` | admin, referee |
| PATCH | `/qualifying/laps/{id}` | admin, referee |
| POST | `/qualifying/laps/{id}/void` | admin, referee |
| GET, POST | `/bracket/rounds` | admin |
| PATCH, DELETE | `/bracket/rounds/{id}` | admin |
| POST | `/bracket/matches` | admin |
| PATCH, DELETE | `/bracket/matches/{id}` | admin |
| PATCH | `/bracket/slots/{id}` | admin |
| POST | `/matches/{id}/result` | admin, referee |
| POST | `/matches/{id}/reopen` | admin, referee |
| POST | `/bracket/seed-from-qualifying` | admin |
| PUT | `/live/state` | admin, referee |
| GET | `/audit` | admin |

팀 삭제는 제공하지 않고 비활성화만 한다. 기록이 있는 팀을 지우면 리더보드와 대진이 깨지기 때문이다.

### 6.5 인증과 권한 (`auth.py`)

- 비밀번호: argon2 해시. 최소 길이 10자.
- 세션: 로그인 성공 시 `sessions` 행을 만들고 쿠키 `rr_session`에 id를 담는다. 쿠키 속성은 `HttpOnly`, `SameSite=Strict`, `Path=/`, `Secure`는 `COOKIE_SECURE`를 따른다. 만료는 `SESSION_TTL_HOURS`.
- 요청마다 세션 만료와 `users.is_active`를 확인한다. 비활성화하거나 비밀번호를 재설정하면 그 사용자의 세션을 모두 지운다.
- CSRF: `SameSite=Strict`에 더해, 관리자 변경 요청에 `X-Requested-With: fetch` 헤더가 없으면 403으로 거부한다.
- 로그인 시도 제한: IP+username 기준 10분 동안 5회 실패하면 429. 단일 프로세스 운영이므로 메모리 저장으로 충분하다.
- 기본 계정을 코드에 넣지 않는다. 첫 관리자는 CLI로 만든다 (6.7).
- 권한 검사는 의존성 함수 `require_role("admin")`, `require_role("admin", "referee")`로 통일한다.

### 6.6 실시간 (WebSocket)

경로: `/ws/live`. 서버 → 클라이언트 방향으로 상태를 보내고, 클라이언트는 ping만 보낸다. 인증 없음(공개 정보만 전송).

메시지 공통 형식:

```json
{ "type": "qualifying.updated", "seq": 42, "ts": "2026-11-01T05:12:33.120Z", "data": { } }
```

| type | data | 발생 시점 |
|---|---|---|
| `snapshot` | `{ live_state, leaderboard, bracket }` | 연결 직후 1회 |
| `live_state.updated` | live_state | 진행 상태 변경 |
| `qualifying.updated` | leaderboard 전체 | 예선 기록 생성·수정·무효, 팀 정보 변경 |
| `bracket.updated` | bracket 전체 | 대진 편집, 결과 입력·되돌리기, 시드 채우기, 팀 정보 변경 |
| `content.updated` | `{ "resource": "schedule" \| "rules" \| "settings" \| "teams" }` | 해당 콘텐츠 변경 |
| `pong` | `{}` | 클라이언트 ping 응답 |

설계 원칙:

- 차분(diff)이 아니라 전체 데이터를 보낸다. 데이터가 작고, 메시지를 하나 놓쳐도 다음 메시지로 복구되기 때문이다.
- 콘텐츠(일정, 규칙 등)는 WebSocket으로 본문을 보내지 않고 `content.updated` 알림만 보낸다. 클라이언트는 REST로 다시 가져온다.

서버 구현 (`live/hub.py`):

- `LiveHub`가 연결 집합, `seq` 카운터, `asyncio.Lock`을 가진다.
- 연결 처리 순서: accept → 락 획득 → 스냅샷 생성(DB 조회는 `run_in_threadpool`) → 연결 등록 → 스냅샷 전송 → 락 해제. 브로드캐스트도 같은 락을 잡으므로 스냅샷과 이벤트의 순서가 뒤섞이지 않는다.
- `broadcast(type, data)`: `seq`를 올리고 JSON을 한 번만 직렬화한 뒤 모든 연결에 전송한다. 전송마다 2초 타임아웃을 두고, 실패한 연결은 제거한다.
- 관리자 라우트는 동기 SQLAlchemy 세션으로 커밋한 다음, 방송할 payload를 만들어 FastAPI `BackgroundTasks`로 `hub.broadcast`를 예약한다. 커밋이 실패하면 방송하지 않는다.
- 클라이언트가 보낸 `{"type":"ping"}`에는 `pong`으로 답하고, 그 외 메시지는 무시한다.
- 허브가 메모리에 있으므로 uvicorn은 반드시 워커 1개로 실행한다. README에 명시한다.

클라이언트 구현 (`features/live/useLiveFeed.ts`):

- 25초마다 ping을 보낸다. 60초 동안 서버 메시지가 없으면 연결을 끊고 재연결한다.
- 재연결은 지수 백오프(1초부터 2배씩, 최대 30초, 무작위 지터 포함).
- `seq`가 마지막으로 처리한 값보다 작거나 같은 메시지는 버린다. 재연결 후 받은 `snapshot`은 항상 적용하고 `seq` 기준을 새로 잡는다.

### 6.7 CLI (`app/cli.py`)

`uv run python -m app.cli <command>`:

| 명령 | 설명 |
|---|---|
| `create-user --username X --role admin` | 비밀번호는 프롬프트로 입력받음 |
| `export-openapi --out ../frontend/src/api/openapi.json` | 서버를 띄우지 않고 OpenAPI 스키마 저장 |
| `seed-demo [--force]` | 가짜 팀 12개, 일정, 규칙, 예선 기록, 8강 대진 생성. DB가 비어 있지 않으면 `--force` 없이는 거부. `APP_ENV=production`에서는 항상 거부 |
| `backup --out PATH` | SQLite 온라인 백업 API로 DB 사본 생성 |

---

## 7. 보안·개인정보 체크

- 개인정보는 이 시스템에 저장하지 않는다 (구글 폼이 보관). 팀 테이블에는 공개 정보만 둔다.
- 공개 API는 비공개 일정·규칙(`is_published=false`)과 비활성 팀을 반환하지 않는다.
- Markdown은 raw HTML 없이 렌더링한다.
- 비밀값은 `.env`에만 둔다. `.gitignore`에 `.env`, `backend/data/*.db*`, `node_modules/`, `frontend/dist/`, `design-review/`를 넣는다.
- 관리자 화면 HTML에는 `<meta name="robots" content="noindex">`를 넣는다 (SPA이므로 `/admin` 진입 시 동적으로 추가).

---

## 8. 테스트

백엔드 (pytest + FastAPI TestClient, 테스트마다 임시 SQLite):

- 인증: 비로그인 관리자 API 401, referee의 콘텐츠 수정 403, `X-Requested-With` 누락 시 403, 로그인 5회 실패 후 429
- 일정·규칙: CRUD, 비공개 항목이 공개 API에 나오지 않음, `version` 불일치 409
- 리더보드: 정렬 규칙, 동률 처리, void/dnf/dsq 제외, 기록 없는 팀 위치
- 대진: 결과 입력 후 후속 슬롯 채움, 후속 매치 종료 시 되돌리기 409, 시드 채우기, 순환 참조 거부
- WebSocket: 연결 직후 `snapshot` 수신, 랩 기록 POST 후 `qualifying.updated` 수신, 일정 수정 후 `content.updated` 수신

프론트엔드 (vitest):

- `laptime.ts` 파싱·포맷과 범위 검증
- `pickLocalized` 영어 누락 시 한국어 대체
- live 메시지 처리 로직(seq 무시 규칙, snapshot 재적용)

---

## 9. 배포 준비 (학교 서버)

외부 공개 경로는 미정이다. 어떤 방식이 되더라도 동작하도록 단일 프로세스 실행을 기본으로 한다.

- 프로덕션에서는 FastAPI가 `FRONTEND_DIST`의 정적 파일을 제공한다. `/api`, `/ws`가 아닌 경로 중 파일이 없는 경로는 `index.html`을 반환한다 (SPA fallback).
- 실행: `uv run uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 1`
- README에 다음 절차를 적는다.
  1. 최초 설치: 저장소 clone → `frontend`에서 `npm ci && npm run build` → `backend`에서 `uv sync` → `.env` 작성 → `uv run alembic upgrade head` → `create-user`로 관리자 생성 → 실행
  2. 업데이트: `git pull` → 프론트 재빌드 → `alembic upgrade head` → 재시작. DB 파일은 저장소 밖(`backend/data/`)에 있으므로 유지된다.
  3. 백업: `backup` 명령을 대회 기간에는 주기적으로 실행할 것을 권장
  4. 리버스 프록시 뒤에서 운영할 경우 `/ws/live`에 WebSocket Upgrade 헤더를 전달해야 하고, HTTPS 적용 시 `COOKIE_SECURE=true`로 바꿔야 한다는 점
- 선택(P2): 멀티 스테이지 `Dockerfile`(Node로 빌드 → Python 런타임)과 `docker-compose.yml`(포트 8000, `backend/data` 볼륨). 학교 서버 환경이 정해지면 조정한다.

---

## 10. 작업 단계와 완료 기준

| 단계 | 작업 | 완료 기준 |
|---|---|---|
| 1. 골격 | 모노레포 구성, Vite/FastAPI 초기화, dev proxy, lint/format 설정, `/api/health`, `.gitignore`, README 뼈대 | 두 서버를 띄우면 빈 레이아웃이 보이고 `/api/health`가 200 |
| 2. 공통 UI·다국어 | `DESIGN.md` Step A(시안 3개 제안 → 사용자 선택) 후 레이아웃, 탭 내비, 언어 토글, 토큰, 404, 소개 페이지(히어로 포함) | 모든 탭 이동 가능, KO/EN 전환이 소개 페이지 전체에 반영, 360px에서 가로 스크롤 없음 |
| 3. DB·인증 | 모델, Alembic 초기 마이그레이션, 세션 인증, 권한 의존성, `create-user`, audit 로깅 | 인증 관련 테스트 통과 |
| 4. 콘텐츠 | 설정·일정·규칙·팀 API, 공개 일정/규칙/신청 페이지, 관리자 편집 화면, OpenAPI 타입 생성 | 관리자에서 저장한 일정·규칙이 공개 페이지에 표시됨, 콘텐츠 테스트 통과 |
| 5. 경기 데이터 | 예선 기록, 리더보드, 범용 대진, 진출 처리, live_state API와 관리자 화면 | 리더보드·대진 테스트 통과 |
| 6. 실시간 | LiveHub, `/ws/live`, LiveProvider, 쿼리 갱신, 모니터링 페이지, mock 발생기, `seed-demo` | WebSocket 테스트 통과, 11장의 실시간 항목 수동 확인 |
| 7. 배포 준비 | 정적 파일 제공, SPA fallback, `backup`, README 배포 절차, (P2) Docker | 빌드 후 백엔드 하나만 띄워도 전체 사이트 동작 |

---

## 11. 최종 인수 체크리스트

- [ ] 탭 5개와 관리자 화면 이동이 모두 동작한다.
- [ ] 언어 토글이 모든 공개 페이지에 반영되고, 영어 값이 빈 DB 콘텐츠는 한국어로 표시된다.
- [ ] 관리자 화면에서 일정을 추가하면, 다른 브라우저에 열려 있는 `/schedule`에 새로고침 없이 나타난다.
- [ ] 규칙 섹션을 수정하면 열려 있는 `/rules`에 새로고침 없이 반영된다.
- [ ] 심판 계정으로 랩타임을 입력하면 열려 있는 `/live` 리더보드가 즉시 갱신된다.
- [ ] 매치 결과를 입력하면 후속 매치 슬롯이 채워지고 `/live` 대진에 반영된다.
- [ ] 서버를 재시작하면 `/live`가 자동으로 재연결되고 최신 상태를 다시 표시한다.
- [ ] 신청 폼 URL이 비어 있으면 신청 버튼이 "준비 중" 상태로 비활성화된다.
- [ ] 비로그인 관리자 API는 401, referee의 콘텐츠 수정은 403이다.
- [ ] `VITE_USE_MOCK=true`로 백엔드 없이 모든 공개 페이지가 동작한다.
- [ ] 백엔드·프론트 테스트와 lint가 통과한다.
- [ ] 저장소에 `.env`, DB 파일, 빌드 산출물이 없다.
- [ ] `grep -r "TBD:"`로 채워야 할 콘텐츠 위치를 모두 찾을 수 있다.

---

## 12. 미정 사항

| 항목 | 현재 처리 |
|---|---|
| 외부 공개 경로, 도메인, HTTPS | 단일 프로세스 실행만 보장. 프록시 관련 주의점은 README에 기록 |
| 본선 형식 | 범용 라운드·매치·슬롯 구조. 싱글 엘리미네이션 자동 생성은 P2 |
| 예선 기록 산정 방식 | 최고 랩 기준. 산정 함수를 분리해서 교체 가능하게 둠 |
| 디자인 세부 방향 | `DESIGN.md` Step A에서 시안 3개 중 사용자가 선택 |
| 로고 | 텍스트 로고 자리표시 |
| 소개 페이지 콘텐츠 | 코드(i18n 파일)에서 관리. 이후 DB 관리로 바꿀 필요가 생기면 일정·규칙과 같은 방식으로 확장 |
| 공지사항 등 추가 콘텐츠 | 없음. 필요하면 rule_sections와 같은 패턴으로 테이블과 `content.updated` 리소스를 추가 |