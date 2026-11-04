import io
import os
import stat
import unicodedata
import zipfile
from urllib.parse import quote

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import cli
from app.config import Settings
from app.models import AuditLog
from app.services import rules_package
from app.services.rules_markdown import normalize_tables, parse_document
from app.services.rules_refs import LocalPath, encode_path, local_path
from tests.test_ws import ping, receive

RULES = "/api/admin/rules"
DOCUMENT = "/api/admin/rules/document"
PACKAGE = "/api/admin/rules/package"
FILES = "/api/rules/files"
PAGES = ("schedule", "rules", "live")

PNG_A = b"\x89PNG\r\n\x1a\n-a"
PNG_B = b"\x89PNG\r\n\x1a\n-b"
PNG_C = b"\x89PNG\r\n\x1a\n-c"
JPG = b"\xff\xd8\xff-jpg"
WEBP = b"RIFF-webp"

NOTION_TABLE_ROW = (
    "| 4 | 14:30~20:00 | 14:30~15:00 더미 연습 - 더미 검사 \n"
    "15:00~16:00 더미 A조\n"
    "16:00~17:00 더미 B조 |"
)
JOINED_ROW = (
    "| 4 | 14:30~20:00 | 14:30~15:00 더미 연습 - 더미 검사<br>"
    "15:00~16:00 더미 A조<br>16:00~17:00 더미 B조 |"
)
NOTION_MD = f"""# 2026 G-NEX 규칙

## 대회 개요

QR 코드로 접수합니다.

![dummy-qr.png](dummy-qr.png)

## 일정

| 일차 | 시간 | 내용 |
| --- | --- | --- |
{NOTION_TABLE_ROW}
| 5 | 09:00~18:00 | 본선 |

![image.png](%EA%B7%9C%EC%B9%99%20abc123/image.png)
"""


class LegacyName(zipfile.ZipInfo):
    """윈도 압축 프로그램처럼 이름을 CP949 로 쓰고 UTF-8 표시를 하지 않는다."""

    def _encodeFilenameFlags(self) -> tuple[bytes, int]:  # noqa: N802
        return self.filename.encode("cp949"), self.flag_bits & ~0x800


def make_zip(files: dict[str, bytes | str], *infos: tuple[zipfile.ZipInfo, bytes]) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        for name, data in files.items():
            # 이름(../, 백슬래시 …)을 손대지 않고 그대로 쓴다
            info = zipfile.ZipInfo(name)
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, data)
        for info, data in infos:
            archive.writestr(info, data)
    return buffer.getvalue()


def set_flag(data: bytes, name: str, bit: int) -> bytes:
    """만든 ZIP 에서 name 항목의 일반 플래그 비트를 켠다 (zipfile 은 쓸 때 플래그를 새로 정한다)."""
    out = bytearray(data)
    encoded = name.encode()
    for signature, flag_at, name_at in ((b"PK\x03\x04", 6, 30), (b"PK\x01\x02", 8, 46)):
        start = 0
        while (start := out.find(signature, start)) >= 0:
            if out[start + name_at : start + name_at + len(encoded)] == encoded:
                flags = int.from_bytes(out[start + flag_at : start + flag_at + 2], "little")
                out[start + flag_at : start + flag_at + 2] = (flags | bit).to_bytes(2, "little")
            start += 4
    return bytes(out)


def put_package(client: TestClient, lang: str, data: bytes, **headers: str):
    return client.put(
        PACKAGE,
        params={"lang": lang},
        content=data,
        headers={"Content-Type": "application/zip", **headers},
    )


def package_ok(client: TestClient, lang: str, data: bytes) -> dict:
    response = put_package(client, lang, data)
    assert response.status_code == 200, response.text
    return response.json()


def package_rejected(client: TestClient, data: bytes, status: int = 422) -> str:
    response = put_package(client, "ko", data)
    assert response.status_code == status, response.text
    return response.json()["detail"]


def stored(settings: Settings) -> dict[str, bytes]:
    root = settings.rules_dir / "files"
    if not root.exists():
        return {}
    return {p.relative_to(root).as_posix(): p.read_bytes() for p in root.rglob("*") if p.is_file()}


