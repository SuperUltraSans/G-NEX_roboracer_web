# API 명세

이 사이트의 REST API 와 실시간 연결을 설명한다. 구조는 [아키텍처](ARCHITECTURE.md), 순위 계산과 대진 규칙은 [대회 로직](DOMAIN.md)에 있다.

기계가 읽는 스키마는 [`frontend/src/api/openapi.json`](../frontend/src/api/openapi.json) 이다. 개발 모드에서는 `/api/docs` 에서 직접 호출해 볼 수 있다. 운영 모드(`APP_ENV=production`)에서는 `/api/docs` 와 `/api/openapi.json` 을 내지 않는다.

## 1. 공통 규칙

### 주소와 형식

- 모든 경로는 `/api` 아래에 있다. 서브패스에 배포하면 그 앞에 배포 경로가 붙는다(예: `/roboracer/api/health`). 프록시가 배포 경로를 떼고 넘기므로 서버는 이 경로를 모른다.
- 요청과 응답은 JSON(UTF-8)이다. 규칙 ZIP 과 그림 파일만 예외다.
- 시각은 시간대가 있는 ISO 8601 문자열이다(`2026-11-01T05:12:33Z`). 시간대가 없는 시각을 보내면 422 다. 서버는 UTC 로 저장하고, 화면은 `event_timezone`(기본 `Asia/Seoul`)으로 보여 준다.
- 랩타임은 정수 밀리초다. 1,000~600,000 범위이고 10 단위(0.01초)여야 한다.
- 한국어와 영어 값은 `title_ko`, `title_en` 처럼 짝으로 둔다. 영어 값이 비어 있으면 화면이 한국어를 보여 준다.

### 캐시

| 대상 | `Cache-Control` |
|---|---|
| 공개 API, 관리자 API | `no-store` |
| 공개 규칙 그림 (`/api/rules/files/…`) | `no-cache` |
| 해시가 붙은 정적 파일 (`/assets/…`) | `public, max-age=31536000, immutable` |
| 화면 HTML, 그 밖의 정적 파일, 사이트맵 | `no-cache` |

### 인증과 권한

| 권한 | 들어오는 방법 | 실패 |
|---|---|---|
| 공개 | 없음 | |
| 로그인 | 세션 쿠키 (관리자, 심판) | 401 `UNAUTHENTICATED` |
| 콘솔 | 세션 쿠키 (관리자, 심판) 또는 `X-Monitor-Key` 헤더 | 둘 다 없으면 401 `UNAUTHENTICATED`, 값이 틀리면 403 `MONITOR_KEY_INVALID` |
| 관리자 | 세션 쿠키 (역할 `admin`) | 401 `UNAUTHENTICATED`, 역할이 다르면 403 `FORBIDDEN` |

- **세션 쿠키:** 이름은 `rr_session` 이다. `HttpOnly`, `SameSite=Strict` 이고, `Path` 는 `COOKIE_PATH`, `Secure` 는 `COOKIE_SECURE`, 수명은 `SESSION_TTL_HOURS`(기본 12시간)를 따른다.
- **CSRF:** `/api/admin` 아래의 변경 요청(POST, PUT, PATCH, DELETE)에는 `X-Requested-With: fetch` 헤더가 있어야 한다. 없으면 인증을 보기 전에 403 `FORBIDDEN` 이다. 로그인 요청도 마찬가지다.
- **콘솔 비밀 값:** `/monitoring-admin?pw=<값>` 으로 들어온 화면이 이 값을 `X-Monitor-Key` 헤더로 보낸다. 이렇게 한 작업의 작업자는 시스템 계정 `monitoring` 으로 남는다. 세션 쿠키가 유효하면 헤더를 보지 않는다.
- **시도 제한:** 로그인은 같은 IP·아이디로 10분 안에 5번, 콘솔 비밀 값은 같은 IP 로 10분 안에 10번 틀리면 429 `RATE_LIMITED` 다. 기록은 서버 메모리에 있어 재시작하면 지워진다.

### 동시 수정

일정, 규칙 섹션, 팀, 예선 랩, 매치에는 정수 `version` 이 있다. 고칠 때 받은 `version` 을 함께 보내고, 서버 값과 다르면 409 `VERSION_CONFLICT` 다. 성공하면 1 올라간다. 매치의 `version` 은 그 매치의 칸이 바뀔 때도 올라간다.

`version` 이 필수인 요청은 일정·규칙·팀·랩·매치 고치기, 결과 입력, 칸 바꾸기다. 랩 입력 취소와 결과 되돌리기는 보낼 때만 검사한다.

### 오류

모든 오류는 같은 형식이다. `errors` 는 입력 검증 오류일 때만 들어 있다.

```json
{
  "detail": "사람이 읽을 메시지",
  "code": "VALIDATION_ERROR",
  "errors": [{ "loc": ["body", "lap_time_ms"], "msg": "오류 내용" }]
}
```

| 상태 | `code` | 뜻 |
|---|---|---|
| 401 | `UNAUTHENTICATED` | 로그인이 필요하다 |
| 401 | `INVALID_CREDENTIALS` | 아이디나 비밀번호가 틀렸다 |
| 403 | `FORBIDDEN` | 권한이 없거나 `X-Requested-With` 헤더가 없다 |
| 403 | `MONITOR_KEY_INVALID` | 콘솔 비밀 값이 틀렸다 |
| 404 | `NOT_FOUND` | 대상이 없다 |
| 404 | `PAGE_CLOSED` | 닫아 게시한 페이지의 내용이다 |
| 405 | `METHOD_NOT_ALLOWED` | 그 경로에 없는 메서드다 |
| 409 | `VERSION_CONFLICT` | 다른 사람이 먼저 고쳤다 |
| 409 | `DUPLICATE` | 겹칠 수 없는 값이 이미 있다 |
| 409 | `TEAM_LIMIT` | 참가 팀이 이미 15팀이다 |
| 409 | `LAST_ADMIN` | 마지막 관리자를 강등하거나 비활성화하려 했다 |
| 409 | `MONITOR_USER_TAKEN` | 사람 계정이 `monitoring` 아이디를 쓰고 있어 콘솔 비밀 값을 쓸 수 없다 |
| 409 | `MAPPING_FROZEN` | 맵핑 순서를 동결했다 |
| 409 | `INSPECTION_ORDER_TAKEN` | 검차 번호가 겹친다 |
| 409 | `GROUP_FULL` | 연습 조의 정원이 찼다 |
| 409 | `BRACKET_EXISTS` | 대진이 이미 있어 자동으로 만들 수 없다 |
| 409 | `BRACKET_STARTED` | 끝난 경기가 있어 시드를 다시 채울 수 없다 |
| 409 | `BRACKET_FROZEN` | 본선 결과를 동결했다 |
| 409 | `MATCH_FINISHED` | 끝난 매치다. 먼저 결과를 되돌린다 |
| 409 | `MATCH_NOT_FINISHED` | 끝나지 않은 매치는 되돌릴 수 없다 |
| 409 | `DOWNSTREAM_FINISHED` | 이 결과를 받은 후속 매치가 이미 끝났다 |
| 413 | `PAYLOAD_TOO_LARGE` | 올린 ZIP 이 한도를 넘었다 |
| 422 | `VALIDATION_ERROR` | 입력이 올바르지 않다 |
| 429 | `RATE_LIMITED` | 시도 제한에 걸렸다 |
| 500 | `INTERNAL_ERROR` | 서버 오류다. 자세한 내용은 서버 로그에 있다 |

### 변경 이력

관리자 변경 요청은 같은 트랜잭션 안에서 `audit_logs` 에 기록을 남긴다. 비밀번호 해시와 콘솔 비밀 값은 남기지 않는다.

## 2. 화면 주소

API 가 아닌 주소는 서버가 다음 순서로 답한다.

1. `FRONTEND_DIST` 에 있는 파일이면 그 파일을 준다.
2. `/assets/` 아래에 없는 파일이면 404 다. 배포 뒤에 예전 파일을 요청한 것을 프론트가 알아채게 한다.
3. 나머지는 `index.html` 에 검색엔진용 제목·설명·본문을 넣어 준다. 앱이 모르는 주소는 화면은 같고 상태만 404 다.

`/api`, `/ws` 아래의 없는 경로는 JSON 404 다. `GET /sitemap.xml` 은 `PUBLIC_URL` 을 정했을 때만 있다.

## 3. REST API

