"""규칙 Markdown 문서의 형식. DB 와 파일을 모르는 순수 함수만 둔다.

    # 대회 규칙              문서 제목 (영어 문서는 "# Rules"). 가져올 때는 무시한다.

    ## 공지                  절(## 섹션). 장 없이 바로 써도 된다.

    # 1. 개요                장(# 섹션). 아래 ## 절들을 묶는 큰 제목, 본문을 가질 수 있다.
    <!-- hidden -->          비공개 섹션에만 붙는다 (한국어 문서에서만 뜻이 있다).

    장 본문 Markdown (###, 목록, 표, 코드 블록 …)

    ## 1.1 절 제목
    절 본문

코드 블록(``` 또는 ~~~) 밖에서 `# ` 이나 `## ` 로 시작하는 줄이 섹션을 나눈다. 그래서 섹션 본문에는
그런 제목 줄을 쓸 수 없다 (소제목은 ###). 맨 처음 `# ` 줄은 그 아래에 글 없이 바로 다음 제목이
오거나 알려진 문서 제목("대회 규칙", "Rules")이면 문서 제목으로 보고 건너뛴다.
"""

import re
from collections.abc import Iterable
from dataclasses import dataclass
from typing import Literal

from app.errors import invalid

Lang = Literal["ko", "en"]
LANGS: tuple[Lang, ...] = ("ko", "en")
DOCUMENT_TITLES: dict[Lang, str] = {"ko": "대회 규칙", "en": "Rules"}
HIDDEN_MARKER = "<!-- hidden -->"
MAX_DOCUMENT_CHARS = 1_000_000
# schemas/common.py 의 Title, Markdown 과 같은 제한
MAX_TITLE_CHARS = 200
MAX_BODY_CHARS = 100_000

_FENCE = re.compile(r"^ {0,3}(`{3,}|~{3,})(.*)$")
_H1 = re.compile(r"^ {0,3}#(?:[ \t]+(.*?))?[ \t]*$")
_H2 = re.compile(r"^ {0,3}##(?:[ \t]+(.*?))?[ \t]*$")
# 장(#)과 절(##)
SectionLevel = int
CHAPTER, SECTION = 1, 2
_CLOSING_HASHES = re.compile(r"(?:^|[ \t]+)#+[ \t]*$")
_HIDDEN = re.compile(r"^[ \t]*<!--[ \t]*hidden[ \t]*-->[ \t]*$", re.IGNORECASE)


def filename(lang: Lang) -> str:
    return f"rules.{lang}.md"


@dataclass(frozen=True)
class DocumentSection:
    title: str
    body: str
    hidden: bool = False
    level: SectionLevel = SECTION


def fenced_lines(lines: list[str]) -> list[bool]:
    """줄마다 코드 블록(``` 또는 ~~~, 여닫는 줄 포함) 안이면 True."""
    flags: list[bool] = []
    fence: tuple[str, int] | None = None
    for line in lines:
        match = _FENCE.match(line)
        if fence is not None:
            closes = match and match[1][0] == fence[0] and len(match[1]) >= fence[1]
            if closes and not match[2].strip():
                fence = None
            flags.append(True)
        elif match and not (match[1][0] == "`" and "`" in match[2]):
            fence = (match[1][0], len(match[1]))
            flags.append(True)
        else:
            flags.append(False)
    return flags


def _headings(lines: list[str]) -> list[tuple[SectionLevel, str] | None]:
    """줄마다, 코드 블록 밖의 `# 제목`·`## 제목` 줄이면 (단계, 제목(닫는 # 제거)), 아니면 None."""
    found: list[tuple[SectionLevel, str] | None] = []
    for line, fenced in zip(lines, fenced_lines(lines), strict=True):
        heading, level = None, SECTION
        if not fenced:
            heading = _H2.match(line)
            if heading is None:
                heading, level = _H1.match(line), CHAPTER
        title = _CLOSING_HASHES.sub("", heading[1] or "").strip() if heading else None
        found.append((level, title) if heading and title is not None else None)
    return found


def _lines(text: str) -> list[str]:
    return text.removeprefix("\ufeff").replace("\r\n", "\n").replace("\r", "\n").split("\n")


def _trim(lines: list[str]) -> str:
    """앞뒤의 빈 줄과 끝의 공백을 지운다. 줄 안의 들여쓰기는 남긴다."""
    start = 0
    while start < len(lines) and not lines[start].strip():
        start += 1
    return "\n".join(lines[start:]).rstrip()