def bodies(client: TestClient, lang: str = "ko") -> list[str]:
    return [section[f"body_{lang}"] for section in client.get(RULES).json()]


def notion_zip() -> bytes:
    return make_zip(
        {
            "Export-1234/규칙 abc123.md": NOTION_MD,
            "Export-1234/dummy-qr.png": PNG_A,
            "Export-1234/규칙 abc123/image.png": PNG_B,
            "Export-1234/규칙 abc123/unused.png": PNG_C,
            "Export-1234/규칙 abc123/data.csv": "a,b",
            "Export-1234/.DS_Store": b"junk",
            "__MACOSX/Export-1234/._dummy-qr.png": b"junk",
        }
    )


# ---- 가져오기 ----


def test_notion_export_zip(admin_client: TestClient, settings: Settings, db: Session) -> None:
    result = package_ok(admin_client, "ko", notion_zip())
    assert (result["created"], result["updated"], result["deleted"]) == (2, 0, 0)
    assert result["assets"] == 2
    overview, schedule = result["sections"]
    assert overview["title_ko"] == "대회 개요"
    assert overview["body_ko"] == "QR 코드로 접수합니다.\n\n![dummy-qr.png](/dummy-qr.png)"
    # 노션의 여러 줄 칸은 <br> 로 이어 한 행이 된다
    assert JOINED_ROW in schedule["body_ko"]
    assert "| 5 | 09:00~18:00 | 본선 |" in schedule["body_ko"]
    assert schedule["body_ko"].endswith("![image.png](/규칙%20abc123/image.png)")
    assert stored(settings) == {"dummy-qr.png": PNG_A, "규칙 abc123/image.png": PNG_B}
    assert result["warnings"] == [
        "문서에서 쓰지 않는 그림이라 넣지 않았습니다(1개): 규칙 abc123/unused.png",
        "그림(png, jpg, gif, webp, avif)이 아니라 건너뛴 파일(1개): 규칙 abc123/data.csv",
    ]
    # 서버의 문서 파일도 바뀐 주소로 쓰인다
    document = (settings.rules_dir / "rules.ko.md").read_text("utf-8")
    assert "![dummy-qr.png](/dummy-qr.png)" in document
    assert JOINED_ROW in document
    # 본문의 주소를 /api/rules/files 뒤에 그대로 붙이면 그림이 나온다
    image = admin_client.get(FILES + "/규칙%20abc123/image.png")
    assert image.status_code == 200 and image.content == PNG_B
    # 미리보기·관리자 화면은 규칙 페이지를 닫아 게시해도 그림을 볼 수 있다
    closed = {p: {"open": p != "rules", "note_ko": None, "note_en": None} for p in PAGES}
    admin_client.put("/api/admin/settings/pages", json=closed)
    admin_client.post("/api/admin/publish/settings")
    assert admin_client.get(FILES + "/규칙%20abc123/image.png").status_code == 404
    preview = admin_client.get("/api/admin/preview/rules/files/규칙%20abc123/image.png")
    assert preview.status_code == 200 and preview.content == PNG_B
    log = db.scalars(select(AuditLog).where(AuditLog.action == "import")).one()
    assert (log.after["source"], log.after["assets"], log.after["created"]) == ("package", 2, 2)


def test_markdown_in_subfolder_uses_its_folder_for_relative_paths(
    admin_client: TestClient, settings: Settings
) -> None:
    data = make_zip(
        {
            "docs/rules.md": "## 개요\n![a](img/a.png) ![b](../shared/b.png) ![c](/docs/img/a.png)",
            "docs/img/a.png": PNG_A,
            "shared/b.png": PNG_B,
        }
    )
    result = package_ok(admin_client, "ko", data)
    assert result["warnings"] == []
    assert bodies(admin_client) == [
        "![a](/docs/img/a.png) ![b](/shared/b.png) ![c](/docs/img/a.png)"
    ]
    assert stored(settings) == {"docs/img/a.png": PNG_A, "shared/b.png": PNG_B}


