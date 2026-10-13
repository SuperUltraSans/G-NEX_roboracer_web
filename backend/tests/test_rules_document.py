import json
import logging
import shutil
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import cli
from app.config import Settings
from app.errors import AppError
from app.main import create_app
from app.models import AuditLog, RuleSection
from app.services.rules_markdown import DocumentSection, parse_document, render_document
from tests.test_ws import ping, receive

RULES = "/api/admin/rules"
DOCUMENT = "/api/admin/rules/document"

FENCED_BODY = """본문 첫 줄

```markdown
## 코드 블록 안의 제목은 섹션이 아니다
```

~~~~
## 물결 코드 블록도
```
## 다른 기호의 닫는 표시는 블록을 닫지 않는다
~~~~

### 소제목

| a | b |
| --- | --- |
| 1 | 2 |"""


def read(settings: Settings, lang: str) -> str:
    return (settings.rules_dir / f"rules.{lang}.md").read_text("utf-8")


def make_rule(client: TestClient, **overrides: object) -> dict:
    response = client.post(RULES, json={"title_ko": "임시 규칙", **overrides})
    assert response.status_code == 201, response.text
    return response.json()


def put_document(client: TestClient, lang: str, markdown: str):
    return client.put(DOCUMENT, json={"lang": lang, "markdown": markdown})


def import_ok(client: TestClient, lang: str, markdown: str) -> dict:
    response = put_document(client, lang, markdown)
    assert response.status_code == 200, response.text
    return response.json()


def rejected(client: TestClient, lang: str, markdown: str) -> str:
    response = put_document(client, lang, markdown)
    assert response.status_code == 422, response.text
    assert response.json()["code"] == "VALIDATION_ERROR"
    return response.json()["detail"]


# ---- 형식 ----


def test_render_and_parse_round_trip() -> None:
    sections = [
        DocumentSection("임시 대회 개요", "임시 개요 본문"),
        DocumentSection("임시 차량 규격", FENCED_BODY),
        DocumentSection("임시 비공개 초안", "임시 초안 본문", hidden=True),
        DocumentSection("본문 없는 섹션", ""),
        DocumentSection("C# 과 끝이 # 인 제목 ##", "- 목록\n  - 안쪽 목록"),
    ]
    text = render_document("대회 규칙", sections)
    assert text.startswith(
        "# 대회 규칙\n\n## 임시 대회 개요\n\n임시 개요 본문\n\n## 임시 차량 규격\n"
    )
    assert "## 임시 비공개 초안\n<!-- hidden -->\n\n임시 초안 본문\n" in text
    assert text.endswith("\n") and not text.endswith("\n\n")
    assert parse_document(text) == sections
    # 다시 그려도 같다
    assert render_document("대회 규칙", parse_document(text)) == text


def test_parse_details() -> None:
    text = (
        "\ufeff# Rules\r\n\r\n"
        "## Overview ##\r\n"
        "<!--HIDDEN-->\r\n\r\n"
        "  indented first line\r\n"
        "text   \r\n\r\n\r\n"
        "##   Spaced title   \n"
        "####### not a heading\n"
        "##no space is not a heading\n"
        "   ## three spaces is a heading\n"
        "    ## four spaces is code\n"
    )
    assert parse_document(text) == [
        DocumentSection("Overview", "  indented first line\ntext", hidden=True),
        DocumentSection("Spaced title", "####### not a heading\n##no space is not a heading"),
        DocumentSection("three spaces is a heading", "    ## four spaces is code"),
    ]
    # 닫히지 않은 코드 블록은 문서 끝까지 이어진다
    assert len(parse_document("## A\n```\n## B\n")) == 1


