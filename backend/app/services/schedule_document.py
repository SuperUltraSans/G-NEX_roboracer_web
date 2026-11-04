"""일정 ⇄ Markdown 문서. 한 문서에 한국어와 영어를 함께 쓴다.

    ## 2026-11-01 (일)

    ### 09:00-10:00 참가 등록 및 검차
    - 장소: 피트 구역
    - 영문: Registration and inspection
    - 영문 장소: Pit area
    - 영문 설명: Vehicle inspection and registration.
    차량 검차와 참가 등록을 진행합니다.

    ### 10:00 개회식 <!-- hidden -->

`## 날짜` 아래 `### 시각 제목` 이 일정 하나다. 끝 시각은 생략할 수 있다. `- 장소:` 같은 줄 말고는
모두 한국어 설명이다. `<!-- hidden -->` 이 있으면 비공개. 시각은 대회 시간대 기준이다.
올리면 일정 전체를 문서대로 바꾼다(초안이므로 '게시'해야 공개된다).
"""

import re
from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from pydantic import ValidationError
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.errors import invalid
from app.models import ScheduleItem, User
from app.schemas.content import ScheduleItemCreate
from app.services import audit

FILENAME = "schedule.md"
MAX_ITEMS = 500
HIDDEN = "<!-- hidden -->"
WEEKDAYS = "월화수목금토일"

# 첫 날짜 줄 위의 글은 올려도 무시한다
GUIDE = """> 일정 문서 형식 (이 안내는 올려도 무시합니다)
> - '## 2026-11-01' 처럼 날짜 줄 아래에 일정을 씁니다.
> - 일정 하나는 '### 09:00-10:00 제목' 으로 시작합니다. 끝 시각은 생략할 수 있습니다.
> - '- 장소:', '- 영문:', '- 영문 장소:', '- 영문 설명:' 줄로 장소와 영어를 씁니다.
> - 그 밖의 줄은 한국어 설명입니다. 비공개 일정은 제목 줄 끝에 <!-- hidden --> 을 붙입니다.
> - 올리면 지금 일정 전체가 문서대로 바뀝니다. 공개 사이트에는 '게시'해야 보입니다."""

_DATE = re.compile(r"^##\s+(\d{4})[-./](\d{1,2})[-./](\d{1,2})\b")
_ITEM = re.compile(r"^###\s+(\d{1,2}):(\d{2})(?:\s*[-–~]\s*(\d{1,2}):(\d{2}))?\s+(\S.*)$")
_FIELD = re.compile(r"^[-*]\s*(장소|영문 제목|영문 장소|영문 설명|영문)\s*[:：]\s*(.*)$")
FIELD_NAMES = {
    "장소": "location_ko",
    "영문": "title_en",
    "영문 제목": "title_en",
    "영문 장소": "location_en",
    "영문 설명": "description_en",
}


@dataclass
class _Draft:
    line: int
    day: date
    start: time
    end: time | None
    title_ko: str
    hidden: bool = False
    # 끝 시각이 24:00 (다음 날 00:00)
    midnight: bool = False
    fields: dict[str, str] = field(default_factory=dict)
    description: list[str] = field(default_factory=list)
    english_description: list[str] = field(default_factory=list)


def _fail(line: int, message: str) -> Exception:
    return invalid(f"{line}번째 줄: {message}")


def _clock(hour: str, minute: str, line: int) -> time:
    h, m = int(hour), int(minute)
    if h > 23 or m > 59:
        raise _fail(line, f"{hour}:{minute} 은(는) 없는 시각입니다.")
    return time(h, m)


def _trim(lines: list[str]) -> str | None:
    text = "\n".join(lines).strip("\n")
    return text.strip() or None