def test_absolute_os_paths_are_matched_by_suffix(
    admin_client: TestClient, settings: Settings
) -> None:
    markdown = (
        "## 차량\n\n"
        "![a](/Users/kim/Documents/규칙 패키지/images/car.png)\n"
        "![b](C:\\Users\\kim\\Docs\\규칙\\images\\track.jpg)\n"
        "![c](file:///Users/kim/Docs/%EA%B7%9C%EC%B9%99/images/flag%20(1).webp)\n"
        '![d](</Users/kim/Docs/규칙/images/flag (1).webp> "깃발")\n'
        "![e](file:///C:/Users/kim/Docs/IMAGES/CAR.PNG?raw=1#top)\n"
        "![f](\\\\server\\share\\규칙\\images\\track.jpg)\n"
        '<img src="C:/Users/kim/Docs/images/track.jpg" alt="t">\n'
        "[원본](/images/car.png)\n\n"
        "[ref]: D:/작업/images/car.png\n"
    )
    data = make_zip(
        {
            "패키지/rules.ko.md": markdown,
            "패키지/images/car.png": PNG_A,
            "패키지/images/track.jpg": JPG,
            "패키지/images/flag (1).webp": WEBP,
        }
    )
    result = package_ok(admin_client, "ko", data)
    assert result["warnings"] == []
    assert result["assets"] == 3
    assert bodies(admin_client) == [
        "![a](/images/car.png)\n"
        "![b](/images/track.jpg)\n"
        "![c](/images/flag%20%281%29.webp)\n"
        '![d](/images/flag%20%281%29.webp "깃발")\n'
        "![e](/images/car.png)\n"
        "![f](/images/track.jpg)\n"
        '<img src="/images/track.jpg" alt="t">\n'
        "[원본](/images/car.png)\n\n"
        "[ref]: /images/car.png"
    ]
    assert stored(settings) == {
        "images/car.png": PNG_A,
        "images/track.jpg": JPG,
        "images/flag (1).webp": WEBP,
    }
    webp = admin_client.get(FILES + "/images/flag%20%281%29.webp")
    assert webp.status_code == 200 and webp.headers["content-type"] == "image/webp"


def test_korean_percent_encoded_and_legacy_names(
    admin_client: TestClient, settings: Settings
) -> None:
    odd = "사진/50% 할인 #1 & 끝.png"
    markdown = (
        "## 개요\n\n"
        "![가](%EA%B7%B8%EB%A6%BC/%ED%95%9C%EA%B8%80%20%EC%9D%B4%EB%A6%84.png)\n"
        "![나](<사진/50%25 할인 %231 & 끝.png>)\n"
        "![다](자모.png)\n"
    )
    data = make_zip(
        {"rules.ko.md": markdown, odd: PNG_B, unicodedata.normalize("NFD", "자모.png"): PNG_C},
        (LegacyName("그림/한글 이름.png"), PNG_A),
    )
    result = package_ok(admin_client, "ko", data)
    assert result["warnings"] == []
    encoded_odd = encode_path(odd)
    assert encoded_odd == "/사진/50%25%20할인%20%231%20%26%20끝.png"
    assert bodies(admin_client) == [
        f"![가](/그림/한글%20이름.png)\n![나]({encoded_odd})\n![다](/자모.png)"
    ]
    assert stored(settings) == {"그림/한글 이름.png": PNG_A, odd: PNG_B, "자모.png": PNG_C}
    # 본문의 주소를 그대로 붙여서 받을 수 있다
    assert admin_client.get(FILES + encoded_odd).content == PNG_B
    assert admin_client.get(FILES + "/" + quote("그림/한글 이름.png")).content == PNG_A