@pytest.mark.parametrize(
    ("markdown", "message"),
    [
        ("", "섹션이 없습니다"),
        ("# 대회 규칙\n\n본문만 있다", "섹션이 없습니다"),
        ("```\n## 코드 블록 안\n```", "섹션이 없습니다"),
        ("# 대회 규칙\n\n머리말\n\n## 개요\n본문", '3번째 줄("머리말")이 첫 `## 제목`보다 앞에'),
        ("# 하나\n# 둘\n## 개요", "2번째 줄"),
        ("## 개요\n본문\n##\n본문", "2번째 섹션(3번째 줄)의 제목이 비어 있습니다"),
        ("## " + "가" * 201, "1번째 섹션"),
        ("## 개요\n" + "가" * 100_001, '1번째 섹션 "개요"의 본문이 너무 깁니다(100,001자)'),
        ("## 개요\n" + "가" * 1_000_000, "문서가 너무 깁니다"),
    ],
)
def test_parse_errors(markdown: str, message: str) -> None:
    with pytest.raises(AppError) as error:
        parse_document(markdown)
    assert error.value.status_code == 422
    assert message in error.value.detail


# ---- 가져오기 ----


def test_ko_import_replaces_sections_in_order(admin_client: TestClient, db: Session) -> None:
    a = make_rule(admin_client, title_ko="가", title_en="A", body_ko="가 본문", body_en="A body")
    b = make_rule(admin_client, title_ko="나", body_ko="나 본문")
    c = make_rule(admin_client, title_ko="다", body_ko="다 본문")

    result = import_ok(
        admin_client,
        "ko",
        "# 대회 규칙\n\n## 가\n\n가 본문\n\n## 나 (고침)\n<!-- hidden -->\n\n나 새 본문\n",
    )
    assert (result["lang"], result["created"], result["updated"], result["deleted"]) == (
        "ko",
        0,
        1,
        1,
    )
    sections = result["sections"]
    assert [s["id"] for s in sections] == [a["id"], b["id"]]
    assert [s["sort_order"] for s in sections] == [0, 1]
    # 바뀌지 않은 섹션은 version 이 그대로, 영어 값은 자리에 남는다
    assert sections[0]["version"] == 1
    assert (sections[0]["title_en"], sections[0]["body_en"]) == ("A", "A body")
    assert sections[1] | {"updated_at": None} == {
        **b,
        "title_ko": "나 (고침)",
        "body_ko": "나 새 본문",
        "is_published": False,
        "version": 2,
        "sort_order": 1,
        "updated_at": None,
    }
    assert admin_client.get(RULES).json() == sections
    assert [r["id"] for r in admin_client.get("/api/rules").json()] == [a["id"]]
    assert db.get(RuleSection, c["id"]) is None

    grown = import_ok(admin_client, "ko", "## 가\n가 본문\n## 나\n## 라\n라 본문\n## 마")
    assert (grown["created"], grown["updated"], grown["deleted"]) == (2, 1, 0)
    assert [s["title_ko"] for s in grown["sections"]] == ["가", "나", "라", "마"]
    assert [s["sort_order"] for s in grown["sections"]] == [0, 1, 2, 3]
    new = grown["sections"][2]
    assert (new["title_en"], new["body_en"], new["is_published"], new["version"]) == (
        "",
        "",
        True,
        1,
    )

    log = db.scalars(
        select(AuditLog).where(AuditLog.action == "import").order_by(AuditLog.id)
    ).all()
    assert len(log) == 2
    assert log[0].entity == "rule_sections" and log[0].user_id is not None
    assert log[0].before == {
        "lang": "ko",
        "sections": [
            {"id": a["id"], "title": "가"},
            {"id": b["id"], "title": "나"},
            {"id": c["id"], "title": "다"},
        ],
    }
    assert log[0].after["sections"] == [
        {"id": a["id"], "title": "가"},
        {"id": b["id"], "title": "나 (고침)"},
    ]
    assert (log[0].after["updated"], log[0].after["deleted"]) == (1, 1)
    assert "body_ko" not in json.dumps(log[0].after)


def test_ko_import_errors_change_nothing(admin_client: TestClient) -> None:
    make_rule(admin_client, title_ko="가")
    before = admin_client.get(RULES).json()
    assert "## 제목" in rejected(admin_client, "ko", "머리말\n## 가")
    assert "섹션이 없습니다" in rejected(admin_client, "ko", "")
    assert admin_client.put(DOCUMENT, json={"lang": "fr", "markdown": "## A"}).status_code == 422
    assert admin_client.get(RULES).json() == before