권한 이름은 [인증과 권한](#인증과-권한)에 있다. 요청과 응답의 필드는 [데이터 형식](#5-데이터-형식)에 있다.

### 공개

로그인 없이 읽는다. 일정·규칙·설정은 초안이 아니라 게시한 공개본을 준다.

| 메서드와 경로 | 권한 | 요청 본문 | 성공 응답 | 설명 |
|---|---|---|---|---|
| `GET /api/health` | 공개 | 없음 | 200 [`HealthStatus`](#healthstatus) | 상태 확인. 항상 `{"status":"ok"}`. 컨테이너 상태 검사가 쓴다. |
| `GET /api/settings/public` | 공개 | 없음 | 200 [`PublicSettings`](#publicsettings) | 게시된 신청 설정·페이지 공개 상태와 대회 시간대. 콘솔 비밀 값은 들어 있지 않다. |
| `GET /api/schedule` | 공개 | 없음 | 200 [`ScheduleItemPublic`](#scheduleitempublic) 목록 | 게시된 일정. 일정 페이지를 닫아 게시했으면 404 `PAGE_CLOSED`. |
| `GET /api/rules` | 공개 | 없음 | 200 [`RuleSectionPublic`](#rulesectionpublic) 목록 | 게시된 규칙 섹션. 규칙 페이지를 닫아 게시했으면 404 `PAGE_CLOSED`. |
| `GET /api/rules/files/{path}` | 공개 | 없음 | 200 그림 파일 | 규칙 본문의 그림(png, jpg, gif, webp, avif). 규칙 페이지를 닫아 게시했으면 404 `PAGE_CLOSED`. `Cache-Control: no-cache`. |
| `GET /api/teams` | 공개 | 없음 | 200 [`TeamPublic`](#teampublic) 목록 | 참가(활성) 팀 목록. |
| `GET /api/qualifying/leaderboard` | 공개 | 없음 | 200 [`Leaderboard`](#leaderboard) | 예선 리더보드. 계산 방식은 [대회 로직](DOMAIN.md#3-예선-순위). |
| `GET /api/bracket` | 공개 | 없음 | 200 [`Bracket`](#bracket) | 본선 대진 전체(라운드 → 매치 → 칸). |
| `GET /api/results` | 공개 | 없음 | 200 [`Results`](#results) | 시상 결과. 대상 → 최우수상 → 우수상 순서이고 받은 팀이 없는 상은 빠진다. |
| `GET /api/live/state` | 공개 | 없음 | 200 [`LiveState`](#livestate) | 진행 상태와 맵핑 순서, 연습 조, 동결 여부. |

### 인증·계정·변경 이력

| 메서드와 경로 | 권한 | 요청 본문 | 성공 응답 | 설명 |
|---|---|---|---|---|
| `POST /api/admin/auth/login` | 공개 | [`LoginRequest`](#loginrequest) | 200 [`UserOut`](#userout) | 로그인하고 `rr_session` 쿠키를 준다. 틀리면 401 `INVALID_CREDENTIALS`, 같은 IP·아이디로 10분 안에 5번 틀리면 429 `RATE_LIMITED`. 이 요청에도 `X-Requested-With` 헤더가 필요하다. |
| `POST /api/admin/auth/logout` | 로그인 | 없음 | 204 | 지금 세션을 지우고 쿠키를 없앤다. |
| `GET /api/admin/auth/me` | 로그인 | 없음 | 200 [`UserOut`](#userout) | 지금 로그인한 계정. |
| `GET /api/admin/users` | 관리자 | 없음 | 200 [`UserAdmin`](#useradmin) 목록 | 계정 목록. 시스템 계정은 빠진다. |
| `POST /api/admin/users` | 관리자 | [`UserCreate`](#usercreate) | 201 [`UserAdmin`](#useradmin) | 계정을 만든다. 같은 아이디는 409 `DUPLICATE`, `monitoring` 은 예약된 아이디라 422. |
| `PATCH /api/admin/users/{user_id}` | 관리자 | [`UserUpdate`](#userupdate) | 200 [`UserAdmin`](#useradmin) | 역할, 사용 여부, 비밀번호를 바꾼다. 마지막 관리자를 강등·비활성화하면 409 `LAST_ADMIN`. 비활성화하거나 비밀번호를 바꾸면 그 계정의 세션을 모두 지운다. |
| `GET /api/admin/audit` | 관리자 | 없음 | 200 [`AuditLogPage`](#auditlogpage) | 변경 이력(최신순). 쿼리 `entity` 로 표 이름을 거른다. |

### 사이트 설정

| 메서드와 경로 | 권한 | 요청 본문 | 성공 응답 | 설명 |
|---|---|---|---|---|
| `GET /api/admin/settings` | 관리자 | 없음 | 200 [`AdminSettings`](#adminsettings) | 사이트 설정 초안. 콘솔 비밀 값도 들어 있다. |
| `PUT /api/admin/settings` | 관리자 | [`AdminSettingsUpdate`](#adminsettingsupdate) | 200 [`AdminSettings`](#adminsettings) | 신청 폼 주소와 접수 기간을 통째로 바꾼다(빠진 값은 비운다). `https://` 주소만 받는다. 게시해야 공개된다. |
| `PUT /api/admin/settings/monitor` | 관리자 | [`MonitorKeyUpdate`](#monitorkeyupdate) | 200 [`AdminSettings`](#adminsettings) | 콘솔 비밀 값을 바꾼다. `key: null` 이면 끈다. 예전 주소는 바로 막히고, 값은 변경 이력에 남지 않는다. 게시가 필요 없다. |
| `PUT /api/admin/settings/pages` | 관리자 | [`PageStates`](#pagestates) | 200 [`AdminSettings`](#adminsettings) | 일정, 규칙, 모니터링 페이지를 열고 닫는다. 게시해야 공개된다. |

### 일정

여기서 고친 내용은 초안이다. 공개하려면 [게시](#게시와-미리보기)한다.

| 메서드와 경로 | 권한 | 요청 본문 | 성공 응답 | 설명 |
|---|---|---|---|---|
| `GET /api/admin/schedule` | 관리자 | 없음 | 200 [`ScheduleItemAdmin`](#scheduleitemadmin) 목록 | 일정 초안 전체(비공개 포함). |
| `POST /api/admin/schedule` | 관리자 | [`ScheduleItemCreate`](#scheduleitemcreate) | 201 [`ScheduleItemAdmin`](#scheduleitemadmin) | 일정을 추가한다. 게시해야 공개된다. |
| `GET /api/admin/schedule/document` | 관리자 | 없음 | 200 [`ScheduleDocument`](#scheduledocument) | 일정 전체를 Markdown 문서로 내려받는다. |
| `PUT /api/admin/schedule/document` | 관리자 | [`ScheduleDocumentImport`](#scheduledocumentimport) | 200 [`ScheduleImportResult`](#scheduleimportresult) | 문서대로 일정 전체를 바꾼다. 형식이 틀리면 몇 번째 줄인지 알려 주는 422 이고 아무것도 바꾸지 않는다. 형식은 [대회 로직](DOMAIN.md#일정-문서). |
| `PUT /api/admin/schedule/order` | 관리자 | [`OrderUpdate`](#orderupdate) | 200 [`ScheduleItemAdmin`](#scheduleitemadmin) 목록 | 순서를 바꾼다. 모든 항목의 id 를 한 번씩 보낸다. |
| `PATCH /api/admin/schedule/{item_id}` | 관리자 | [`ScheduleItemUpdate`](#scheduleitemupdate) | 200 [`ScheduleItemAdmin`](#scheduleitemadmin) | 보낸 필드만 고친다. `version` 이 다르면 409 `VERSION_CONFLICT`. |
| `DELETE /api/admin/schedule/{item_id}` | 관리자 | 없음 | 204 | 일정을 지운다. |

### 규칙

여기서 고친 내용은 초안이다. 공개하려면 [게시](#게시와-미리보기)한다.

| 메서드와 경로 | 권한 | 요청 본문 | 성공 응답 | 설명 |
|---|---|---|---|---|
| `GET /api/admin/rules` | 관리자 | 없음 | 200 [`RuleSectionAdmin`](#rulesectionadmin) 목록 | 규칙 섹션 초안 전체(비공개 포함). |
| `POST /api/admin/rules` | 관리자 | [`RuleSectionCreate`](#rulesectioncreate) | 201 [`RuleSectionAdmin`](#rulesectionadmin) | 규칙 섹션을 추가한다. 서버의 규칙 문서도 다시 쓴다. 게시해야 공개된다. |
| `PUT /api/admin/rules/order` | 관리자 | [`OrderUpdate`](#orderupdate) | 200 [`RuleSectionAdmin`](#rulesectionadmin) 목록 | 순서를 바꾼다. 모든 항목의 id 를 한 번씩 보낸다. |
| `GET /api/admin/rules/document` | 관리자 | 없음 | 200 [`RulesDocument`](#rulesdocument) | 한 언어의 규칙 전체를 Markdown 문서로 내려받는다. 쿼리 `lang` 은 `ko` 또는 `en`. |
| `PUT /api/admin/rules/document` | 관리자 | [`RulesDocumentImport`](#rulesdocumentimport) | 200 [`RulesImportResult`](#rulesimportresult) | 문서로 규칙 섹션을 바꾼다. `ko` 는 섹션 수까지 문서에 맞추고, `en` 은 영어 제목·본문만 바꾼다(섹션이 더 많거나 장·절 구조가 다르면 422). 그림 주소는 서버에 저장된 그림으로 찾는다. |
| `PUT /api/admin/rules/package` | 관리자 | ZIP 바이트 | 200 [`RulesImportResult`](#rulesimportresult) | Markdown 문서 하나와 그림을 묶은 ZIP 을 올린다. 본문은 ZIP 바이트(`application/zip`), 쿼리 `lang`. 요청 50MB를 넘으면 413 `PAYLOAD_TOO_LARGE`. 압축을 푼 크기 200MB, 항목 1,000개까지. |
| `GET /api/admin/rules/package` | 관리자 | 없음 | 200 ZIP | `rules.<lang>.md` 와 문서가 쓰는 그림을 담은 ZIP. 그대로 다시 올릴 수 있다. 쿼리 `lang`. |
| `PATCH /api/admin/rules/{section_id}` | 관리자 | [`RuleSectionUpdate`](#rulesectionupdate) | 200 [`RuleSectionAdmin`](#rulesectionadmin) | 보낸 필드만 고친다. `version` 이 다르면 409 `VERSION_CONFLICT`. 본문에 `#`·`##` 제목 줄이 있으면 422. |
| `DELETE /api/admin/rules/{section_id}` | 관리자 | 없음 | 204 | 규칙 섹션을 지운다. |

### 팀

| 메서드와 경로 | 권한 | 요청 본문 | 성공 응답 | 설명 |
|---|---|---|---|---|
| `GET /api/admin/teams` | 관리자 | 없음 | 200 [`TeamAdmin`](#teamadmin) 목록 | 비활성 팀까지 모든 팀. |
| `POST /api/admin/teams` | 관리자 | [`TeamCreate`](#teamcreate) | 201 [`TeamAdmin`](#teamadmin) | 팀을 만든다. 이름이 겹치면(대소문자 무시) 409 `DUPLICATE`, 참가 팀이 15팀이면 409 `TEAM_LIMIT`. |
| `PATCH /api/admin/teams/{team_id}` | 관리자 | [`TeamUpdate`](#teamupdate) | 200 [`TeamAdmin`](#teamadmin) | 팀을 고친다. `is_active` 를 끄면 기권으로 처리한다([대회 로직](DOMAIN.md#8-기권)). 409 `VERSION_CONFLICT`, `DUPLICATE`, `TEAM_LIMIT`. |

### 예선

| 메서드와 경로 | 권한 | 요청 본문 | 성공 응답 | 설명 |
|---|---|---|---|---|
| `GET /api/admin/qualifying/laps` | 콘솔 | 없음 | 200 [`QualifyingLapAdmin`](#qualifyinglapadmin) 목록 | 최근 랩 기록. 쿼리 `limit`(1~200, 기본 20), `team_id`. |
| `POST /api/admin/qualifying/laps` | 콘솔 | [`QualifyingLapCreate`](#qualifyinglapcreate) | 201 [`QualifyingLapAdmin`](#qualifyinglapadmin) | 랩을 기록한다. `mission` 을 비우면 서버가 저장 순간의 진행으로 정한다. Q3 유효 랩은 `lap_time_ms` 가 필요하다. |
| `PATCH /api/admin/qualifying/laps/{lap_id}` | 콘솔 | [`QualifyingLapUpdate`](#qualifyinglapupdate) | 200 [`QualifyingLapAdmin`](#qualifyinglapadmin) | 랩을 고친다. 입력 취소한 기록은 고칠 수 없다(422). 409 `VERSION_CONFLICT`. |
| `POST /api/admin/qualifying/laps/{lap_id}/void` | 콘솔 | [`QualifyingLapVoid`](#qualifyinglapvoid) | 200 [`QualifyingLapAdmin`](#qualifyinglapadmin) | 입력을 취소한다(`status: void`). 사유가 필요하고 순위 계산에서 빠진다. |
| `GET /api/admin/qualifying/events` | 콘솔 | 없음 | 200 [`QualifyingEventAdmin`](#qualifyingeventadmin) 목록 | 예선 판정 목록. 쿼리 `team_id`. |
| `POST /api/admin/qualifying/events` | 콘솔 | [`QualifyingEventCreate`](#qualifyingeventcreate) | 201 [`QualifyingEventAdmin`](#qualifyingeventadmin) | 판정을 내린다. `fa_lost` 는 한 팀에 한 번만, `rank_drop` 은 여러 번 가능하다. |
| `DELETE /api/admin/qualifying/events/{event_id}` | 콘솔 | 없음 | 204 | 판정을 취소한다. 변경 이력에는 남는다. |
| `GET /api/admin/qualifying/inspection` | 콘솔 | 없음 | 200 [`InspectionEntry`](#inspectionentry) 목록 | 차량 검사 상태와 순서. |
| `PUT /api/admin/qualifying/inspection/{team_id}` | 콘솔 | [`InspectionUpdate`](#inspectionupdate) | 200 [`InspectionEntry`](#inspectionentry) 목록 | 차량 검사 완료를 표시하거나 취소한다. |
| `PUT /api/admin/qualifying/order` | 콘솔 | [`QualifyingOrderUpdate`](#qualifyingorderupdate) | 200 [`Leaderboard`](#leaderboard) | 예선 출전 순서를 바꾼다. 참가 팀을 빠짐없이 한 번씩 보낸다. 맵핑 순서는 그대로 잠겨 있다. |
| `PUT /api/admin/qualifying/inspection-order` | 콘솔 | [`InspectionOrderUpdate`](#inspectionorderupdate) | 200 [`InspectionEntry`](#inspectionentry) 목록 | 검차 완료 순서를 직접 적는다. 고칠 팀만 보내도 된다. 번호가 겹치면 409 `INSPECTION_ORDER_TAKEN`. |

### 본선 대진

조회와 '시드 채우기'·결과 입력·되돌리기 말고는 관리자만 쓴다. 본선 결과를 동결한 뒤에는 조회 말고 모두 409 `BRACKET_FROZEN` 이다.

| 메서드와 경로 | 권한 | 요청 본문 | 성공 응답 | 설명 |
|---|---|---|---|---|
| `GET /api/admin/bracket/rounds` | 콘솔 | 없음 | 200 [`BracketRoundAdmin`](#bracketroundadmin) 목록 | 라운드 목록(매치 없이). |
| `POST /api/admin/bracket/rounds` | 관리자 | [`BracketRoundCreate`](#bracketroundcreate) | 201 [`BracketRoundAdmin`](#bracketroundadmin) | 라운드를 추가한다. |
| `PATCH /api/admin/bracket/rounds/{round_id}` | 관리자 | [`BracketRoundUpdate`](#bracketroundupdate) | 200 [`BracketRoundAdmin`](#bracketroundadmin) | 라운드를 고친다. |
| `DELETE /api/admin/bracket/rounds/{round_id}` | 관리자 | 없음 | 204 | 라운드와 그 매치를 지운다. 지운 매치를 가리키던 칸은 출처만 끊고 팀은 남긴다. |
| `POST /api/admin/bracket/matches` | 관리자 | [`BracketMatchCreate`](#bracketmatchcreate) | 201 [`BracketMatch`](#bracketmatch) | 매치를 추가한다. 라벨이 겹치면 409 `DUPLICATE`. |
| `PATCH /api/admin/bracket/matches/{match_id}` | 관리자 | [`BracketMatchUpdate`](#bracketmatchupdate) | 200 [`BracketMatch`](#bracketmatch) | 매치를 고친다. `slot_count` 로 칸 수를 바꾼다. 끝난 매치는 409 `MATCH_FINISHED`. |
| `DELETE /api/admin/bracket/matches/{match_id}` | 관리자 | 없음 | 204 | 매치를 지운다. |
| `PATCH /api/admin/bracket/slots/{slot_id}` | 관리자 | [`BracketSlotUpdate`](#bracketslotupdate) | 200 [`BracketMatch`](#bracketmatch) | 칸을 채우는 방법을 고친다(팀 직접 지정, 예선 순위, 앞 매치 결과). 바뀐 칸이 속한 매치를 돌려준다. 순환 참조·중복은 422. |
| `POST /api/admin/bracket/slots/swap` | 관리자 | [`BracketSlotSwap`](#bracketslotswap) | 200 [`Bracket`](#bracket) | 두 칸의 자리를 바꾼다(팀과 채우는 방법을 함께). 끝난 매치의 칸은 409 `MATCH_FINISHED`. |
| `POST /api/admin/bracket/seed-from-ranking` | 콘솔 | 없음 | 200 [`Bracket`](#bracket) | `seed_rank` 칸을 저장된 랭킹으로 채운다. 끝난 경기가 하나라도 있으면 409 `BRACKET_STARTED`. |
| `POST /api/admin/bracket/generate` | 관리자 | [`BracketGenerate`](#bracketgenerate) | 201 [`Bracket`](#bracket) | 싱글 엘리미네이션 대진을 만든다(2·4·8·16강). 이미 라운드가 있으면 409 `BRACKET_EXISTS`. |
| `POST /api/admin/matches/{match_id}/result` | 콘솔 | [`MatchResultSubmit`](#matchresultsubmit) | 200 [`BracketMatch`](#bracketmatch) | 결과를 입력하고 매치를 끝낸다. 다음 매치 칸을 채운다. 규칙은 [대회 로직](DOMAIN.md#6-본선-대진). |
| `POST /api/admin/matches/{match_id}/reopen` | 콘솔 | [`MatchReopen`](#matchreopen) | 200 [`BracketMatch`](#bracketmatch) | 결과를 되돌린다. 후속 매치가 끝났으면 409 `DOWNSTREAM_FINISHED`, 끝나지 않은 매치면 409 `MATCH_NOT_FINISHED`. |

### 진행 상태·맵핑·연습·랭킹

| 메서드와 경로 | 권한 | 요청 본문 | 성공 응답 | 설명 |
|---|---|---|---|---|
| `PUT /api/admin/live/state` | 콘솔 | [`LiveStateUpdate`](#livestateupdate) | 200 [`LiveState`](#livestate) | 현재 단계, 트랙 위 팀, 진행 중 매치, 공지를 바꾼다. 진행 중 매치를 바꾸면 그 매치의 상태도 따라 바뀐다. |
| `POST /api/admin/mapping/shuffle` | 콘솔 | 없음 | 200 [`LiveState`](#livestate) | 참가 팀의 맵핑 순서를 섞는다. 맵핑을 마친 팀은 지금 순서대로 앞에 둔다. 동결했으면 409 `MAPPING_FROZEN`. |
| `DELETE /api/admin/mapping` | 콘솔 | 없음 | 200 [`LiveState`](#livestate) | 맵핑 순서와 완료 기록을 모두 지운다. 동결했으면 409 `MAPPING_FROZEN`. |
| `PUT /api/admin/mapping/{team_id}` | 콘솔 | [`MappingUpdate`](#mappingupdate) | 200 [`LiveState`](#livestate) | 팀의 맵핑 완료를 표시하거나 취소한다. 동결했으면 409 `MAPPING_FROZEN`. |
| `PUT /api/admin/practice/{team_id}` | 콘솔 | [`PracticeUpdate`](#practiceupdate) | 200 [`LiveState`](#livestate) | 차량 검사를 마친 팀의 연습 조를 정한다. 정원이 차면 409 `GROUP_FULL`. |
| `GET /api/admin/ranking` | 콘솔 | 없음 | 200 [`Ranking`](#ranking) | 저장된 랭킹(활성 팀만). |
| `PUT /api/admin/ranking` | 콘솔 | [`RankingUpdate`](#rankingupdate) | 200 [`Ranking`](#ranking) | 1위부터 팀 ID 로 랭킹을 통째로 바꾼다. 시드는 시드 채우기를 해야 바뀐다. |
| `GET /api/admin/monitor/access` | 콘솔 | 없음 | 200 [`MonitorAccess`](#monitoraccess) | 콘솔을 쓸 수 있는지와 들어온 방법을 확인한다. |

### 게시와 미리보기

| 메서드와 경로 | 권한 | 요청 본문 | 성공 응답 | 설명 |
|---|---|---|---|---|
| `GET /api/admin/publish` | 관리자 | 없음 | 200 [`PublishState`](#publishstate) 목록 | 일정, 규칙, 사이트 설정의 게시 상태. |
| `POST /api/admin/publish/{resource}` | 관리자 | 없음 | 200 [`PublishState`](#publishstate) | 초안을 공개한다. `resource` 는 `schedule`, `rules`, `settings`. |
| `GET /api/admin/preview/settings` | 관리자 | 없음 | 200 [`PublicSettings`](#publicsettings) | 게시하면 공개될 설정. |
| `GET /api/admin/preview/schedule` | 관리자 | 없음 | 200 [`ScheduleItemPublic`](#scheduleitempublic) 목록 | 게시하면 공개될 일정. 페이지를 닫아 두어도 내용을 준다. |
| `GET /api/admin/preview/rules` | 관리자 | 없음 | 200 [`RuleSectionPublic`](#rulesectionpublic) 목록 | 게시하면 공개될 규칙. 페이지를 닫아 두어도 내용을 준다. |
| `GET /api/admin/preview/rules/files/{path}` | 관리자 | 없음 | 200 그림 파일 | 규칙 그림. 규칙 페이지가 닫혀 있어도 보인다. `Cache-Control: no-store`. |

## 4. 실시간 연결 (WebSocket)

**지금 상태:** 대회가 끝나 프론트엔드가 연결을 열지 않는다(`frontend/src/features/live/useLiveFeed.ts` 의 `LIVE_FEED_ON = false`). 서버의 `/ws/live` 는 그대로 있고 계속 방송한다. 다시 켜는 방법은 [아키텍처](ARCHITECTURE.md#실시간-연결)에 있다.

- **주소:** `/ws/live`. 인증이 없고 공개 정보만 보낸다.
- **방향:** 서버 → 클라이언트. 클라이언트는 `{"type":"ping"}` 만 보내고, 그 밖의 메시지는 서버가 무시한다.
- **형식:** 모든 메시지가 같은 틀이다.

```json
{ "type": "qualifying.updated", "seq": 42, "ts": "2026-11-01T05:12:33.120Z", "data": {} }
```

| `type` | `data` | 보내는 때 |
|---|---|---|
| `snapshot` | `live_state`([`LiveState`](#livestate)), `leaderboard`([`Leaderboard`](#leaderboard)), `bracket`([`Bracket`](#bracket)) | 연결 직후 한 번 |
| `live_state.updated` | [`LiveState`](#livestate) | 진행 상태, 맵핑, 연습 조, 예선 출전 순서, 팀, 진행 중 매치가 바뀔 때 |
| `qualifying.updated` | [`Leaderboard`](#leaderboard) | 랩, 판정, 차량 검사, 예선 출전 순서, 팀이 바뀔 때 |
| `bracket.updated` | [`Bracket`](#bracket) | 대진, 시드, 결과, 진행 상태, 팀이 바뀔 때 |
| `content.updated` | `{"resource": …}` | 일정(`schedule`), 규칙(`rules`), 사이트 설정(`settings`), 팀(`teams`), 랭킹(`ranking`)이 바뀌거나 게시될 때. 내용 없이 알림만 보낸다 |
| `pong` | `{}` | `ping` 에 대한 답 |

- 변경분이 아니라 전체 값을 보낸다. 메시지 하나를 놓쳐도 다음 메시지로 복구된다.
- `seq` 는 방송할 때마다 1 올라간다. `snapshot` 과 `pong` 은 올리지 않고 지금 값을 담는다.
- 클라이언트는 받은 `seq` 이하의 메시지를 버린다. `snapshot` 은 항상 적용하고 그 값을 새 기준으로 삼는다(서버가 재시작하면 `seq` 가 0부터 다시 시작한다).
- 방송은 트랜잭션을 커밋한 뒤 응답을 보내고 나서 나간다. 커밋에 실패하면 방송하지 않는다. 전송마다 2초 제한이 있고, 실패한 연결은 정리한다.
- 메시지 형식의 원본은 [`backend/app/schemas/live.py`](../backend/app/schemas/live.py) 와 [`frontend/src/features/live/types.ts`](../frontend/src/features/live/types.ts) 다. OpenAPI 에 들어가지 않으므로 두 파일을 함께 고친다.

## 5. 데이터 형식

'필수'는 요청을 보낼 때의 뜻이다. 응답에는 모든 필드가 들어 있다. `PATCH` 요청은 보낸 필드만 바꾼다.

### 공통 형식

#### ErrorResponse

| 필드 | 형식 | 필수 | 설명 |
|---|---|---|---|
| `detail` | 문자열 | 예 |  |
| `code` | 문자열 | 예 |  |
| `errors` | [`FieldError`](#fielderror) 목록, null 가능 |  |  |

#### FieldError

| 필드 | 형식 | 필수 | 설명 |
|---|---|---|---|
| `loc` | 문자열 또는 정수 목록 | 예 |  |
| `msg` | 문자열 | 예 |  |

#### OrderUpdate

| 필드 | 형식 | 필수 | 설명 |
|---|---|---|---|
| `ids` | 정수 목록 | 예 | 전체 항목 id 를 원하는 순서대로 한 번씩 |

#### HealthStatus

| 필드 | 형식 | 필수 | 설명 |
|---|---|---|---|
| `status` | 문자열 | 예 |  |

### 인증·계정·변경 이력 형식

#### LoginRequest

| 필드 | 형식 | 필수 | 설명 |
|---|---|---|---|
| `username` | 문자열 | 예 | 1~64자 |
| `password` | 문자열 | 예 | 1~256자 |

#### UserOut

| 필드 | 형식 | 필수 | 설명 |
|---|---|---|---|
| `id` | 정수 | 예 |  |
| `username` | 문자열 | 예 |  |
| `role` | `admin` / `referee` | 예 |  |

#### UserAdmin

| 필드 | 형식 | 필수 | 설명 |
|---|---|---|---|
| `id` | 정수 | 예 |  |
| `username` | 문자열 | 예 |  |
| `role` | `admin` / `referee` | 예 |  |
| `is_active` | 참/거짓 | 예 |  |
| `created_at` | 시각 | 예 |  |
| `updated_at` | 시각 | 예 |  |

#### UserCreate

| 필드 | 형식 | 필수 | 설명 |
|---|---|---|---|
| `username` | 문자열 | 예 | `monitoring` 은 쓸 수 없다. `^[A-Za-z0-9_.-]{3,32}$` |
| `password` | 문자열 | 예 | 8~256자 |
| `role` | `admin` / `referee` | 예 |  |

#### UserUpdate

| 필드 | 형식 | 필수 | 설명 |
|---|---|---|---|
| `role` | `admin` / `referee` |  |  |
| `is_active` | 참/거짓 |  |  |
| `password` | 문자열 |  | 8~256자 |

#### AuditLogPage

| 필드 | 형식 | 필수 | 설명 |
|---|---|---|---|
| `items` | [`AuditLogOut`](#auditlogout) 목록 | 예 |  |
| `total` | 정수 | 예 |  |
| `limit` | 정수 | 예 |  |
| `offset` | 정수 | 예 |  |

#### AuditLogOut

| 필드 | 형식 | 필수 | 설명 |
|---|---|---|---|
| `id` | 정수 | 예 |  |
| `created_at` | 시각 | 예 |  |
| `user_id` | 정수, null 가능 | 예 | 서버 명령으로 바꿨으면 null |
| `username` | 문자열, null 가능 | 예 |  |
| `action` | 문자열 | 예 |  |
| `entity` | 문자열 | 예 |  |
| `entity_id` | 문자열 | 예 |  |
| `before` | 객체, null 가능 | 예 | 바꾸기 전 값 |
| `after` | 객체, null 가능 | 예 | 바꾼 뒤 값 |

### 사이트 설정·게시 형식

#### PublicSettings

| 필드 | 형식 | 필수 | 설명 |
|---|---|---|---|
| `apply_form_url` | 문자열, null 가능 | 예 |  |
| `apply_open_at` | 시각, null 가능 | 예 |  |
| `apply_close_at` | 시각, null 가능 | 예 |  |
| `apply_close_date_only` | 참/거짓 | 예 |  |
| `pages` | [`PageStates`](#pagestates) | 예 |  |
| `event_timezone` | 문자열 | 예 |  |

#### AdminSettings

| 필드 | 형식 | 필수 | 설명 |
|---|---|---|---|
| `apply_form_url` | 문자열, null 가능 | 예 |  |
| `apply_open_at` | 시각, null 가능 | 예 |  |
| `apply_close_at` | 시각, null 가능 | 예 |  |
| `apply_close_date_only` | 참/거짓 | 예 | 마감 시각이 미정이라 날짜만 보인다 |
| `monitor_key` | 문자열, null 가능 | 예 | 콘솔 비밀 값. 꺼져 있으면 null |
| `pages` | [`PageStates`](#pagestates) | 예 |  |

#### AdminSettingsUpdate

| 필드 | 형식 | 필수 | 설명 |
|---|---|---|---|
| `apply_form_url` | 문자열, null 가능 |  | `https://` 주소만. 2,000자 이하 |
| `apply_open_at` | 시각, null 가능 |  |  |
| `apply_close_at` | 시각, null 가능 |  |  |
| `apply_close_date_only` | 참/거짓 |  | 마감 시각이 미정이라 날짜만 보인다. 기본값 `false` |

#### MonitorKeyUpdate

| 필드 | 형식 | 필수 | 설명 |
|---|---|---|---|
| `key` | 문자열, null 가능 | 예 | 영문, 숫자, _ - 로 6~64자. null 이면 모니터링 관리 주소를 막는다. `^[A-Za-z0-9_-]{6,64}$` |

#### PageStates

| 필드 | 형식 | 필수 | 설명 |
|---|---|---|---|
| `schedule` | [`PageState`](#pagestate) | 예 |  |
| `rules` | [`PageState`](#pagestate) | 예 |  |
| `live` | [`PageState`](#pagestate) | 예 |  |

#### PageState

| 필드 | 형식 | 필수 | 설명 |
|---|---|---|---|
| `open` | 참/거짓 | 예 |  |
| `note_ko` | 문자열, null 가능 |  | 0~200자 |
| `note_en` | 문자열, null 가능 |  | 0~200자 |

#### PublishState

| 필드 | 형식 | 필수 | 설명 |
|---|---|---|---|
| `resource` | `schedule` / `rules` / `settings` | 예 | 일정 / 규칙 / 사이트 설정 |
| `pending` | 참/거짓 | 예 | 고쳤지만 아직 게시하지 않은 것이 있는지 |
| `published_at` | 시각, null 가능 | 예 |  |
| `published_by` | 문자열, null 가능 | 예 | 게시한 계정 (서버가 처음 만든 것이면 null) |

### 일정 형식

#### ScheduleItemPublic

| 필드 | 형식 | 필수 | 설명 |
|---|---|---|---|
| `id` | 정수 | 예 |  |
| `starts_at` | 시각 | 예 |  |
| `ends_at` | 시각, null 가능 | 예 |  |
| `title_ko` | 문자열 | 예 |  |
| `title_en` | 문자열 | 예 |  |
| `location_ko` | 문자열, null 가능 | 예 |  |
| `location_en` | 문자열, null 가능 | 예 |  |
| `description_ko` | 문자열, null 가능 | 예 |  |
| `description_en` | 문자열, null 가능 | 예 |  |
| `sort_order` | 정수 | 예 |  |
| `updated_at` | 시각 | 예 |  |

#### ScheduleItemAdmin

| 필드 | 형식 | 필수 | 설명 |
|---|---|---|---|
| `id` | 정수 | 예 |  |
| `starts_at` | 시각 | 예 |  |
| `ends_at` | 시각, null 가능 | 예 |  |
| `title_ko` | 문자열 | 예 |  |
| `title_en` | 문자열 | 예 |  |
| `location_ko` | 문자열, null 가능 | 예 |  |
| `location_en` | 문자열, null 가능 | 예 |  |
| `description_ko` | 문자열, null 가능 | 예 |  |
| `description_en` | 문자열, null 가능 | 예 |  |
| `sort_order` | 정수 | 예 |  |
| `updated_at` | 시각 | 예 |  |
| `is_published` | 참/거짓 | 예 |  |
| `version` | 정수 | 예 |  |
| `created_at` | 시각 | 예 |  |

#### ScheduleItemCreate

| 필드 | 형식 | 필수 | 설명 |
|---|---|---|---|
| `starts_at` | 시각 | 예 |  |
| `ends_at` | 시각, null 가능 |  | `starts_at` 보다 뒤 |
| `title_ko` | 문자열 | 예 | 1~200자 |
| `title_en` | 문자열 |  | 0~200자 |
| `location_ko` | 문자열, null 가능 |  | 0~200자 |
| `location_en` | 문자열, null 가능 |  | 0~200자 |
| `description_ko` | 문자열, null 가능 |  | 0~5,000자 |
| `description_en` | 문자열, null 가능 |  | 0~5,000자 |
| `sort_order` | 정수, null 가능 |  | 생략하면 맨 뒤 |
| `is_published` | 참/거짓 |  | 기본값 `true` |

#### ScheduleItemUpdate

| 필드 | 형식 | 필수 | 설명 |
|---|---|---|---|
| `version` | 정수 | 예 |  |
| `starts_at` | 시각 |  |  |
| `ends_at` | 시각, null 가능 |  | `starts_at` 보다 뒤 |
| `title_ko` | 문자열 |  | 1~200자 |
| `title_en` | 문자열 |  | 0~200자 |
| `location_ko` | 문자열, null 가능 |  | 0~200자 |
| `location_en` | 문자열, null 가능 |  | 0~200자 |
| `description_ko` | 문자열, null 가능 |  | 0~5,000자 |
| `description_en` | 문자열, null 가능 |  | 0~5,000자 |
| `sort_order` | 정수 |  |  |
| `is_published` | 참/거짓 |  |  |

#### ScheduleDocument

| 필드 | 형식 | 필수 | 설명 |
|---|---|---|---|
| `filename` | 문자열 | 예 |  |
| `markdown` | 문자열 | 예 |  |

#### ScheduleDocumentImport

| 필드 | 형식 | 필수 | 설명 |
|---|---|---|---|
| `markdown` | 문자열 | 예 | '## 2026-11-01' 날짜 줄 아래 '### 09:00-10:00 제목' 으로 일정을 쓴 문서. 0~100,000자 |

#### ScheduleImportResult

| 필드 | 형식 | 필수 | 설명 |
|---|---|---|---|
| `created` | 정수 | 예 | 새로 만든 일정 수 |
| `deleted` | 정수 | 예 | 지운 일정 수 |
| `items` | [`ScheduleItemAdmin`](#scheduleitemadmin) 목록 | 예 |  |

### 규칙 형식

#### RuleSectionPublic

| 필드 | 형식 | 필수 | 설명 |
|---|---|---|---|
| `id` | 정수 | 예 |  |
| `title_ko` | 문자열 | 예 |  |
| `title_en` | 문자열 | 예 |  |
| `body_ko` | 문자열 | 예 |  |
| `body_en` | 문자열 | 예 |  |
| `sort_order` | 정수 | 예 |  |
| `level` | `1` / `2` |  | 1 = 장, 2 = 절. 기본값 `2` |
| `updated_at` | 시각 | 예 |  |

#### RuleSectionAdmin

| 필드 | 형식 | 필수 | 설명 |
|---|---|---|---|
| `id` | 정수 | 예 |  |
| `title_ko` | 문자열 | 예 |  |
| `title_en` | 문자열 | 예 |  |
| `body_ko` | 문자열 | 예 |  |
| `body_en` | 문자열 | 예 |  |
| `sort_order` | 정수 | 예 |  |
| `level` | `1` / `2` |  | 1 = 장, 2 = 절. 기본값 `2` |
| `updated_at` | 시각 | 예 |  |
| `is_published` | 참/거짓 | 예 |  |
| `version` | 정수 | 예 |  |
| `created_at` | 시각 | 예 |  |

#### RuleSectionCreate

| 필드 | 형식 | 필수 | 설명 |
|---|---|---|---|
| `title_ko` | 문자열 | 예 | 1~200자 |
| `title_en` | 문자열 |  | 0~200자 |
| `body_ko` | 문자열 |  | `#`·`##` 제목 줄은 쓸 수 없다 (소제목은 `###`). 0~100,000자 |
| `body_en` | 문자열 |  | 0~100,000자 |
| `sort_order` | 정수, null 가능 |  | 생략하면 맨 뒤 |
| `is_published` | 참/거짓 |  | 기본값 `true` |
| `level` | `1` / `2` |  | 1 = 장, 2 = 절. 기본값 `2` |

#### RuleSectionUpdate

| 필드 | 형식 | 필수 | 설명 |
|---|---|---|---|
| `version` | 정수 | 예 |  |
| `title_ko` | 문자열 |  | 1~200자 |
| `title_en` | 문자열 |  | 0~200자 |
| `body_ko` | 문자열 |  | `#`·`##` 제목 줄은 쓸 수 없다 (소제목은 `###`). 0~100,000자 |
| `body_en` | 문자열 |  | 0~100,000자 |
| `sort_order` | 정수 |  |  |
| `is_published` | 참/거짓 |  |  |
| `level` | `1` / `2` |  | 1 = 장, 2 = 절 |

#### RulesDocument

| 필드 | 형식 | 필수 | 설명 |
|---|---|---|---|
| `lang` | `ko` / `en` | 예 |  |
| `filename` | 문자열 | 예 | 서버의 파일 이름 (rules.ko.md, rules.en.md) |
| `markdown` | 문자열 | 예 |  |

#### RulesDocumentImport

| 필드 | 형식 | 필수 | 설명 |
|---|---|---|---|
| `lang` | `ko` / `en` | 예 |  |
| `markdown` | 문자열 | 예 | `#` 은 장, `##` 는 절을 시작한다. 비공개 섹션은 제목 바로 아래에 `<!-- hidden -->` (한국어 문서만) |

#### RulesImportResult

| 필드 | 형식 | 필수 | 설명 |
|---|---|---|---|
| `lang` | `ko` / `en` | 예 |  |
| `created` | 정수 | 예 | 새로 만든 섹션 수 |
| `updated` | 정수 | 예 | 고친 섹션 수 |
| `deleted` | 정수 | 예 | 지운 섹션 수 |
| `sections` | [`RuleSectionAdmin`](#rulesectionadmin) 목록 | 예 |  |
| `assets` | 정수 | 예 | 올린 문서가 쓰는 그림 수 |
| `warnings` | 문자열 목록 | 예 | 적용은 했지만 확인할 것: 찾지 못한 그림 주소, 넣지 않은 파일 등 |

### 팀·랭킹·시상 형식

#### TeamPublic

| 필드 | 형식 | 필수 | 설명 |
|---|---|---|---|
| `id` | 정수 | 예 |  |
| `name_ko` | 문자열 | 예 |  |
| `name_en` | 문자열 | 예 |  |
| `affiliation_ko` | 문자열, null 가능 | 예 |  |
| `affiliation_en` | 문자열, null 가능 | 예 |  |

#### TeamAdmin

| 필드 | 형식 | 필수 | 설명 |
|---|---|---|---|
| `id` | 정수 | 예 |  |
| `name_ko` | 문자열 | 예 |  |
| `name_en` | 문자열 | 예 |  |
| `affiliation_ko` | 문자열, null 가능 | 예 |  |
| `affiliation_en` | 문자열, null 가능 | 예 |  |
| `is_active` | 참/거짓 | 예 |  |
| `version` | 정수 | 예 |  |
| `created_at` | 시각 | 예 |  |
| `updated_at` | 시각 | 예 |  |

#### TeamCreate

| 필드 | 형식 | 필수 | 설명 |
|---|---|---|---|
| `name_ko` | 문자열 | 예 | 대소문자 무시하고 겹칠 수 없다. 1~200자 |
| `name_en` | 문자열 |  | 0~200자 |
| `affiliation_ko` | 문자열, null 가능 |  | 0~200자 |
| `affiliation_en` | 문자열, null 가능 |  | 0~200자 |
| `is_active` | 참/거짓 |  | 기본값 `true` |

#### TeamUpdate

| 필드 | 형식 | 필수 | 설명 |
|---|---|---|---|
| `version` | 정수 | 예 |  |
| `name_ko` | 문자열 |  | 1~200자 |
| `name_en` | 문자열 |  | 0~200자 |
| `affiliation_ko` | 문자열, null 가능 |  | 0~200자 |
| `affiliation_en` | 문자열, null 가능 |  | 0~200자 |
| `is_active` | 참/거짓 |  | 끄면 기권 처리 |

#### Ranking

| 필드 | 형식 | 필수 | 설명 |
|---|---|---|---|
| `entries` | [`RankingEntry`](#rankingentry) 목록 | 예 |  |
| `updated_at` | 시각, null 가능 | 예 | 마지막으로 저장한 때 (없으면 null) |

#### RankingEntry

| 필드 | 형식 | 필수 | 설명 |
|---|---|---|---|
| `rank` | 정수 | 예 |  |
| `team` | [`TeamPublic`](#teampublic) | 예 |  |

#### RankingUpdate

| 필드 | 형식 | 필수 | 설명 |
|---|---|---|---|
| `team_ids` | 정수 목록 | 예 | 1위부터 차례로 팀 ID. 빠진 팀은 순위 없음으로 둔다 |

#### Results

| 필드 | 형식 | 필수 | 설명 |
|---|---|---|---|
| `entries` | [`ResultEntry`](#resultentry) 목록 | 예 | 대상 → 최우수상 → 우수상 순. 받은 팀이 없는 상은 빠지고, 아직 없으면 빈 목록 |

#### ResultEntry

| 필드 | 형식 | 필수 | 설명 |
|---|---|---|---|
| `award` | `grand` / `excellence` / `merit` | 예 | 대상 / 최우수상 / 우수상 |
| `teams` | [`TeamPublic`](#teampublic) 목록 | 예 | 이 상을 받은 팀 (적은 순서대로) |

### 예선 형식

#### Leaderboard

| 필드 | 형식 | 필수 | 설명 |
|---|---|---|---|
| `scoring` | 문자열 | 예 | 계산 방식. 지금은 `rules` |
| `rows` | [`LeaderboardRow`](#leaderboardrow) 목록 | 예 |  |

#### LeaderboardRow

| 필드 | 형식 | 필수 | 설명 |
|---|---|---|---|
| `rank` | 정수, null 가능 | 예 | 아직 기록이 없는 팀은 null |
| `team` | [`TeamPublic`](#teampublic) | 예 |  |
| `inspection_order` | 정수, null 가능 |  | 관리자가 직접 적은 검차 완료 순서. 없으면 null |
| `run_order` | 정수, null 가능 |  | 예선 출전 순서 (동결한 맵핑 순서, 1부터). 정하기 전이면 null |
| `fa` | 참/거짓 | 예 | Q1·Q2·Q3 을 모두 통과했고 FA 달성 불가 판정이 없다 |
| `fa_lost` | 참/거짓 | 예 | FA 달성 불가 판정을 받았다 |
| `missions_passed` | 정수 | 예 | 통과한 미션 수. 0~3 |
| `current_mission` | `Q1` / `Q2` / `Q3` | 예 | 지금 기록을 쌓는 미션 (모두 통과했으면 Q3) |
| `current_streak` | 정수 | 예 | 지금 미션의 끝에서부터 이어지는 유효 랩 수 |
| `q1_laps` | 정수, null 가능 | 예 | Q1 최대 연속 유효 랩 (최대 3). 기록이 없으면 null |
| `q2_laps` | 정수, null 가능 | 예 | Q2 최대 연속 유효 랩. Q1 을 통과하지 못했으면 null |
| `q3_best_ms` | 정수, null 가능 | 예 | Q3 최고 유효 랩타임 |
| `rank_drops` | 정수 | 예 | 받은 강등 판정 수 |
| `attempts` | 정수 | 예 | 입력 취소를 뺀 랩 수 |
| `last_recorded_at` | 시각, null 가능 | 예 |  |

#### QualifyingLapAdmin

| 필드 | 형식 | 필수 | 설명 |
|---|---|---|---|
| `id` | 정수 | 예 |  |
| `team_id` | 정수 | 예 |  |
| `team` | [`TeamPublic`](#teampublic) | 예 |  |
| `attempt_no` | 정수 | 예 | 팀별로 1부터 늘어나는 번호 |
| `mission` | `Q1` / `Q2` / `Q3` | 예 |  |
| `lap_time_ms` | 정수, null 가능 | 예 |  |
| `status` | `valid` / `invalid` / `void` | 예 | 유효 / 무효 / 입력 취소 |
| `void_reason` | 문자열, null 가능 | 예 | 입력을 취소한 사유 |
| `recorded_at` | 시각 | 예 |  |
| `recorded_by_username` | 문자열, null 가능 | 예 |  |
| `version` | 정수 | 예 |  |
| `updated_at` | 시각 | 예 |  |

#### QualifyingLapCreate

| 필드 | 형식 | 필수 | 설명 |
|---|---|---|---|
| `team_id` | 정수 | 예 |  |
| `mission` | `Q1` / `Q2` / `Q3`, null 가능 |  | 비우면 서버가 그 팀이 지금 하는 미션으로 정한다 (연속 3랩이면 다음 미션) |
| `status` | `valid` / `invalid` | 예 |  |
| `lap_time_ms` | 정수, null 가능 |  | Q3 의 유효 랩은 꼭 필요. 1,000~600,000, 10 단위 |

#### QualifyingLapUpdate

| 필드 | 형식 | 필수 | 설명 |
|---|---|---|---|
| `version` | 정수 | 예 |  |
| `mission` | `Q1` / `Q2` / `Q3` |  |  |
| `status` | `valid` / `invalid` |  |  |
| `lap_time_ms` | 정수, null 가능 |  | 1,000~600,000, 10 단위 |

#### QualifyingLapVoid

| 필드 | 형식 | 필수 | 설명 |
|---|---|---|---|
| `reason` | 문자열 | 예 | 1~500자 |
| `version` | 정수, null 가능 |  | 보내면 낙관적 잠금을 검사한다 |

#### QualifyingEventAdmin

| 필드 | 형식 | 필수 | 설명 |
|---|---|---|---|
| `id` | 정수 | 예 |  |
| `team_id` | 정수 | 예 |  |
| `team` | [`TeamPublic`](#teampublic) | 예 |  |
| `kind` | `fa_lost` / `rank_drop` | 예 | FA 달성 불가 / 최종 예선 순위 1단계 강등 |
| `reason` | 문자열 | 예 |  |
| `recorded_at` | 시각 | 예 |  |
| `recorded_by_username` | 문자열, null 가능 | 예 |  |

#### QualifyingEventCreate

| 필드 | 형식 | 필수 | 설명 |
|---|---|---|---|
| `team_id` | 정수 | 예 |  |
| `kind` | `fa_lost` / `rank_drop` | 예 | FA 달성 불가 / 최종 예선 순위 1단계 강등 |
| `reason` | 문자열 | 예 | 1~200자 |

#### QualifyingOrderUpdate

| 필드 | 형식 | 필수 | 설명 |
|---|---|---|---|
| `team_ids` | 정수 목록 | 예 | 예선 출전 순서대로 참가 중인 팀 ID 를 모두 |

#### InspectionEntry

| 필드 | 형식 | 필수 | 설명 |
|---|---|---|---|
| `team` | [`TeamPublic`](#teampublic) | 예 |  |
| `inspected_at` | 시각, null 가능 | 예 |  |
| `inspection_order` | 정수, null 가능 |  | 관리자가 직접 적은 검차 완료 순서. 없으면 null |
| `order` | 정수, null 가능 | 예 | 검사를 마친 순서 (1부터). 직접 적은 순서, 없으면 검사 시각 순. 아직이면 null |

#### InspectionUpdate

| 필드 | 형식 | 필수 | 설명 |
|---|---|---|---|
| `done` | 참/거짓 | 예 | true 면 지금 시각으로 검사 완료, false 면 취소 |

#### InspectionOrderUpdate

| 필드 | 형식 | 필수 | 설명 |
|---|---|---|---|
| `items` | [`InspectionOrderItem`](#inspectionorderitem) 목록 | 예 | 고칠 팀만 보내도 된다 |

#### InspectionOrderItem

| 필드 | 형식 | 필수 | 설명 |
|---|---|---|---|
| `team_id` | 정수 | 예 |  |
| `order` | 정수, null 가능 | 예 | 검차 완료 순서. null 이면 지운다. 1~15 |

### 본선 대진 형식

#### Bracket

| 필드 | 형식 | 필수 | 설명 |
|---|---|---|---|
| `rounds` | [`BracketRound`](#bracketround) 목록 | 예 |  |

#### BracketRound

| 필드 | 형식 | 필수 | 설명 |
|---|---|---|---|
| `id` | 정수 | 예 |  |
| `name_ko` | 문자열 | 예 |  |
| `name_en` | 문자열 | 예 |  |
| `sort_order` | 정수 | 예 |  |
| `matches` | [`BracketMatch`](#bracketmatch) 목록 | 예 |  |

#### BracketMatch

| 필드 | 형식 | 필수 | 설명 |
|---|---|---|---|
| `id` | 정수 | 예 |  |
| `round_id` | 정수 | 예 |  |
| `label` | 문자열 | 예 | 화면에 보이는 경기 이름. 대회 안에서 유일하다 |
| `sort_order` | 정수 | 예 |  |
| `status` | `scheduled` / `live` / `finished` | 예 |  |
| `scheduled_at` | 시각, null 가능 | 예 |  |
| `version` | 정수 | 예 | 칸이 바뀌어도 올라간다 |
| `slots` | [`BracketSlot`](#bracketslot) 목록 | 예 |  |

#### BracketSlot

| 필드 | 형식 | 필수 | 설명 |
|---|---|---|---|
| `id` | 정수 | 예 |  |
| `slot_index` | 정수 | 예 |  |
| `team` | [`TeamPublic`](#teampublic), null 가능 | 예 | 이 칸의 팀. 아직 정해지지 않았으면 null |
| `seed_rank` | 정수, null 가능 | 예 | 랭킹 N위로 채우는 칸. 화면에는 '예선 N위' |
| `source_match_id` | 정수, null 가능 | 예 | 앞 매치 결과로 채우는 칸의 앞 매치 |
| `source_match_label` | 문자열, null 가능 | 예 |  |
| `source_rank` | 정수, null 가능 | 예 | 앞 매치에서 몇 위를 받은 팀인지. 두 팀 경기는 1 = 승, 2 = 패 |
| `placeholder_ko` | 문자열, null 가능 | 예 | 팀이 없을 때 보일 글 |
| `placeholder_en` | 문자열, null 가능 | 예 |  |
| `result_rank` | 정수, null 가능 | 예 | 이 매치의 순위. 부전승 빈 칸은 null |
| `result_text` | 문자열, null 가능 | 예 | 결과 메모 |

#### BracketRoundAdmin

| 필드 | 형식 | 필수 | 설명 |
|---|---|---|---|
| `id` | 정수 | 예 |  |
| `name_ko` | 문자열 | 예 |  |
| `name_en` | 문자열 | 예 |  |
| `sort_order` | 정수 | 예 |  |
| `created_at` | 시각 | 예 |  |
| `updated_at` | 시각 | 예 |  |

#### BracketRoundCreate

| 필드 | 형식 | 필수 | 설명 |
|---|---|---|---|
| `name_ko` | 문자열 | 예 | 1~200자 |
| `name_en` | 문자열 |  | 0~200자 |
| `sort_order` | 정수, null 가능 |  | 생략하면 맨 뒤 |

#### BracketRoundUpdate

| 필드 | 형식 | 필수 | 설명 |
|---|---|---|---|
| `name_ko` | 문자열 |  | 1~200자 |
| `name_en` | 문자열 |  | 0~200자 |
| `sort_order` | 정수 |  |  |

#### BracketMatchCreate

| 필드 | 형식 | 필수 | 설명 |
|---|---|---|---|
| `round_id` | 정수 | 예 |  |
| `label` | 문자열 | 예 | 1~20자 |
| `sort_order` | 정수, null 가능 |  | 생략하면 라운드의 맨 뒤 |
| `scheduled_at` | 시각, null 가능 |  |  |
| `slot_count` | 정수 |  | 칸 수. 1~16. 기본값 `2` |

#### BracketMatchUpdate

| 필드 | 형식 | 필수 | 설명 |
|---|---|---|---|
| `version` | 정수 | 예 |  |
| `label` | 문자열 |  | 1~20자 |
| `round_id` | 정수 |  |  |
| `sort_order` | 정수 |  |  |
| `scheduled_at` | 시각, null 가능 |  |  |
| `status` | `scheduled` / `live` |  | 종료는 결과 입력으로만 한다 |
| `slot_count` | 정수 |  | 칸 수. 1~16 |

#### BracketSlotUpdate

| 필드 | 형식 | 필수 | 설명 |
|---|---|---|---|
| `team_id` | 정수, null 가능 |  |  |
| `seed_rank` | 정수, null 가능 |  | `source_match_id` 와 함께 쓸 수 없다 |
| `source_match_id` | 정수, null 가능 |  |  |
| `source_rank` | 정수, null 가능 |  | `source_match_id` 와 함께 보낸다 |
| `placeholder_ko` | 문자열, null 가능 |  | 0~200자 |
| `placeholder_en` | 문자열, null 가능 |  | 0~200자 |

#### BracketSlotSwap

| 필드 | 형식 | 필수 | 설명 |
|---|---|---|---|
| `slot_id` | 정수 | 예 |  |
| `target_slot_id` | 정수 | 예 |  |
| `version` | 정수 | 예 | slot_id 칸이 속한 매치의 version |
| `target_version` | 정수 | 예 | target_slot_id 칸이 속한 매치의 version |

#### BracketGenerate

| 필드 | 형식 | 필수 | 설명 |
|---|---|---|---|
| `format` | 문자열 |  | 지금은 `single_elimination` 만. 기본값 `single_elimination` |
| `size` | `2` / `4` / `8` / `16` | 예 |  |
| `third_place` | 참/거짓 |  | 3·4위전 추가. 기본값 `false` |

#### MatchResultSubmit

| 필드 | 형식 | 필수 | 설명 |
|---|---|---|---|
| `version` | 정수 | 예 |  |
| `results` | [`SlotResultInput`](#slotresultinput) 목록 | 예 |  |

#### SlotResultInput

| 필드 | 형식 | 필수 | 설명 |
|---|---|---|---|
| `slot_id` | 정수 | 예 |  |
| `result_rank` | 정수 | 예 | 1부터 빠짐없이 |
| `result_text` | 문자열, null 가능 |  | 0~200자 |

#### MatchReopen

| 필드 | 형식 | 필수 | 설명 |
|---|---|---|---|
| `version` | 정수, null 가능 |  | 보내면 낙관적 잠금을 검사한다 |

### 진행 상태 형식

#### LiveState

| 필드 | 형식 | 필수 | 설명 |
|---|---|---|---|
| `phase` | `idle` / `mapping` / `practice` / `free_practice` / `qualifying` / `bracket` / `break` / `finished` | 예 | 대기 / 맵핑 / 그룹 연습 / 자유 연습 / 예선 / 본선 / 휴식 / 종료 |
| `on_track_team` | [`TeamPublic`](#teampublic), null 가능 | 예 |  |
| `current_match` | [`LiveMatchRef`](#livematchref), null 가능 | 예 |  |
| `message_ko` | 문자열, null 가능 | 예 | 운영 공지 |
| `message_en` | 문자열, null 가능 | 예 |  |
| `updated_at` | 시각 | 예 |  |
| `mapping` | [`MappingEntry`](#mappingentry) 목록 |  | 맵핑 순서. 아직 섞지 않았으면 빈 목록 |
| `mapping_frozen` | 참/거짓 |  | 맵핑 순서를 동결해 예선 순서로 쓰는 중 (더는 바꿀 수 없다). 기본값 `false` |
| `bracket_frozen` | 참/거짓 |  | 본선 결과를 동결함 (대진·결과를 더는 바꿀 수 없다). 기본값 `false` |
| `practice` | [`PracticeGroup`](#practicegroup) 목록 |  | 그룹 연습 조 |

#### LiveStateUpdate

| 필드 | 형식 | 필수 | 설명 |
|---|---|---|---|
| `phase` | `idle` / `mapping` / `practice` / `free_practice` / `qualifying` / `bracket` / `break` / `finished` | 예 |  |
| `on_track_team_id` | 정수, null 가능 |  |  |
| `current_match_id` | 정수, null 가능 |  |  |
| `message_ko` | 문자열, null 가능 |  | 0~500자 |
| `message_en` | 문자열, null 가능 |  | 0~500자 |

#### LiveMatchRef

| 필드 | 형식 | 필수 | 설명 |
|---|---|---|---|
| `id` | 정수 | 예 |  |
| `label` | 문자열 | 예 |  |

#### MappingEntry

| 필드 | 형식 | 필수 | 설명 |
|---|---|---|---|
| `order` | 정수 | 예 | 맵핑 순서 (1부터) |
| `team` | [`TeamPublic`](#teampublic) | 예 |  |
| `mapped_at` | 시각, null 가능 | 예 | 맵핑을 마친 시각. 아직이면 null |

#### MappingUpdate

| 필드 | 형식 | 필수 | 설명 |
|---|---|---|---|
| `done` | 참/거짓 | 예 | true 면 지금 시각으로 맵핑 완료, false 면 취소 |

#### PracticeGroup

| 필드 | 형식 | 필수 | 설명 |
|---|---|---|---|
| `name` | `A` / `B` / `C` | 예 |  |
| `capacity` | 정수 | 예 | 이 조에 들어갈 수 있는 팀 수 |
| `starts_at` | 시각 | 예 | 이 조의 연습 시작 시각 |
| `ends_at` | 시각 | 예 | 이 조의 연습 끝 시각 |
| `teams` | [`PracticeMember`](#practicemember) 목록 | 예 | 고른 순서대로 |

#### PracticeMember

| 필드 | 형식 | 필수 | 설명 |
|---|---|---|---|
| `team` | [`TeamPublic`](#teampublic) | 예 |  |
| `chosen_at` | 시각, null 가능 | 예 | 조를 고른 시각 |

#### PracticeUpdate

| 필드 | 형식 | 필수 | 설명 |
|---|---|---|---|
| `group` | `A` / `B` / `C`, null 가능 | 예 | 고른 조. null 이면 빼기 |

#### MonitorAccess

| 필드 | 형식 | 필수 | 설명 |
|---|---|---|---|
| `via` | `key` / `session` | 예 | key: 모니터링 관리 주소, session: 로그인 |
| `username` | 문자열 | 예 |  |