def test_unresolved_and_unsupported_references_are_warnings(
    admin_client: TestClient, settings: Settings
) -> None:
    markdown = (
        "## 개요\n\n"
        "![없음](missing.png) ![로고](logo.svg) [문서](Sub%20page%20abc.md) [일정](/schedule)\n"
        "![같은 이름](dup.png) [외부](https://example.com/a.png) ![d](data:image/png;base64,AA)\n"
        "[메일](mailto:a@b.c) [앵커](#top)\n\n"
        "```\n![코드](missing-in-code.png)\n```\n\n`![코드](inline.png)`\n"
    )
    data = make_zip(
        {
            "rules.ko.md": markdown,
            "logo.svg": "<svg onload=alert(1)/>",
            "a/dup.png": PNG_A,
            "b/dup.png": PNG_B,
        }
    )
    result = package_ok(admin_client, "ko", data)
    assert result["assets"] == 0
    assert result["warnings"] == [
        "그림을 찾지 못해 주소를 그대로 두었습니다: missing.png",
        "그림 파일(png, jpg, gif, webp, avif)이 아니라 넣지 않았습니다(주소는 그대로): logo.svg",
        "링크가 가리키는 파일을 찾지 못해 주소를 그대로 두었습니다: Sub page abc.md",
        "그림을 찾지 못해 주소를 그대로 두었습니다: dup.png"
        " (이름이 같은 파일이 여러 개입니다: a/dup.png, b/dup.png)",
        "문서에서 쓰지 않는 그림이라 넣지 않았습니다(2개): a/dup.png, b/dup.png",
    ]
    # 본문은 그대로, SVG 는 저장하지 않는다
    assert bodies(admin_client) == [parse_document(markdown)[0].body]
    assert stored(settings) == {}


def test_markdown_count_rules(admin_client: TestClient) -> None:
    several = make_zip({"a.md": "## A", "b/rules.en.md": "## B"})
    detail = package_rejected(admin_client, several)
    assert "Markdown 문서가 여러 개입니다(a.md, b/rules.en.md)" in detail
    assert "rules.ko.md" in detail
    # 여러 개여도 rules.<lang>.md 가 하나 있으면 그것을 쓴다
    named = make_zip({"a.md": "## A", "x/rules.ko.md": "## 고른 문서", "x/c.markdown": "## C"})
    assert package_ok(admin_client, "ko", named)["sections"][0]["title_ko"] == "고른 문서"
    detail = package_rejected(admin_client, make_zip({"a.png": PNG_A, "b.txt": "x"}))
    assert "Markdown 문서(.md)가 없습니다" in detail and "a.png, b.txt" in detail
    not_utf8 = make_zip({"rules.ko.md": "## 개요".encode("cp949")})
    assert "UTF-8" in package_rejected(admin_client, not_utf8)
    assert "섹션이 없습니다" in package_rejected(admin_client, make_zip({"r.md": "본문만"}))


def test_zip_inside_zip(admin_client: TestClient, settings: Settings) -> None:
    inner = make_zip({"규칙.md": "## 개요\n![q](q.png)", "q.png": PNG_A})
    result = package_ok(admin_client, "ko", make_zip({"Export-Part-1.zip": inner}))
    assert bodies(admin_client) == ["![q](/q.png)"]
    assert result["assets"] == 1 and stored(settings) == {"q.png": PNG_A}


@pytest.mark.parametrize(
    "name", ["../evil.png", "/abs.png", "C:/evil.png", "a/../../evil.png", "..\\evil.png"]
)
def test_zip_slip_is_rejected(admin_client: TestClient, settings: Settings, name: str) -> None:
    admin_client.post(RULES, json={"title_ko": "그대로"})
    data = make_zip({"rules.ko.md": "## 개요\n![e](evil.png)", name: PNG_A})
    assert "허용하지 않는 경로" in package_rejected(admin_client, data)
    assert [s["title_ko"] for s in admin_client.get(RULES).json()] == ["그대로"]
    assert stored(settings) == {}
    assert not (settings.rules_dir.parent / "evil.png").exists()
    assert not list(settings.rules_dir.glob(".package-*"))