def test_en_import(admin_client: TestClient) -> None:
    a = make_rule(admin_client, title_ko="개요", body_ko="개요 본문")
    b = make_rule(admin_client, title_ko="차량", title_en="Old", body_en="Old body")
    c = make_rule(admin_client, title_ko="안전", title_en="Safety", body_en="Safety body")

    result = import_ok(
        admin_client,
        "en",
        "# Rules\n\n## Overview\n<!-- hidden -->\n\nOverview body\n\n## 차량\n",
    )
    assert (result["created"], result["updated"], result["deleted"]) == (0, 3, 0)
    by_id = {s["id"]: s for s in result["sections"]}
    # 숨김 표시는 영어 문서에서 무시하고, 한국어 값과 공개 여부는 그대로다
    assert by_id[a["id"]] | {"updated_at": None, "version": None} == {
        **a,
        "title_en": "Overview",
        "body_en": "Overview body",
        "updated_at": None,
        "version": None,
    }
    # 한국어 제목과 같은 제목은 비워서 한국어로 대체되게 한다
    assert (by_id[b["id"]]["title_en"], by_id[b["id"]]["body_en"]) == ("", "")
    # 문서에 없는 뒤쪽 섹션은 영어 값을 비운다
    assert (by_id[c["id"]]["title_en"], by_id[c["id"]]["body_en"]) == ("", "")
    assert [s["version"] for s in result["sections"]] == [2, 2, 2]

    same = import_ok(admin_client, "en", "## Overview\nOverview body")
    assert same["updated"] == 0
    assert [s["version"] for s in same["sections"]] == [2, 2, 2]

    detail = rejected(admin_client, "en", "## A\n## B\n## C\n## D")
    assert "영어 문서의 섹션 수(4)가 지금 규칙 섹션 수(3)보다 많습니다" in detail
    assert "한국어 문서를 먼저 올리세요" in detail
    assert admin_client.get(RULES).json() == same["sections"]


def test_export_document(admin_client: TestClient, settings: Settings) -> None:
    make_rule(admin_client, title_ko="개요", title_en="Overview", body_ko="개요 본문")
    make_rule(admin_client, title_ko="초안", body_ko="초안 본문", is_published=False)

    ko = admin_client.get(DOCUMENT, params={"lang": "ko"})
    assert ko.status_code == 200
    assert ko.headers["cache-control"] == "no-store"
    assert ko.json() == {
        "lang": "ko",
        "filename": "rules.ko.md",
        "markdown": (
            "# 대회 규칙\n\n## 개요\n\n개요 본문\n\n## 초안\n<!-- hidden -->\n\n초안 본문\n"
        ),
    }
    en = admin_client.get(DOCUMENT, params={"lang": "en"}).json()
    # 영어 제목이 없으면 한국어 제목, 영어 본문은 비운 채로 둔다
    assert en["markdown"] == "# Rules\n\n## Overview\n\n## 초안\n"
    assert en["filename"] == "rules.en.md"
    assert read(settings, "ko") == ko.json()["markdown"]
    assert read(settings, "en") == en["markdown"]
    assert admin_client.get(DOCUMENT).status_code == 422

    # 내려받은 문서를 그대로 올리면 아무것도 바뀌지 않는다
    for lang, document in (("ko", ko.json()), ("en", en)):
        result = import_ok(admin_client, lang, document["markdown"])
        assert (result["created"], result["updated"], result["deleted"]) == (0, 0, 0)


def test_referee_cannot_use_documents(referee_client: TestClient) -> None:
    assert referee_client.get(DOCUMENT, params={"lang": "ko"}).status_code == 403
    response = put_document(referee_client, "ko", "## A")
    assert response.status_code == 403 and response.json()["code"] == "FORBIDDEN"


def test_import_requires_fetch_header(admin_client: TestClient) -> None:
    response = admin_client.put(
        DOCUMENT, json={"lang": "ko", "markdown": "## A"}, headers={"X-Requested-With": ""}
    )
    assert response.status_code == 403


def test_import_broadcasts_content_updated(admin_client: TestClient) -> None:
    with admin_client.websocket_connect("/ws/live") as ws:
        receive(ws)
        import_ok(admin_client, "ko", "## 개요\n본문")
        event = receive(ws)
        assert (event["type"], event["data"]) == ("content.updated", {"resource": "rules"})
        rejected(admin_client, "ko", "본문만")
        assert ping(ws)["type"] == "pong"