def _excerpt(text: str, limit: int = 40) -> str:
    text = text.strip()
    return text if len(text) <= limit else text[: limit - 1] + "…"


def section_heading_lines(body: str) -> list[int]:
    """본문에서 섹션 구분으로 읽힐 `# `·`## ` 줄의 번호(1부터)."""
    return [n for n, heading in enumerate(_headings(_lines(body)), 1) if heading is not None]


def _document_title(lines: list[str], heads: list[tuple[SectionLevel, str] | None]) -> int | None:
    """맨 처음 `# ` 줄이 문서 제목이면 그 줄 번호.

    아래에 글 없이 바로 다음 제목이 오거나 알려진 문서 제목이면 문서 제목으로 보고,
    아니면 본문이 있는 장으로 본다."""
    first = next((n for n, line in enumerate(lines) if line.strip()), None)
    if first is None or heads[first] is None or heads[first][0] != CHAPTER:
        return None
    if heads[first][1] in DOCUMENT_TITLES.values():
        return first
    for n in range(first + 1, len(lines)):
        if heads[n] is not None:
            return first
        if lines[n].strip():
            return None
    return first


def parse_document(markdown: str) -> list[DocumentSection]:
    """문서를 섹션(장·절)으로 나눈다. 형식이 맞지 않으면 422 VALIDATION_ERROR."""
    if len(markdown) > MAX_DOCUMENT_CHARS:
        raise invalid(
            f"문서가 너무 깁니다({len(markdown):,}자). {MAX_DOCUMENT_CHARS:,}자 이하로 줄이세요."
        )
    lines = _lines(markdown)
    heads = _headings(lines)
    skip = _document_title(lines, heads)
    starts = [n for n, head in enumerate(heads) if head is not None and n != skip]
    if not starts:
        raise invalid(
            "문서에 섹션이 없습니다. 섹션마다 `## 제목`(장은 `# 제목`) 줄로 시작하세요"
            " (코드 블록 안의 제목 줄은 섹션이 아닙니다)."
        )

    preamble = [
        (n, line) for n, line in enumerate(lines[: starts[0]]) if line.strip() and n != skip
    ]
    if preamble:
        n, line = preamble[0]
        raise invalid(
            f'{n + 1}번째 줄("{_excerpt(line)}")이 첫 섹션 제목보다 앞에 있습니다.'
            " 맨 위의 `# 문서 제목` 한 줄 말고는 모든 내용을 `#`·`## 제목` 아래로 옮기세요."
        )

    sections: list[DocumentSection] = []
    for index, start in enumerate(starts):
        end = starts[index + 1] if index + 1 < len(starts) else len(lines)
        level, title = heads[start] or (SECTION, "")
        body_lines = lines[start + 1 : end]
        first = next((i for i, line in enumerate(body_lines) if line.strip()), len(body_lines))
        hidden = first < len(body_lines) and bool(_HIDDEN.match(body_lines[first]))
        if hidden:
            body_lines = body_lines[first + 1 :]
        body = _trim(body_lines)

        where = f"{index + 1}번째 섹션"
        if not title:
            raise invalid(
                f"{where}({start + 1}번째 줄)의 제목이 비어 있습니다. `#` 뒤에 제목을 쓰세요."
            )
        if len(title) > MAX_TITLE_CHARS:
            raise invalid(
                f'{where} "{_excerpt(title)}"의 제목이 너무 깁니다({len(title):,}자).'
                f" {MAX_TITLE_CHARS}자 이하로 줄이세요."
            )
        if len(body) > MAX_BODY_CHARS:
            raise invalid(
                f'{where} "{_excerpt(title)}"의 본문이 너무 깁니다({len(body):,}자).'
                f" {MAX_BODY_CHARS:,}자 이하로 줄이거나 섹션을 나누세요."
            )
        sections.append(DocumentSection(title=title, body=body, hidden=hidden, level=level))
    return sections


def _heading(title: str, level: SectionLevel = SECTION) -> str:
    title = re.sub(r"\s*\n\s*", " ", title.replace("\r", "\n")).strip()
    marks = "#" * level
    # "제목 ##" 처럼 끝의 # 가 닫는 표시로 읽히지 않게 닫는 표시를 하나 더 붙인다
    return f"{marks} {title} #" if _CLOSING_HASHES.search(title) else f"{marks} {title}"


