"""일정 Markdown 문서: 내려받기 → 고치기 → 올리기. 한 문서에 한국어·영어를 함께 쓴다."""

from fastapi.testclient import TestClient

from tests.conftest import publish

URL = "/api/admin/schedule/document"

DOC = """# 임시 일정 문서

> 첫 날짜 줄 위의 글은 무시한다

## 2026-11-01 (일)

### 09:00-10:00 임시 등록
- 장소: 임시 피트
- 영문: Temporary registration
- 영문 장소: Temporary pit
- 영문 설명: First line
  second line
임시 설명 첫 줄
임시 설명 둘째 줄

### 09:00 임시 같은 시각 <!-- hidden -->

## 2026-11-02

### 23:30-23:59 임시 마지막
"""


def test_import_and_export_round_trip(admin_client: TestClient) -> None:
    old = admin_client.post(
        "/api/admin/schedule", json={"starts_at": "2026-10-01T00:00:00Z", "title_ko": "임시 예전"}
    )
    assert old.status_code == 201
    result = admin_client.put(URL, json={"markdown": DOC})
    assert result.status_code == 200, result.text
    data = result.json()
    assert (data["created"], data["deleted"]) == (3, 1)
    first, same_time, last = data["items"]
    assert first["starts_at"] == "2026-11-01T00:00:00Z"  # 서울 09:00
    assert first["ends_at"] == "2026-11-01T01:00:00Z"
    assert (first["location_ko"], first["title_en"], first["location_en"]) == (
        "임시 피트",
        "Temporary registration",
        "Temporary pit",
    )
    assert first["description_ko"] == "임시 설명 첫 줄\n임시 설명 둘째 줄"
    assert first["description_en"] == "First line\nsecond line"
    # 같은 시각은 문서 순서, 비공개 표시
    assert same_time["title_ko"] == "임시 같은 시각" and same_time["is_published"] is False
    assert same_time["sort_order"] > first["sort_order"]
    assert last["ends_at"] == "2026-11-02T14:59:00Z"

    # 내려받은 문서를 그대로 다시 올리면 같은 일정이 된다
    exported = admin_client.get(URL).json()
    assert exported["filename"] == "schedule.md"
    assert "## 2026-11-01 (일)" in exported["markdown"]
    assert "### 09:00 임시 같은 시각 <!-- hidden -->" in exported["markdown"]
    again = admin_client.put(URL, json={"markdown": exported["markdown"]}).json()
    keys = ("starts_at", "ends_at", "title_ko", "title_en", "location_ko", "location_en")
    keys += ("description_ko", "description_en", "is_published")
    assert [{k: i[k] for k in keys} for i in again["items"]] == [
        {k: i[k] for k in keys} for i in data["items"]
    ]

    # 초안이다: 게시해야 공개 일정에 보인다
    assert admin_client.get("/api/schedule").json() == []
    publish(admin_client, "schedule")
    assert [i["title_ko"] for i in admin_client.get("/api/schedule").json()] == [
        "임시 등록",
        "임시 마지막",
    ]
    log = admin_client.get("/api/admin/audit").json()["items"]
    assert any(e["action"] == "import" and e["entity"] == "schedule_items" for e in log)


def test_format_errors_name_the_line(admin_client: TestClient) -> None:
    cases = {
        "### 09:00 날짜 없음": "1번째 줄",
        "## 11월 1일\n### 09:00 x": "날짜 줄은",
        "## 2026-02-30\n### 09:00 x": "없는 날짜",
        "## 2026-11-01\n### 9시 x": "2번째 줄",
        "## 2026-11-01\n### 10:00-09:00 x": "끝 시각",
        "## 2026-11-01\n### 25:00 x": "없는 시각",
        "## 2026-11-01\n### 09:00 " + "가" * 201: "넣을 수 없습니다",
    }
    for doc, expected in cases.items():
        response = admin_client.put(URL, json={"markdown": doc})
        assert response.status_code == 422, doc
        assert expected in response.json()["detail"], (doc, response.json()["detail"])
    # 실패하면 아무것도 바뀌지 않는다
    assert admin_client.get("/api/admin/schedule").json() == []


def test_needs_admin(referee_client: TestClient) -> None:
    assert referee_client.get(URL).status_code == 403
    assert referee_client.put(URL, json={"markdown": ""}).status_code == 403


def test_midnight_end_time(admin_client: TestClient) -> None:
    doc = "## 2026-11-01\n### 22:00-24:00 임시 자유 연습\n"
    item = admin_client.put(URL, json={"markdown": doc}).json()["items"][0]
    assert item["ends_at"] == "2026-11-01T15:00:00Z"  # 서울 11월 2일 00:00
    assert "### 22:00-24:00 임시 자유 연습" in admin_client.get(URL).json()["markdown"]
    assert (
        admin_client.put(URL, json={"markdown": "## 2026-11-01\n### 22:00-24:30 x"}).status_code
        == 422
    )