# ---- 웹 편집 → 파일 ----


def test_web_edits_rewrite_documents(admin_client: TestClient, settings: Settings) -> None:
    first = make_rule(admin_client, title_ko="개요", body_ko="개요 본문")
    assert read(settings, "ko") == "# 대회 규칙\n\n## 개요\n\n개요 본문\n"
    assert read(settings, "en") == "# Rules\n\n## 개요\n"

    second = make_rule(admin_client, title_ko="차량", title_en="Vehicles", body_en="Body")
    assert read(settings, "ko").endswith("## 차량\n")
    assert read(settings, "en").endswith("## Vehicles\n\nBody\n")

    url = f"{RULES}/{first['id']}"
    admin_client.patch(url, json={"version": 1, "body_ko": "새 본문\n\n```\n## 코드\n```"})
    assert "## 개요\n\n새 본문\n\n```\n## 코드\n```\n\n## 차량" in read(settings, "ko")
    admin_client.patch(url, json={"version": 2, "is_published": False})
    assert "## 개요\n<!-- hidden -->\n" in read(settings, "ko")
    assert "hidden" not in read(settings, "en")

    admin_client.put(f"{RULES}/order", json={"ids": [second["id"], first["id"]]})
    assert read(settings, "ko").index("## 차량") < read(settings, "ko").index("## 개요")

    admin_client.delete(f"{RULES}/{second['id']}")
    assert "차량" not in read(settings, "ko")
    assert "Vehicles" not in read(settings, "en")
    # 바뀌기 전 파일은 .bak 으로 한 번 남는다
    assert "차량" in (settings.rules_dir / "rules.ko.md.bak").read_text("utf-8")
    assert not list(settings.rules_dir.glob("*.tmp"))


def test_import_rewrites_documents(admin_client: TestClient, settings: Settings) -> None:
    import_ok(admin_client, "ko", "#  대회 규칙  \n## 개요 ##\n\n\n본문\n\n\n")
    assert read(settings, "ko") == "# 대회 규칙\n\n## 개요\n\n본문\n"
    import_ok(admin_client, "en", "## Overview\nBody")
    assert read(settings, "en") == "# Rules\n\n## Overview\n\nBody\n"


def test_section_heading_in_body_is_rejected(admin_client: TestClient) -> None:
    response = admin_client.post(RULES, json={"title_ko": "개요", "body_ko": "첫 줄\n## 소제목"})
    assert response.status_code == 422
    assert "2번째 줄" in response.json()["detail"]
    assert "###" in response.json()["detail"]
    section = make_rule(admin_client, body_ko="### 소제목\n\n```\n## 코드\n```")
    patch = admin_client.patch(
        f"{RULES}/{section['id']}", json={"version": 1, "body_en": "## Heading"}
    )
    assert patch.status_code == 422


def test_legacy_section_heading_in_body_is_demoted(
    app: FastAPI, admin_client: TestClient, settings: Settings
) -> None:
    with app.state.session_factory() as session:
        session.add(RuleSection(title_ko="예전 섹션", body_ko="앞\n\n## 예전 소제목\n\n뒤"))
        session.commit()
    markdown = admin_client.get(DOCUMENT, params={"lang": "ko"}).json()["markdown"]
    assert markdown == "# 대회 규칙\n\n## 예전 섹션\n\n앞\n\n### 예전 소제목\n\n뒤\n"


def test_file_write_failure_does_not_break_requests(
    admin_client: TestClient, settings: Settings, caplog: pytest.LogCaptureFixture
) -> None:
    shutil.rmtree(settings.rules_dir)  # 서버가 시작할 때 만든 폴더
    settings.rules_dir.write_text("폴더 자리에 파일이 있다", "utf-8")
    with caplog.at_level(logging.ERROR, logger="app.services.rules_document"):
        make_rule(admin_client, title_ko="개요")
        result = import_ok(admin_client, "ko", "## 개요\n본문")
        export = admin_client.get(DOCUMENT, params={"lang": "ko"})
    assert result["updated"] == 1
    assert export.status_code == 200 and "## 개요" in export.json()["markdown"]
    errors = [r for r in caplog.records if r.name == "app.services.rules_document"]
    assert len(errors) == 3
    assert all(r.levelno == logging.ERROR and "규칙 문서" in r.getMessage() for r in errors)


