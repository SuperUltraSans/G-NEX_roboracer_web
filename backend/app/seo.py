"""검색엔진용 HTML.

공개 화면은 브라우저가 그리므로(index.html 의 #root 는 비어 있다) 검색엔진이
자바스크립트를 돌리지 않으면 내용을 읽지 못한다. 그래서 index.html 을 내줄 때 페이지마다
제목·설명·대표 그림(OG)·구조화 데이터를 넣고, #root 안에 게시한 내용으로 만든 읽을거리를
미리 넣는다. 화면이 그려지면 React 가 이 내용을 바꿔 그린다.

문구는 프론트 ko.json 의 home·apply 문구와 같다. 대회 정보가 바뀌면 함께 고친다.
"""

import json
import re
from dataclasses import dataclass
from datetime import datetime
from html import escape
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy.orm import Session

from app.config import Settings
from app.models import PublishedContent
from app.services.publishing import published
from app.services.results import build_results

SITE_NAME = "2026 RoboRacer G-NEX CHAMPIONSHIP"
HOST = "인제대학교 앵커사업단"
VENUE = "창원컨벤션센터(CECO)"
VENUE_ADDRESS = "경상남도 창원시 의창구 원이대로 362"
START, END = "2026-11-01", "2026-11-02"
DATE_TEXT = "2026년 11월 1일(일) ~ 11월 2일(월)"
INTRO = (
    "인제대학교 앵커사업단 자율주행 자동차 경진대회입니다. "
    "1/10 자율주행 대회 규격에 맞는 차량 플랫폼을 가진 대학팀이 참가합니다."
)
OG_IMAGE = "hero/hero-1280.jpg"
WEEKDAYS = "월화수목금토일"


@dataclass(frozen=True)
class Page:
    title: str
    description: str


PAGES: dict[str, Page] = {
    "": Page(
        f"{SITE_NAME} | 자율주행 레이싱 대회",
        f"{HOST}이 주최하는 1/10 자율주행 자동차 경진대회. {DATE_TEXT}, {VENUE}. "
        "대학팀 참가 신청, 대회 일정과 규칙, 예선·본선 실시간 기록을 한곳에서 확인하세요.",
    ),
    "schedule": Page(
        f"일정 | {SITE_NAME}",
        f"{SITE_NAME} 대회 일정. {DATE_TEXT}, {VENUE}에서 열리는 예선과 본선 토너먼트 일정.",
    ),
    "rules": Page(
        f"대회 규칙 | {SITE_NAME}",
        f"{SITE_NAME} 대회 규칙. 차량 규격, 예선과 본선 토너먼트 방식, 안전 수칙.",
    ),
    "apply": Page(
        f"대회 신청 | {SITE_NAME}",
        f"{SITE_NAME} 참가 신청. 1/10 자율주행 대회 규격 차량 플랫폼을 보유한 5인 이하 대학팀이 "
        "네이버 폼으로 신청합니다.",
    ),
    "live": Page(
        f"대회 모니터링 | {SITE_NAME}",
        f"{SITE_NAME} 실시간 기록. 예선 리더보드와 본선 대진을 대회 중 실시간으로 확인하세요.",
    ),
    "results": Page(
        f"대회 결과 | {SITE_NAME}",
        f"{SITE_NAME} 결과. 대상·최우수상·우수상 수상 팀.",
    ),
}
NAV = [
    ("", "소개"),
    ("schedule", "일정"),
    ("rules", "규칙"),
    ("apply", "신청"),
    ("live", "모니터링"),
    ("results", "결과"),
]
# 화면은 있지만 검색에 내지 않는 곳
PRIVATE = ("admin", "monitoring-admin")


def page_for(path: str) -> tuple[str | None, bool]:
    """(공개 페이지 키 또는 None, 앱이 아는 주소인지)."""
    path = path.strip("/")
    if path in PAGES:
        return path, True
    first = path.split("/", 1)[0]
    return None, first in PRIVATE