def test_bad_zips_are_rejected(
    admin_client: TestClient, settings: Settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    symlink = zipfile.ZipInfo("link.png")
    symlink.external_attr = (stat.S_IFLNK | 0o777) << 16
    md = {"rules.ko.md": "## 개요"}
    encrypted = set_flag(make_zip({**md, "secret.png": PNG_A}), "secret.png", 0x1)
    assert "심볼릭 링크" in package_rejected(admin_client, make_zip(md, (symlink, b"/etc/passwd")))
    assert "암호" in package_rejected(admin_client, encrypted)
    assert "ZIP 파일로 읽을 수 없습니다" in package_rejected(admin_client, b"## not a zip")
    assert "비어 있습니다" in package_rejected(admin_client, b"")
    many = make_zip({**md, **{f"f{n}.png": b"" for n in range(1000)}})
    assert "항목이 너무 많습니다(1,001개)" in package_rejected(admin_client, many)

    monkeypatch.setattr(rules_package, "MAX_UNCOMPRESSED_BYTES", 10_000)
    bomb = make_zip({**md, "big.png": b"\0" * 20_000})
    assert len(bomb) < 10_000
    assert "ZIP 을 풀면 너무 큽니다" in package_rejected(admin_client, bomb)

    monkeypatch.setattr(rules_package, "MAX_PACKAGE_BYTES", 1_000)
    response = put_package(admin_client, "ko", make_zip({**md, "x.png": os.urandom(2_000)}))
    assert response.status_code == 413
    assert response.json()["code"] == "PAYLOAD_TOO_LARGE"
    assert admin_client.get(RULES).json() == []
    assert stored(settings) == {}


def test_package_requires_admin_and_fetch_header(
    client: TestClient, referee_client: TestClient
) -> None:
    data = make_zip({"rules.ko.md": "## 개요"})
    assert put_package(referee_client, "ko", data).status_code == 403
    assert referee_client.get(PACKAGE, params={"lang": "ko"}).status_code == 403
    response = put_package(client, "ko", data, **{"X-Requested-With": ""})
    assert response.status_code == 403 and "X-Requested-With" in response.json()["detail"]
    assert put_package(referee_client, "fr", data).status_code in (403, 422)


def test_unauthenticated_package_upload(client: TestClient) -> None:
    response = put_package(client, "ko", b"PK", **{"X-Requested-With": "fetch"})
    assert response.status_code == 401


def test_package_import_broadcasts(admin_client: TestClient) -> None:
    with admin_client.websocket_connect("/ws/live") as ws:
        receive(ws)
        package_ok(admin_client, "ko", notion_zip())
        event = receive(ws)
        assert (event["type"], event["data"]) == ("content.updated", {"resource": "rules"})
        package_rejected(admin_client, b"not a zip")
        assert ping(ws)["type"] == "pong"


# ---- 저장된 그림: 내주기, 정리, 언어 사이 ----


def test_files_are_served_safely(admin_client: TestClient, settings: Settings) -> None:
    files = {"a.png": PNG_A, "b.jpg": JPG, "c.jpeg": JPG, "d.gif": b"GIF8", "e.avif": b"av"}
    markdown = "## 개요\n" + " ".join(f"![{name}]({name})" for name in files)
    package_ok(admin_client, "ko", make_zip({"rules.ko.md": markdown, **files}))
    types = {
        "a.png": "image/png",
        "b.jpg": "image/jpeg",
        "c.jpeg": "image/jpeg",
        "d.gif": "image/gif",
        "e.avif": "image/avif",
    }
    for name, media_type in types.items():
        response = admin_client.get(f"{FILES}/{name}")
        assert response.status_code == 200, name
        assert response.headers["content-type"] == media_type
        assert response.headers["cache-control"] == "no-cache"
        assert response.headers["x-content-type-options"] == "nosniff"
        assert response.content == files[name]

    root = settings.rules_dir / "files"
    (root / "notes.txt").write_text("secret")
    (root / "logo.svg").write_text("<svg/>")
    (root / "link.png").symlink_to(settings.rules_dir / "rules.ko.md")
    (settings.rules_dir / "outside.png").write_bytes(PNG_A)
    for path in (
        "notes.txt",
        "logo.svg",
        "missing.png",
        "link.png",
        "..%2foutside.png",
        "%2e%2e/outside.png",
        "sub/..%2f..%2foutside.png",
        "..%2f..%2frules%2frules.ko.md",
        "a.png%00.png",
    ):
        response = admin_client.get(f"{FILES}/{path}")
        assert response.status_code == 404, path
        assert response.json()["code"] == "NOT_FOUND"


def test_files_route_is_not_shadowed_by_spa(admin_client: TestClient, settings: Settings) -> None:
    dist = settings.frontend_dist
    dist.mkdir(parents=True)
    (dist / "index.html").write_text("<!doctype html><title>SPA</title>")
    package_ok(admin_client, "ko", make_zip({"r.md": "## A\n![a](a.png)", "a.png": PNG_A}))
    assert admin_client.get(f"{FILES}/a.png").content == PNG_A
    missing = admin_client.get(f"{FILES}/nope.png")
    assert missing.status_code == 404 and missing.json()["code"] == "NOT_FOUND"


def test_prune_removes_files_no_section_uses(admin_client: TestClient, settings: Settings) -> None:
    package_ok(
        admin_client,
        "ko",
        make_zip(
            {
                "r.md": "## 가\n![a](a.png)\n## 나\n![b](img/b.png)",
                "a.png": PNG_A,
                "img/b.png": PNG_B,
            }
        ),
    )
    package_ok(admin_client, "en", make_zip({"r.md": "## A\n![c](c.png)", "c.png": PNG_C}))
    assert set(stored(settings)) == {"a.png", "img/b.png", "c.png"}

    # 웹에서 본문을 고쳐도 바로 지우지는 않는다 (다음 가져오기 때 정리)
    second = admin_client.get(RULES).json()[1]
    patch = admin_client.patch(f"{RULES}/{second['id']}", json={"version": 1, "body_ko": "없음"})
    assert patch.status_code == 200
    assert set(stored(settings)) == {"a.png", "img/b.png", "c.png"}

    # 한국어를 다시 올리면 어느 본문도 쓰지 않는 b 가 지워지고 빈 폴더도 사라진다
    package_ok(admin_client, "ko", make_zip({"r.md": "## 가\n![a](a.png)\n## 나", "a.png": PNG_A}))
    assert set(stored(settings)) == {"a.png", "c.png"}
    assert not (settings.rules_dir / "files" / "img").exists()

    # 영어 문서만(그림 없이) 올리면 영어 본문만 쓰던 c 가 지워진다
    response = admin_client.put(DOCUMENT, json={"lang": "en", "markdown": "## A\nno picture"})
    assert response.status_code == 200 and response.json()["warnings"] == []
    assert set(stored(settings)) == {"a.png"}


def test_markdown_upload_resolves_stored_pictures(
    admin_client: TestClient, settings: Settings
) -> None:
    package_ok(admin_client, "ko", notion_zip())
    markdown = (
        "## 대회 개요\n![qr](dummy-qr.png)\n\n## 일정\n"
        "| 일차 | 내용 |\n| --- | --- |\n| 4 | 연습\nA조 |\n\n"
        "![image.png](C:\\Users\\kim\\Downloads\\image.png) ![x](nope.png)"
    )
    response = admin_client.put(DOCUMENT, json={"lang": "ko", "markdown": markdown})
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["assets"] == 2
    assert result["warnings"] == ["그림을 찾지 못해 주소를 그대로 두었습니다: nope.png"]
    assert bodies(admin_client) == [
        "![qr](/dummy-qr.png)",
        "| 일차 | 내용 |\n| --- | --- |\n| 4 | 연습<br>A조 |\n\n"
        "![image.png](/규칙%20abc123/image.png) ![x](nope.png)",
    ]
    assert set(stored(settings)) == {"dummy-qr.png", "규칙 abc123/image.png"}


def test_languages_do_not_overwrite_each_others_pictures(
    admin_client: TestClient, settings: Settings
) -> None:
    package_ok(admin_client, "ko", make_zip({"r.md": "## 가\n![i](image.png)", "image.png": PNG_A}))
    en = make_zip({"r.md": "## A\n![i](image.png)", "image.png": PNG_B})
    result = package_ok(admin_client, "en", en)
    [section] = result["sections"]
    renamed = section["body_en"].removeprefix("![i](/").removesuffix(")")
    assert renamed.startswith("image-") and renamed.endswith(".png") and len(renamed) == 18
    assert section["body_ko"] == "![i](/image.png)"
    assert stored(settings) == {"image.png": PNG_A, renamed: PNG_B}
    assert result["warnings"] == [
        f"다른 언어 문서가 쓰는 같은 이름의 그림과 내용이 달라 image.png 를 {renamed} 로"
        " 저장했습니다."
    ]
    # 같은 ZIP 을 다시 올려도 같은 이름이다
    again = package_ok(admin_client, "en", en)
    assert again["updated"] == 0 and again["sections"][0]["body_en"] == section["body_en"]
    # 내용이 같은 그림은 이름을 바꾸지 않는다
    same = package_ok(
        admin_client, "en", make_zip({"r.md": "## A\n![i](image.png)", "image.png": PNG_A})
    )
    assert same["sections"][0]["body_en"] == "![i](/image.png)" and same["warnings"] == []
    assert stored(settings) == {"image.png": PNG_A}
    # 한국어가 같은 이름의 새 그림을 올리면, 영어도 그 파일을 쓰므로 한국어 쪽 이름이 바뀐다
    ko = package_ok(
        admin_client, "ko", make_zip({"r.md": "## 가\n![i](image.png)", "image.png": PNG_C})
    )
    assert ko["sections"][0]["body_ko"] != "![i](/image.png)"
    assert stored(settings)["image.png"] == PNG_A


# ---- 내려받기 ----


def test_export_round_trip(admin_client: TestClient, settings: Settings) -> None:
    package_ok(admin_client, "ko", notion_zip())
    package_ok(
        admin_client,
        "en",
        make_zip({"en.md": "## Overview\n![qr](qr.png)\n## Schedule\nTBD", "qr.png": PNG_C}),
    )
    before = admin_client.get(RULES).json()

    for lang, expected in (
        ("ko", {"rules.ko.md", "dummy-qr.png", "규칙 abc123/image.png"}),
        ("en", {"rules.en.md", "qr.png"}),
    ):
        response = admin_client.get(PACKAGE, params={"lang": lang})
        assert response.status_code == 200
        assert response.headers["content-type"] == "application/zip"
        assert response.headers["content-disposition"] == f'attachment; filename="rules.{lang}.zip"'
        assert response.headers["cache-control"] == "no-store"
        with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
            names = set(archive.namelist())
            assert names == expected
            markdown = archive.read(f"rules.{lang}.md").decode("utf-8")
            assert markdown == (settings.rules_dir / f"rules.{lang}.md").read_text("utf-8")
            for name in names - {f"rules.{lang}.md"}:
                assert archive.read(name) == stored(settings)[name]

        result = package_ok(admin_client, lang, response.content)
        assert (result["created"], result["updated"], result["deleted"]) == (0, 0, 0)
        assert result["warnings"] == []
        assert admin_client.get(RULES).json() == before
    assert set(stored(settings)) == {"dummy-qr.png", "규칙 abc123/image.png", "qr.png"}
    # Markdown 만 내려받기도 그대로 있다
    document = admin_client.get(DOCUMENT, params={"lang": "ko"}).json()
    assert "![dummy-qr.png](/dummy-qr.png)" in document["markdown"]


# ---- CLI ----


def test_cli_imports_zip(settings: Settings, capsys: pytest.CaptureFixture[str]) -> None:
    assert cli.main(["seed-demo"], settings=settings) == 0
    path = settings.rules_dir.parent / "규칙.zip"
    path.write_bytes(notion_zip())
    assert cli.main(["import-rules", "--lang", "ko", "--file", str(path)], settings=settings) == 0
    out = capsys.readouterr().out
    assert "새 섹션 0, 바뀐 섹션 2, 지운 섹션 4, 그림 2개." in out
    assert "확인: 문서에서 쓰지 않는 그림이라 넣지 않았습니다(1개)" in out
    assert set(stored(settings)) == {"dummy-qr.png", "규칙 abc123/image.png"}
    assert "![dummy-qr.png](/dummy-qr.png)" in (settings.rules_dir / "rules.ko.md").read_text()

    path.write_bytes(make_zip({"../x.png": PNG_A, "r.md": "## A"}))
    assert cli.main(["import-rules", "--lang", "ko", "--file", str(path)], settings=settings) == 1
    assert "허용하지 않는 경로" in capsys.readouterr().err


# ---- 순수 함수 ----


def test_normalize_tables() -> None:
    markdown = (
        "| a | b | c |\n| --- | :-: | --- |\n"
        f"{NOTION_TABLE_ROW}\n"
        "| 6 | 셀 끝에 \\| 문자 \\|\n이어짐 |\n"
        "| 7 | 짧은 행 |\n\n"
        "```\n| a | b |\n|---|---|\n| 1 | 열린 칸\n닫힘 |\n```\n\n"
        "| x | y |\n|---|---|\n| 1 | 닫히지 않은 칸\n\n## 다음 섹션\n"
        "a | b\n--- | ---\n1 | 2\n"
    )
    assert normalize_tables(markdown) == (
        "| a | b | c |\n| --- | :-: | --- |\n"
        f"{JOINED_ROW}\n"
        "| 6 | 셀 끝에 \\| 문자 \\|<br>이어짐 |\n"
        "| 7 | 짧은 행 |\n\n"
        "```\n| a | b |\n|---|---|\n| 1 | 열린 칸\n닫힘 |\n```\n\n"
        "| x | y |\n|---|---|\n| 1 | 닫히지 않은 칸\n\n## 다음 섹션\n"
        "a | b\n--- | ---\n1 | 2\n"
    )


@pytest.mark.parametrize(
    ("url", "expected"),
    [
        ("images/qr.png", LocalPath(("images", "qr.png"), False, False)),
        ("./images/../qr.png?x=1#top", LocalPath(("images", "..", "qr.png"), False, False)),
        ("/images/%EA%B7%B8%EB%A6%BC%20(1).png", LocalPath(("images", "그림 (1).png"), True, True)),
        ("C:\\Users\\kim\\qr.png", LocalPath(("Users", "kim", "qr.png"), True, False)),
        ("file:///C:/Users/kim/qr.png", LocalPath(("Users", "kim", "qr.png"), True, False)),
        ("file:///home/kim/qr.png", LocalPath(("home", "kim", "qr.png"), True, True)),
        ("file://server/share/qr.png", LocalPath(("server", "share", "qr.png"), True, False)),
        ("\\\\server\\share\\qr.png", LocalPath(("server", "share", "qr.png"), True, False)),
        ("a\\_b.png", LocalPath(("a_b.png",), False, False)),
        ("a&amp;b.png", LocalPath(("a&b.png",), False, False)),
        ("https://example.com/qr.png", None),
        ("//cdn.example.com/qr.png", None),
        ("data:image/png;base64,AAAA", None),
        ("mailto:a@b.c", None),
        ("#section", None),
        ("", None),
        ("..", None),
    ],
)
def test_local_path(url: str, expected: LocalPath | None) -> None:
    assert local_path(url) == expected


def test_encode_path_is_a_plain_commonmark_destination() -> None:
    assert encode_path("images/qr.png") == "/images/qr.png"
    assert encode_path("규칙 (1)/a#b?c%d&e'f\"g<h>i\\j.png") == (
        "/규칙%20%281%29/a%23b%3Fc%25d%26e%27f%22g%3Ch%3Ei%5Cj.png"
    )
    assert encode_path("탭\t전각\u3000공백.png") == "/탭%09전각%E3%80%80공백.png"
    # 다시 읽으면 같은 경로
    path = "규칙 (1)/a#b?c%d&e.png"
    assert local_path(encode_path(path)) == LocalPath(tuple(path.split("/")), True, True)


def test_staging_folder_is_removed(admin_client: TestClient, settings: Settings) -> None:
    package_ok(admin_client, "ko", notion_zip())
    assert not list(settings.rules_dir.glob(".package-*"))
    assert (
        put_package(admin_client, "ko", make_zip({"r.md": "본문만", "a.png": PNG_A})).status_code
        == 422
    )
    assert not list(settings.rules_dir.glob(".package-*"))