def test_startup_writes_documents(settings: Settings) -> None:
    settings.rules_dir.mkdir(parents=True)
    (settings.rules_dir / "rules.ko.md").write_text("## 서버에서 직접 고친 내용\n", "utf-8")
    assert cli.main(["seed-demo"], settings=settings) == 0
    (settings.rules_dir / "rules.ko.md").write_text("## 서버에서 직접 고친 내용\n", "utf-8")

    app = create_app(settings)
    with TestClient(app):
        pass
    app.state.engine.dispose()
    ko = read(settings, "ko")
    assert ko.startswith("# 대회 규칙\n\n## 임시 대회 개요\n\n임시 대회 개요 본문\n")
    assert "## 임시 비공개 초안\n<!-- hidden -->\n" in ko
    en = read(settings, "en")
    assert "## Temporary overview\n\nTemporary overview body\n\n## Temporary vehicle" in en
    assert "## 임시 안전 수칙\n\n## 임시 비공개 초안\n" in en  # 영어 값이 없는 섹션
    backup = settings.rules_dir / "rules.ko.md.bak"
    assert backup.read_text("utf-8") == "## 서버에서 직접 고친 내용\n"


def test_startup_without_migrations_does_not_crash(tmp_path: Path) -> None:
    settings = Settings(
        _env_file=None,
        database_url=f"sqlite:///{tmp_path / 'empty.db'}",
        rules_dir=tmp_path / "rules",
    )
    app = create_app(settings)
    with TestClient(app) as client:
        assert client.get("/api/health").status_code == 200
    app.state.engine.dispose()
    assert not (tmp_path / "rules").exists()


# ---- CLI ----


def test_cli_export_and_import(settings: Settings, capsys: pytest.CaptureFixture[str]) -> None:
    assert cli.main(["seed-demo"], settings=settings) == 0
    (settings.rules_dir / "rules.ko.md").unlink()
    assert cli.main(["export-rules"], settings=settings) == 0
    out = capsys.readouterr().out
    assert str(settings.rules_dir / "rules.ko.md") in out
    assert str(settings.rules_dir / "rules.en.md") in out
    ko = read(settings, "ko")

    # 서버의 파일을 직접 고친 뒤 DB 에 넣는다
    edited = ko.replace("## 임시 안전 수칙", "## 안전 수칙\n<!-- hidden -->").replace(
        "임시 비공개 초안", "공개 초안"
    )
    edited = edited.replace("## 공개 초안\n<!-- hidden -->\n", "## 공개 초안\n")
    edited += "\n## 새 섹션\n\n새 본문\n"
    (settings.rules_dir / "rules.ko.md").write_text(edited, "utf-8")
    assert cli.main(["import-rules", "--lang", "ko"], settings=settings) == 0
    assert "새 섹션 1, 바뀐 섹션 2, 지운 섹션 0" in capsys.readouterr().out
    assert read(settings, "ko") == edited

    app = create_app(settings)
    with TestClient(app) as client:
        titles = [r["title_ko"] for r in client.get("/api/rules").json()]
    app.state.engine.dispose()
    assert titles == [
        "임시 대회 개요",
        "임시 차량 규격",
        "임시 예선 방식",
        "임시 본선 방식",
        "공개 초안",
        "새 섹션",
    ]

    other = settings.rules_dir.parent / "en-draft.md"
    other.write_text("".join(f"## {n}\n" for n in range(8)), "utf-8")
    assert cli.main(["import-rules", "--lang", "en", "--file", str(other)], settings=settings) == 1
    assert "섹션 수(8)가 지금 규칙 섹션 수(7)" in capsys.readouterr().err
    missing = str(settings.rules_dir / "nope.md")
    assert cli.main(["import-rules", "--lang", "en", "--file", missing], settings=settings) == 1
    other.write_bytes("## 개요\n".encode("cp949"))
    assert cli.main(["import-rules", "--lang", "ko", "--file", str(other)], settings=settings) == 1
    assert "UTF-8" in capsys.readouterr().err