def base_path(index_html: str) -> str:
    """빌드된 index.html 의 자산 주소에서 배포 경로(/roboracer/ 등)를 알아낸다."""
    match = re.search(r'(?:src|href)="([^"]*?)assets/', index_html)
    return match.group(1) if match else "/"


def render(index_html: str, path: str, db: Session, settings: Settings) -> tuple[str, int]:
    """index.html 에 검색엔진용 머리말과 본문을 넣는다. 모르는 주소는 404 상태로 낸다."""
    key, known = page_for(path)
    base = base_path(index_html)
    if key is None:
        # 관리자 화면·모니터링 관리는 검색에서 빼고, 없는 주소는 404 로 알린다(화면은 앱이 그린다)
        head = '<meta name="robots" content="noindex" />'
        title = SITE_NAME if known else f"페이지를 찾을 수 없습니다 | {SITE_NAME}"
        return _inject(index_html, title, head, ""), 200 if known else 404

    page = PAGES[key]
    url = f"{settings.public_url}{key}" if settings.public_url else None
    head = _head(page, url, settings, with_event=key == "")
    body = _body(key, base, db, settings)
    return _inject(index_html, page.title, head, body), 200


def _inject(index_html: str, title: str, head: str, body: str) -> str:
    html = re.sub(r"<title>.*?</title>", f"<title>{escape(title)}</title>", index_html, count=1)
    html = html.replace("</head>", f"{head}\n  </head>", 1)
    return html.replace('<div id="root"></div>', f'<div id="root">{body}</div>', 1)


def _meta(name: str, content: str, attr: str = "name") -> str:
    return f'<meta {attr}="{name}" content="{escape(content)}" />'


def _head(page: Page, url: str | None, settings: Settings, with_event: bool) -> str:
    tags = [
        _meta("description", page.description),
        _meta("og:type", "website", "property"),
        _meta("og:site_name", SITE_NAME, "property"),
        _meta("og:locale", "ko_KR", "property"),
        _meta("og:title", page.title, "property"),
        _meta("og:description", page.description, "property"),
        _meta("twitter:card", "summary_large_image"),
    ]
    if url and settings.public_url:
        image = f"{settings.public_url}{OG_IMAGE}"
        tags += [
            f'<link rel="canonical" href="{escape(url)}" />',
            _meta("og:url", url, "property"),
            _meta("og:image", image, "property"),
            _meta("og:image:width", "1280", "property"),
            _meta("og:image:height", "720", "property"),
        ]
    if settings.google_site_verification:
        tags.append(_meta("google-site-verification", settings.google_site_verification))
    if settings.naver_site_verification:
        tags.append(_meta("naver-site-verification", settings.naver_site_verification))
    if with_event:
        tags.append(_event_json(settings))
    return "\n    ".join(tags)


def _event_json(settings: Settings) -> str:
    """구글 검색의 행사 정보(날짜·장소)용 구조화 데이터"""
    event: dict[str, Any] = {
        "@context": "https://schema.org",
        "@type": "Event",
        "name": SITE_NAME,
        "description": INTRO,
        "startDate": START,
        "endDate": END,
        "eventStatus": "https://schema.org/EventScheduled",
        "eventAttendanceMode": "https://schema.org/OfflineEventAttendanceMode",
        "location": {
            "@type": "Place",
            "name": VENUE,
            "address": {
                "@type": "PostalAddress",
                "streetAddress": VENUE_ADDRESS,
                "addressLocality": "창원시",
                "addressRegion": "경상남도",
                "addressCountry": "KR",
            },
        },
        "organizer": {"@type": "Organization", "name": HOST},
    }
    if settings.public_url:
        event["url"] = settings.public_url
        event["image"] = [f"{settings.public_url}{OG_IMAGE}"]
    # </script> 로 끝나지 않게 < 를 이스케이프한다
    data = json.dumps(event, ensure_ascii=False).replace("<", "\\u003c")
    return f'<script type="application/ld+json">{data}</script>'