def _body(body: str) -> str:
    """본문을 문서에 넣을 모양으로 다듬는다.

    이 형식 전에 저장된 본문의 `# `·`## ` 소제목은 섹션을 나누지 않도록 ### 로 내린다.
    """
    lines = _lines(body)
    for n, heading in enumerate(_headings(lines)):
        if heading is not None:
            lines[n] = re.sub(r"^( {0,3})#{1,2}(?=[ \t]|$)", r"\1###", lines[n], count=1)
    return _trim(lines)


def render_document(title: str, sections: Iterable[DocumentSection]) -> str:
    blocks = [f"# {title}"]
    for section in sections:
        head = _heading(section.title, section.level)
        if section.hidden:
            head += "\n" + HIDDEN_MARKER
        body = _body(section.body)
        blocks.append(f"{head}\n\n{body}" if body else head)
    return "\n\n".join(blocks) + "\n"


# ---- 표 다듬기 (가져올 때) ----

# 노션은 표 칸 안의 줄바꿈을 그대로 내보내서 GFM 표가 깨진다. 예:
#   | 4 | 14:30~20:00 | 더미 연습 - 더미 검사
#   15:00~16:00 더미 A조 |
# 양끝을 | 로 감싼 표에서, | 로 끝나지 않는 행은 다음 줄들을 <br> 로 이어 | 로 끝나는 줄까지
# 한 행으로 합친다. 칸 수가 머리행보다 적은 행 뒤에 | 로 시작하지 않는 줄이 오는 경우도 같다.
TABLE_CELL_BREAK = "<br>"
_MAX_CELL_LINES = 50
_TABLE_DELIMITER = re.compile(r"^ {0,3}\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$")
_UNESCAPED_PIPE = re.compile(r"(?<!\\)(?:\\\\)*\|")
_ATX_HEADING = re.compile(r"^ {0,3}#{1,6}(?:[ \t]|$)")


def _ends_with_pipe(line: str) -> bool:
    text = line.rstrip()
    if not text.endswith("|"):
        return False
    backslashes = len(text) - 1 - len(text[:-1].rstrip("\\"))
    return backslashes % 2 == 0


def _starts_with_pipe(line: str) -> bool:
    return line.lstrip(" ").startswith("|") and len(line) - len(line.lstrip(" ")) <= 3


def _cell_count(row: str) -> int:
    pipes = len(_UNESCAPED_PIPE.findall(row.strip()))
    return pipes - 1 if _ends_with_pipe(row) else pipes


def _join_row(lines: list[str], fenced: list[bool], start: int, columns: int) -> tuple[str, int]:
    """start 줄에서 시작하는 표 행을 한 줄로 합친다. (합친 행, 쓴 줄 수)."""
    row = lines[start].rstrip()
    if _ends_with_pipe(row) and _cell_count(row) >= columns:
        return lines[start], 1
    parts = [row]
    for k in range(start + 1, min(len(lines), start + 1 + _MAX_CELL_LINES)):
        line = lines[k]
        if fenced[k] or _starts_with_pipe(line) or _ATX_HEADING.match(line):
            break
        parts.append(line.strip())
        if _ends_with_pipe(line):
            return TABLE_CELL_BREAK.join(parts), k - start + 1
    return lines[start], 1  # 닫는 | 를 찾지 못하면 손대지 않는다


def normalize_tables(markdown: str) -> str:
    """양끝을 | 로 감싼 표에서 여러 줄로 흩어진 칸을 <br> 로 이어 한 행으로 만든다.

    코드 블록 안은 건드리지 않는다. 줄바꿈은 \\n 으로 맞춘다.
    """
    lines = _lines(markdown)
    fenced = fenced_lines(lines)
    out: list[str] = []
    i = 0
    while i < len(lines):
        head = lines[i]
        is_table = (
            i + 1 < len(lines)
            and not fenced[i]
            and not fenced[i + 1]
            and _starts_with_pipe(head)
            and _ends_with_pipe(head)
            and "|" in lines[i + 1]
            and _TABLE_DELIMITER.match(lines[i + 1]) is not None
        )
        if not is_table:
            out.append(head)
            i += 1
            continue
        columns = _cell_count(head)
        out += [head, lines[i + 1]]
        i += 2
        while i < len(lines) and not fenced[i] and _starts_with_pipe(lines[i]):
            row, used = _join_row(lines, fenced, i, columns)
            out.append(row)
            i += used
    return "\n".join(out)