def parse(markdown: str, timezone: str) -> list[ScheduleItemCreate]:
    """문서를 일정 목록으로 바꾼다. 형식이 틀리면 몇 번째 줄인지 알려 주는 422."""
    zone = ZoneInfo(timezone)
    drafts: list[_Draft] = []
    day: date | None = None
    current: _Draft | None = None
    in_comment = False
    english_open = False
    for number, raw in enumerate(markdown.replace("\r\n", "\n").split("\n"), start=1):
        line = raw.rstrip()
        stripped = line.strip()
        if in_comment:
            in_comment = "-->" not in stripped
            continue
        if stripped.startswith("<!--") and stripped != HIDDEN:
            in_comment = "-->" not in stripped
            continue
        if stripped.startswith("## ") and not stripped.startswith("### "):
            match = _DATE.match(stripped)
            if not match:
                raise _fail(number, "날짜 줄은 '## 2026-11-01' 처럼 씁니다.")
            try:
                day = date(*(int(part) for part in match.groups()))
            except ValueError:
                raise _fail(number, "없는 날짜입니다.") from None
            current = None
            continue
        if stripped.startswith("### "):
            hidden = HIDDEN in stripped
            match = _ITEM.match(stripped.replace(HIDDEN, "").strip())
            if not match:
                raise _fail(number, "일정은 '### 09:00-10:00 제목' 처럼 시각과 제목을 씁니다.")
            if day is None:
                raise _fail(number, "일정 위에 '## 2026-11-01' 같은 날짜 줄이 있어야 합니다.")
            sh, sm, eh, em, title = match.groups()
            start = _clock(sh, sm, number)
            # 끝 시각 24:00 은 그날 자정(다음 날 00:00)
            midnight = eh is not None and int(eh) == 24 and int(em) == 0
            end = _clock(eh, em, number) if eh and not midnight else None
            if end is not None and end <= start:
                raise _fail(number, "끝 시각은 시작 시각보다 뒤여야 합니다.")
            current = _Draft(number, day, start, end, title.strip(), hidden, midnight=midnight)
            drafts.append(current)
            english_open = False
            continue
        if current is None or stripped.startswith("# "):
            continue  # 제목·안내 등 일정 밖의 글
        if stripped == HIDDEN:
            current.hidden = True
            continue
        field_match = _FIELD.match(stripped)
        if field_match:
            name, value = field_match.groups()
            key = FIELD_NAMES[name]
            if key == "description_en":
                current.english_description = [value.strip()]
                english_open = True
            else:
                current.fields[key] = value.strip()
                english_open = False
            continue
        # 영문 설명 다음의 들여쓴 줄은 영문 설명에 이어 붙인다
        if english_open and line.startswith(("  ", "\t")) and stripped:
            current.english_description.append(stripped)
            continue
        english_open = False
        current.description.append(line)

    if len(drafts) > MAX_ITEMS:
        raise invalid(f"일정은 {MAX_ITEMS}개까지 올릴 수 있습니다.")
    items = []
    for draft in drafts:
        try:
            items.append(
                ScheduleItemCreate(
                    starts_at=datetime.combine(draft.day, draft.start, zone),
                    ends_at=(
                        datetime.combine(draft.day + timedelta(days=1), time(0), zone)
                        if draft.midnight
                        else datetime.combine(draft.day, draft.end, zone)
                        if draft.end
                        else None
                    ),
                    title_ko=draft.title_ko,
                    title_en=draft.fields.get("title_en", ""),
                    location_ko=draft.fields.get("location_ko"),
                    location_en=draft.fields.get("location_en"),
                    description_ko=_trim(draft.description),
                    description_en=_trim(draft.english_description),
                    is_published=not draft.hidden,
                )
            )
        except ValidationError as exc:
            reason = "; ".join(error["msg"] for error in exc.errors())
            message = f"'{draft.title_ko}' 을(를) 넣을 수 없습니다 ({reason})."
            raise _fail(draft.line, message) from None
    return items


def render(items: Sequence[ScheduleItem], timezone: str) -> str:
    """지금 일정을 문서로 만든다. 그대로 다시 올리면 같은 일정이 된다."""
    zone = ZoneInfo(timezone)
    blocks = ["# 대회 일정", GUIDE]
    day: date | None = None
    for item in items:
        start = item.starts_at.astimezone(zone)
        if start.date() != day:
            day = start.date()
            blocks.append(f"## {day.isoformat()} ({WEEKDAYS[day.weekday()]})")
        when = f"{start:%H:%M}"
        if item.ends_at:
            end = item.ends_at.astimezone(zone)
            # 다음 날 00:00 에 끝나면 24:00 으로 적는다 (그날 일정으로 보이게)
            midnight = end.date() == start.date() + timedelta(days=1) and end.time() == time(0)
            when += "-24:00" if midnight else f"-{end:%H:%M}"
        lines = [f"### {when} {item.title_ko}" + (f" {HIDDEN}" if not item.is_published else "")]
        if item.location_ko:
            lines.append(f"- 장소: {item.location_ko}")
        if item.title_en:
            lines.append(f"- 영문: {item.title_en}")
        if item.location_en:
            lines.append(f"- 영문 장소: {item.location_en}")
        if item.description_en:
            first, *rest = item.description_en.split("\n")
            lines.append(f"- 영문 설명: {first}")
            lines += [f"  {part}" for part in rest if part.strip()]
        if item.description_ko:
            lines.append(item.description_ko)
        blocks.append("\n".join(lines))
    return "\n\n".join(blocks) + "\n"


def list_items(db: Session) -> list[ScheduleItem]:
    return list(
        db.scalars(
            select(ScheduleItem).order_by(
                ScheduleItem.starts_at, ScheduleItem.sort_order, ScheduleItem.id
            )
        )
    )


def import_document(
    db: Session, actor: User | None, markdown: str, timezone: str
) -> tuple[int, int]:
    """일정 전체를 문서대로 바꾼다. (만든 수, 지운 수)."""
    items = parse(markdown, timezone)
    old = list_items(db)
    db.execute(delete(ScheduleItem))
    for order, item in enumerate(items, start=1):
        db.add(
            ScheduleItem(
                **item.model_dump(exclude={"sort_order"}),
                sort_order=order,
                updated_by=actor.id if actor else None,
            )
        )
    db.flush()
    audit.record(
        db,
        actor,
        "import",
        "schedule_items",
        "*",
        {"titles": [item.title_ko for item in old]},
        {"titles": [item.title_ko for item in items]},
    )
    return len(items), len(old)