# ---- 본문 (화면이 그려지기 전, 또는 자바스크립트를 돌리지 않는 검색엔진이 읽는 내용) ----


def _body(key: str, base: str, db: Session, settings: Settings) -> str:
    nav = "".join(
        f'<li><a href="{escape(base + path)}">{escape(label)}</a></li>' for path, label in NAV
    )
    content = {
        "": _home,
        "schedule": _schedule,
        "rules": _rules,
        "apply": _apply,
        "live": _live,
        "results": _results,
    }[key](db, settings)
    return (
        f'<div class="prerender" data-page="{key or "home"}">'
        f'<nav aria-label="주 메뉴"><a href="{escape(base)}">G-NEX</a><ul>{nav}</ul></nav>'
        f"<main>{content}</main></div>"
    )


def _facts() -> str:
    return (
        f"<dl><dt>일시</dt><dd>{escape(DATE_TEXT)}</dd>"
        f"<dt>장소</dt><dd>{escape(VENUE)}</dd>"
        f"<dt>주최·주관</dt><dd>{escape(HOST)}</dd></dl>"
    )


def _home(db: Session, settings: Settings) -> str:
    return f"<h1>{escape(SITE_NAME)}</h1>{_facts()}<h2>대회 소개</h2><p>{escape(INTRO)}</p>"


def _closed(page: str, db: Session) -> str | None:
    """게시한 설정에서 그 페이지가 닫혀 있으면 안내 문구"""
    state = published(db, "settings").get("pages", {}).get(page, {})
    if state.get("open", True):
        return None
    return state.get("note_ko") or "준비 중입니다. 정해지면 이 페이지에 공개합니다."


def _when(value: str, settings: Settings) -> datetime:
    return datetime.fromisoformat(value).astimezone(ZoneInfo(settings.event_timezone))


def _day(moment: datetime) -> str:
    return f"{moment.month}월 {moment.day}일 ({WEEKDAYS[moment.weekday()]})"


SCHEDULE_NOTICE = "대회 일정은 G-NEX 행사 일정에 따라 변경될 수 있습니다."


def _schedule(db: Session, settings: Settings) -> str:
    out = f"<h1>일정</h1><p><strong>{escape(SCHEDULE_NOTICE)}</strong></p>"
    note = _closed("schedule", db)
    if note:
        return out + f"<p>{escape(note)}</p>"
    items = published(db, "schedule")
    if not items:
        return out + "<p>아직 공개된 일정이 없습니다.</p>"
    rows = []
    for item in items:
        start = _when(item["starts_at"], settings)
        time = f"{_day(start)} {start:%H:%M}"
        if item.get("ends_at"):
            end = _when(item["ends_at"], settings)
            midnight = end.date() > start.date() and (end.hour, end.minute) == (0, 0)
            time += "–24:00" if midnight else f"–{end:%H:%M}"
        place = f" · {item['location_ko']}" if item.get("location_ko") else ""
        rows.append(f"<li>{escape(time)} {escape(item['title_ko'])}{escape(place)}</li>")
    return out + f"<ul>{''.join(rows)}</ul>"


_MD_NOISE = [
    (re.compile(r"```.*?```", re.S), " "),
    (re.compile(r"!\[[^\]]*\]\([^)]*\)"), " "),
    (re.compile(r"\[([^\]]*)\]\([^)]*\)"), r"\1"),
    (re.compile(r"<[^>]+>"), " "),
    (re.compile(r"^[ \t]*(#{1,6}|[-*+]|\d+\.|>)[ \t]+", re.M), ""),
    # 굵게·기울임·코드 표시는 글자 사이에 빈칸을 남기지 않게 지운다
    (re.compile(r"\*\*|__|[*`~]"), ""),
    (re.compile(r"\||-{3,}"), " "),
    (re.compile(r"\s+"), " "),
]


def _plain(markdown: str, limit: int = 300) -> str:
    text = markdown
    for pattern, repl in _MD_NOISE:
        text = pattern.sub(repl, text)
    text = text.strip()
    return text if len(text) <= limit else text[:limit].rstrip() + "…"


def _rules(db: Session, settings: Settings) -> str:
    out = "<h1>대회 규칙</h1>"
    note = _closed("rules", db)
    if note:
        return out + f"<p>{escape(note)}</p>"
    sections = published(db, "rules")
    if not sections:
        return out + "<p>아직 공개된 규칙이 없습니다.</p>"
    # 장(# 큰 제목)은 h2, 절은 h3. 본문이 없는 장은 제목만
    parts = []
    for section in sections:
        tag = "h2" if section.get("level", 2) == 1 else "h3"
        parts.append(f"<{tag}>{escape(section['title_ko'])}</{tag}>")
        text = _plain(section["body_ko"])
        if text:
            parts.append(f"<p>{escape(text)}</p>")
    return out + "".join(parts)


def _apply(db: Session, settings: Settings) -> str:
    values = published(db, "settings")
    period = []
    if values.get("apply_open_at"):
        period.append(f"{_day(_when(values['apply_open_at'], settings))}부터")
    if values.get("apply_close_at"):
        period.append(f"{_day(_when(values['apply_close_at'], settings))}까지")
    out = (
        "<h1>대회 신청</h1><dl>"
        "<dt>참가 자격</dt><dd>1/10 자율주행 대회 규격에 맞는 차량 플랫폼을 보유한 대학팀</dd>"
        "<dt>팀 구성</dt><dd>5인 이하로 구성된 대학팀</dd>"
        "<dt>참가 방법</dt><dd>네이버 폼으로 신청</dd>"
        f"<dt>접수 기간</dt><dd>{escape(' '.join(period) or '아직 정해지지 않았습니다')}</dd>"
        "</dl>"
    )
    form = values.get("apply_form_url")
    if form:
        out += f'<p><a href="{escape(form)}" rel="noopener">네이버 폼에서 신청하기</a></p>'
    return out


def _live(db: Session, settings: Settings) -> str:
    note = _closed("live", db)
    text = note or "예선 리더보드와 본선 대진을 대회 중 실시간으로 볼 수 있습니다."
    return f"<h1>대회 모니터링</h1><p>{escape(text)}</p>"


AWARD_NAMES = {"grand": "대상", "excellence": "최우수상", "merit": "우수상"}


def _results(db: Session, settings: Settings) -> str:
    entries = build_results(db).entries
    if not entries:
        return "<h1>대회 결과</h1><p>대회 결과는 시상이 끝나면 이 페이지에 공개합니다.</p>"
    rows = []
    for entry in entries:
        teams = ", ".join(team.name_ko for team in entry.teams)
        rows.append(f"<li>{escape(AWARD_NAMES[entry.award])} · {escape(teams)}</li>")
    return f"<h1>대회 결과</h1><ul>{''.join(rows)}</ul>"


# ---- 사이트맵 ----


def sitemap(db: Session, settings: Settings) -> str | None:
    """공개 주소를 정했을 때만 낸다. 닫아 게시한 페이지는 넣지 않는다."""
    if not settings.public_url:
        return None
    changed = {
        resource: row.published_at.date().isoformat()
        for resource in ("schedule", "rules", "settings")
        if (row := db.get(PublishedContent, resource)) is not None
    }
    pages = [("", "settings"), ("schedule", "schedule"), ("rules", "rules")]
    pages += [("apply", "settings"), ("live", "settings"), ("results", "settings")]
    entries = []
    for key, resource in pages:
        if key in ("schedule", "rules", "live") and _closed(key, db):
            continue
        lastmod = changed.get(resource)
        entries.append(
            f"<url><loc>{escape(settings.public_url + key)}</loc>"
            + (f"<lastmod>{lastmod}</lastmod>" if lastmod else "")
            + "</url>"
        )
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
        + "".join(entries)
        + "</urlset>\n"
    )
