import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.errors import AppError
from app.services import bracket as bracket_service
from tests.conftest import add_teams, create_user, login
from tests.test_leaderboard import insert_laps

ADMIN = "/api/admin"


def bracket(client: TestClient) -> dict:
    response = client.get("/api/bracket")
    assert response.status_code == 200
    return response.json()


def matches_by_label(client: TestClient) -> dict[str, dict]:
    return {m["label"]: m for r in bracket(client)["rounds"] for m in r["matches"]}


def team_ids(match: dict) -> list[int | None]:
    return [slot["team"]["id"] if slot["team"] else None for slot in match["slots"]]


def setup_four(app: FastAPI, client: TestClient, db: Session, timed: int = 4) -> list[int]:
    """팀 4개(앞의 timed 팀만 랭킹에 넣음) + 4강/3·4위전/결승 대진 + 랭킹으로 시드 채우기.

    랭킹은 팀 번호 순이다 (1번 팀이 1위).
    """
    ids = add_teams(app, 4)
    insert_laps(db, [(team_id, "Q1", "valid", None) for team_id in ids[:timed]])
    assert (
        client.post(f"{ADMIN}/bracket/generate", json={"size": 4, "third_place": True}).status_code
        == 201
    )
    assert client.put(f"{ADMIN}/ranking", json={"team_ids": ids[:timed]}).status_code == 200
    assert client.post(f"{ADMIN}/bracket/seed-from-ranking").status_code == 200
    return ids


def finish(
    client: TestClient, match: dict, ranks: list[int], texts: list[str | None] | None = None
):
    texts = texts or [None] * len(ranks)
    results = [
        {"slot_id": slot["id"], "result_rank": rank, "result_text": text}
        for slot, rank, text in zip(match["slots"], ranks, texts, strict=True)
    ]
    return client.post(
        f"{ADMIN}/matches/{match['id']}/result",
        json={"version": match["version"], "results": results},
    )


def patch_slot(client: TestClient, slot_id: int, **body: object):
    return client.patch(f"{ADMIN}/bracket/slots/{slot_id}", json=body)


# ---- 결과와 진출 ----


def test_result_propagates_winner_and_loser(
    app: FastAPI, admin_client: TestClient, db: Session
) -> None:
    t1, t2, t3, t4 = setup_four(app, admin_client, db)
    m = matches_by_label(admin_client)
    assert team_ids(m["M1"]) == [t1, t4]  # 1위 vs 4위
    assert team_ids(m["M2"]) == [t2, t3]
    assert [s["source_match_label"] for s in m["M4"]["slots"]] == ["M1", "M2"]

    # 4위 팀이 이변으로 승리
    response = finish(admin_client, m["M1"], [2, 1], ["0:42.100", "0:41.900"])
    assert response.status_code == 200, response.text
    done = response.json()
    assert done["status"] == "finished"
    assert done["version"] == m["M1"]["version"] + 1
    assert [s["result_text"] for s in done["slots"]] == ["0:42.100", "0:41.900"]

    after = matches_by_label(admin_client)
    assert team_ids(after["M4"]) == [t4, None]  # 결승 0번 슬롯 = M1 1위
    assert team_ids(after["M3"]) == [t1, None]  # 3·4위전 0번 슬롯 = M1 2위
    assert after["M4"]["version"] > m["M4"]["version"]

    finish(admin_client, after["M2"], [1, 2])
    after = matches_by_label(admin_client)
    assert team_ids(after["M4"]) == [t4, t2]
    assert team_ids(after["M3"]) == [t1, t3]


def test_result_validation(app: FastAPI, admin_client: TestClient, db: Session) -> None:
    setup_four(app, admin_client, db)
    m = matches_by_label(admin_client)
    m1 = m["M1"]
    for ranks in ([1, 1], [1, 3], [0, 1]):
        response = finish(admin_client, m1, ranks)
        assert response.status_code == 422, ranks
    one_slot = {
        "version": m1["version"],
        "results": [{"slot_id": m1["slots"][0]["id"], "result_rank": 1}],
    }
    assert admin_client.post(f"{ADMIN}/matches/{m1['id']}/result", json=one_slot).status_code == 422
    stale = finish(admin_client, {**m1, "version": m1["version"] - 1}, [1, 2])
    assert stale.status_code == 409 and stale.json()["code"] == "VERSION_CONFLICT"
    # 팀이 정해지지 않은 결승은 결과를 넣을 수 없다
    assert finish(admin_client, m["M4"], [1, 2]).status_code == 422

    assert finish(admin_client, m1, [1, 2]).status_code == 200
    again = finish(admin_client, matches_by_label(admin_client)["M1"], [2, 1])
    assert again.status_code == 409 and again.json()["code"] == "MATCH_FINISHED"
    assert admin_client.post(f"{ADMIN}/matches/999/result", json=one_slot).status_code == 404


def test_reopen_clears_downstream_unless_finished(
    app: FastAPI, admin_client: TestClient, db: Session
) -> None:
    t1, t2, t3, t4 = setup_four(app, admin_client, db)
    m = matches_by_label(admin_client)
    not_finished = admin_client.post(f"{ADMIN}/matches/{m['M1']['id']}/reopen")
    assert not_finished.status_code == 409 and not_finished.json()["code"] == "MATCH_NOT_FINISHED"

    finish(admin_client, m["M1"], [1, 2])
    finish(admin_client, m["M2"], [1, 2])
    m = matches_by_label(admin_client)
    finish(admin_client, m["M4"], [1, 2])

    blocked = admin_client.post(f"{ADMIN}/matches/{m['M1']['id']}/reopen", json={})
    assert blocked.status_code == 409 and blocked.json()["code"] == "DOWNSTREAM_FINISHED"

    m = matches_by_label(admin_client)
    assert admin_client.post(f"{ADMIN}/matches/{m['M4']['id']}/reopen").status_code == 200
    stale = admin_client.post(f"{ADMIN}/matches/{m['M1']['id']}/reopen", json={"version": 1})
    assert stale.status_code == 409 and stale.json()["code"] == "VERSION_CONFLICT"
    reopened = admin_client.post(
        f"{ADMIN}/matches/{m['M1']['id']}/reopen", json={"version": m["M1"]["version"]}
    )
    assert reopened.status_code == 200
    body = reopened.json()
    assert body["status"] == "scheduled"
    assert [(s["result_rank"], s["result_text"]) for s in body["slots"]] == [(None, None)] * 2
    assert team_ids(body) == [t1, t4]  # 시드로 받은 팀은 그대로

    m = matches_by_label(admin_client)
    assert team_ids(m["M4"]) == [None, t2]
    assert team_ids(m["M3"]) == [None, t3]
    assert m["M4"]["status"] == "scheduled"


def test_seed_from_ranking(app: FastAPI, admin_client: TestClient, db: Session) -> None:
    t1, t2, t3, t4 = setup_four(app, admin_client, db, timed=3)
    m = matches_by_label(admin_client)
    # 4위 기록이 없으면 비워 둔다
    assert team_ids(m["M1"]) == [t1, None]
    assert team_ids(m["M2"]) == [t2, t3]

    # 경기 전에는 랭킹을 바꾸고 다시 채울 수 있다 (랭킹은 운영진이 직접 정한다)
    ranked = admin_client.put(f"{ADMIN}/ranking", json={"team_ids": [t4, t1, t2, t3]})
    assert [e["team"]["id"] for e in ranked.json()["entries"]] == [t4, t1, t2, t3]
    response = admin_client.post(f"{ADMIN}/bracket/seed-from-ranking")
    assert response.status_code == 200
    seeded = {m["label"]: m for r in response.json()["rounds"] for m in r["matches"]}
    assert team_ids(seeded["M1"]) == [t4, t3]
    assert team_ids(seeded["M2"]) == [t1, t2]

    # 경기가 하나라도 끝나면 다시 채울 수 없다 (칸이 옮겨 다니지 않게)
    finish(admin_client, seeded["M2"], [1, 2])
    admin_client.put(f"{ADMIN}/ranking", json={"team_ids": [t1, t2, t3, t4]})
    blocked = admin_client.post(f"{ADMIN}/bracket/seed-from-ranking")
    assert blocked.status_code == 409 and blocked.json()["code"] == "BRACKET_STARTED"
    m = matches_by_label(admin_client)
    assert team_ids(m["M1"]) == [t4, t3] and team_ids(m["M2"]) == [t1, t2]


def test_deactivated_team_leaves_ranking_and_bracket(
    app: FastAPI, admin_client: TestClient, db: Session
) -> None:
    """비활성화(기권)한 팀은 랭킹·끝나지 않은 매치·트랙 위에서 빠지고 다음 매치로 오르지 않는다."""
    t1, t2, t3, t4 = setup_four(app, admin_client, db)
    m = matches_by_label(admin_client)
    assert team_ids(m["M1"]) == [t1, t4] and team_ids(m["M2"]) == [t2, t3]
    live = {"phase": "bracket", "on_track_team_id": t1, "current_match_id": None}
    assert admin_client.put(f"{ADMIN}/live/state", json=live).status_code == 200
    assert finish(admin_client, m["M1"], [1, 2]).status_code == 200

    def winner_slot_of(label: str) -> tuple[str, int]:
        source = matches_by_label(admin_client)[label]["id"]
        for match in matches_by_label(admin_client).values():
            for index, slot in enumerate(match["slots"]):
                if slot["source_match_id"] == source and slot["source_rank"] == 1:
                    return match["label"], index
        raise AssertionError(label)

    final, index = winner_slot_of("M1")
    assert team_ids(matches_by_label(admin_client)[final])[index] == t1

    def deactivate(team_id: int) -> None:
        team = next(t for t in admin_client.get(f"{ADMIN}/teams").json() if t["id"] == team_id)
        body = {"version": team["version"], "is_active": False}
        assert admin_client.patch(f"{ADMIN}/teams/{team_id}", json=body).status_code == 200

    deactivate(t1)
    ranking = admin_client.get(f"{ADMIN}/ranking").json()["entries"]
    assert [(e["rank"], e["team"]["id"]) for e in ranking] == [(1, t2), (2, t3), (3, t4)]
    m = matches_by_label(admin_client)
    assert team_ids(m[final])[index] is None  # 결승 칸에서 빠짐
    assert team_ids(m["M1"]) == [t1, t4]  # 끝난 매치 결과는 기록으로 남음
    assert admin_client.get("/api/live/state").json()["on_track_team"] is None

    # 끝난 매치를 되돌리면 비활성 팀은 칸에서 빠지고, 남은 팀이 부전승으로 올라간다
    reopened = admin_client.post(f"{ADMIN}/matches/{m['M1']['id']}/reopen", json={})
    assert reopened.status_code == 200 and team_ids(reopened.json()) == [None, t4]
    t4_slot = reopened.json()["slots"][1]
    walkover = admin_client.post(
        f"{ADMIN}/matches/{m['M1']['id']}/result",
        json={
            "version": reopened.json()["version"],
            "results": [{"slot_id": t4_slot["id"], "result_rank": 1, "result_text": None}],
        },
    )
    assert walkover.status_code == 200, walkover.text
    assert team_ids(matches_by_label(admin_client)[final])[index] == t4

    # 끝나지 않은 매치에 있던 팀은 칸에서 빠지고, 상대가 부전승으로 올라간다 (규칙 5.1.3)
    deactivate(t2)
    m2 = matches_by_label(admin_client)["M2"]
    assert team_ids(m2) == [None, t3]
    # 경기가 시작된 뒤에는 당겨진 랭킹으로 시드를 다시 채우지 않는다 (t3 이 칸에서 빠지지 않게)
    assert admin_client.post(f"{ADMIN}/bracket/seed-from-ranking").status_code == 409
    alone = m2["slots"][1]
    walkover = admin_client.post(
        f"{ADMIN}/matches/{m2['id']}/result",
        json={"version": m2["version"], "results": [{"slot_id": alone["id"], "result_rank": 1}]},
    )
    assert walkover.status_code == 200, walkover.text
    # 비활성 팀은 다시 넣을 수 없다
    for body in ({"team_ids": [t1]}, {"team_ids": [t3, t2]}):
        assert admin_client.put(f"{ADMIN}/ranking", json=body).status_code == 422
    lap = {"team_id": t2, "mission": "Q3", "lap_time_ms": 42_000, "status": "valid"}
    assert admin_client.post(f"{ADMIN}/qualifying/laps", json=lap).status_code == 422
    assert [
        r["team"]["id"] for r in admin_client.get("/api/qualifying/leaderboard").json()["rows"]
    ] == [t3, t4]


def test_bye_walkover(app: FastAPI, admin_client: TestClient, db: Session) -> None:
    """빈 칸은 부전승: 앞으로도 채워지지 않는 칸이면 남은 팀만으로 끝낸다."""
    t1, t2, t3, t4 = setup_four(app, admin_client, db, timed=3)  # 4위 없음 → M1 은 t1 혼자
    m = matches_by_label(admin_client)
    assert team_ids(m["M1"]) == [t1, None]
    alone, empty = m["M1"]["slots"]

    def submit(match: dict, results: list[tuple[int, int]]):
        body = {
            "version": match["version"],
            "results": [
                {"slot_id": slot_id, "result_rank": rank, "result_text": None}
                for slot_id, rank in results
            ],
        }
        return admin_client.post(f"{ADMIN}/matches/{match['id']}/result", json=body)

    # 랭킹에 4위가 생겼는데 아직 시드를 안 채웠으면 그 칸은 곧 채워질 칸이라 막는다
    assert admin_client.put(f"{ADMIN}/ranking", json={"team_ids": [t1, t2, t3, t4]}).status_code
    waiting = submit(m["M1"], [(alone["id"], 1)])
    assert waiting.status_code == 422 and "시드" in waiting.json()["detail"]
    assert admin_client.put(f"{ADMIN}/ranking", json={"team_ids": [t1, t2, t3]}).status_code

    # 빈 칸에 결과를 넣거나 순위를 건너뛰면 안 된다
    assert submit(m["M1"], [(alone["id"], 1), (empty["id"], 2)]).status_code == 422
    assert submit(m["M1"], [(alone["id"], 2)]).status_code == 422
    assert submit(m["M1"], [(alone["id"], 1)]).status_code == 200

    # 앞 매치(M2)가 안 끝난 결승은 t1 혼자 있어도 끝낼 수 없다
    m = matches_by_label(admin_client)
    final = next(
        match
        for match in m.values()
        if any(
            s["source_match_id"] == m["M1"]["id"] and s["source_rank"] == 1 for s in match["slots"]
        )
    )
    assert team_ids(final).count(t1) == 1
    filled = next(s for s in final["slots"] if s["team"])
    blocked = submit(final, [(filled["id"], 1)])
    assert blocked.status_code == 422 and "앞 매치" in blocked.json()["detail"]


def test_both_teams_withdrawn(app: FastAPI, admin_client: TestClient, db: Session) -> None:
    """한 매치의 두 팀이 모두 기권하면 그 매치는 끝낼 수 없지만, 그 결과를 기다리던 다음 매치는
    남은 팀의 부전승으로 끝낼 수 있다."""
    t1, t2, t3, t4 = setup_four(app, admin_client, db)
    m = matches_by_label(admin_client)
    assert team_ids(m["M1"]) == [t1, t4] and team_ids(m["M2"]) == [t2, t3]
    for team_id in (t1, t4):
        team = next(t for t in admin_client.get(f"{ADMIN}/teams").json() if t["id"] == team_id)
        body = {"version": team["version"], "is_active": False}
        assert admin_client.patch(f"{ADMIN}/teams/{team_id}", json=body).status_code == 200
    assert finish(admin_client, m["M2"], [1, 2]).status_code == 200
    m = matches_by_label(admin_client)
    assert team_ids(m["M1"]) == [None, None]
    final = next(
        match
        for match in m.values()
        if any(
            s["source_match_id"] == m["M1"]["id"] and s["source_rank"] == 1 for s in match["slots"]
        )
    )
    filled = next(s for s in final["slots"] if s["team"])
    assert filled["team"]["id"] == t2
    walkover = admin_client.post(
        f"{ADMIN}/matches/{final['id']}/result",
        json={
            "version": final["version"],
            "results": [{"slot_id": filled["id"], "result_rank": 1}],
        },
    )
    assert walkover.status_code == 200, walkover.text


# ---- 슬롯 검증 ----


def make_round(client: TestClient, name: str = "임시 라운드") -> dict:
    response = client.post(f"{ADMIN}/bracket/rounds", json={"name_ko": name})
    assert response.status_code == 201
    return response.json()


def make_match(client: TestClient, round_id: int, label: str, slot_count: int = 2) -> dict:
    response = client.post(
        f"{ADMIN}/bracket/matches",
        json={"round_id": round_id, "label": label, "slot_count": slot_count},
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_cycles_and_self_reference_rejected(admin_client: TestClient) -> None:
    r = make_round(admin_client)
    m1, m2, m3 = (make_match(admin_client, r["id"], label) for label in ("M1", "M2", "M3"))
    assert (
        patch_slot(
            admin_client, m2["slots"][0]["id"], source_match_id=m1["id"], source_rank=1
        ).status_code
        == 200
    )
    assert (
        patch_slot(
            admin_client, m3["slots"][0]["id"], source_match_id=m2["id"], source_rank=1
        ).status_code
        == 200
    )

    self_ref = patch_slot(
        admin_client, m1["slots"][0]["id"], source_match_id=m1["id"], source_rank=1
    )
    assert self_ref.status_code == 422
    direct = patch_slot(admin_client, m1["slots"][0]["id"], source_match_id=m2["id"], source_rank=1)
    assert direct.status_code == 422
    indirect = patch_slot(
        admin_client, m1["slots"][1]["id"], source_match_id=m3["id"], source_rank=2
    )
    assert indirect.status_code == 422
    assert "순환" in indirect.json()["detail"]


def test_slot_validation(app: FastAPI, admin_client: TestClient) -> None:
    t1, t2, _ = add_teams(app, 3, inactive=(3,))
    r = make_round(admin_client)
    m1 = make_match(admin_client, r["id"], "M1")
    m2 = make_match(admin_client, r["id"], "M2")
    s0, s1 = (slot["id"] for slot in m2["slots"])

    both = patch_slot(admin_client, s0, seed_rank=1, source_match_id=m1["id"], source_rank=1)
    assert both.status_code == 422
    assert patch_slot(admin_client, s0, source_match_id=m1["id"]).status_code == 422
    assert patch_slot(admin_client, s0, source_rank=1).status_code == 422
    assert patch_slot(admin_client, s0, source_match_id=m1["id"], source_rank=3).status_code == 422
    assert patch_slot(admin_client, s0, source_match_id=999, source_rank=1).status_code == 422
    assert patch_slot(admin_client, s0, team_id=3).status_code == 422  # 비활성
    assert patch_slot(admin_client, s0, team_id=999).status_code == 422
    assert patch_slot(admin_client, s0, seed_rank=0).status_code == 422

    ok = patch_slot(admin_client, s0, team_id=t1, placeholder_ko="임시 자리", placeholder_en="")
    assert ok.status_code == 200
    assert ok.json()["version"] == m2["version"] + 1  # 슬롯이 바뀌면 매치 version 이 오른다
    slot = ok.json()["slots"][0]
    assert (slot["team"]["id"], slot["placeholder_ko"], slot["placeholder_en"]) == (
        t1,
        "임시 자리",
        None,
    )
    assert patch_slot(admin_client, s1, team_id=t1).status_code == 422  # 같은 매치에 같은 팀
    assert patch_slot(admin_client, s0, seed_rank=2).status_code == 200
    assert patch_slot(admin_client, s1, seed_rank=2).status_code == 422  # 같은 시드 중복

    # seed 에서 source 로 바꾸려면 seed_rank 를 함께 비운다
    switched = patch_slot(admin_client, s0, seed_rank=None, source_match_id=m1["id"], source_rank=1)
    assert switched.status_code == 200
    assert switched.json()["slots"][0]["source_match_label"] == "M1"
    # 출처 매치가 아직 안 끝났으므로 팀은 비워진다
    assert switched.json()["slots"][0]["team"] is None

    # 이미 끝난 매치를 출처로 연결하면 결과대로 채운다
    m3 = make_match(admin_client, r["id"], "M3")
    patch_slot(admin_client, m3["slots"][0]["id"], team_id=t1)
    m3 = patch_slot(admin_client, m3["slots"][1]["id"], team_id=t2).json()
    assert finish(admin_client, m3, [2, 1]).status_code == 200
    linked = patch_slot(admin_client, s1, source_match_id=m3["id"], source_rank=1)
    assert linked.json()["slots"][1]["team"]["id"] == t2

    finished_slot = patch_slot(admin_client, m3["slots"][0]["id"], team_id=None)
    assert finished_slot.status_code == 409 and finished_slot.json()["code"] == "MATCH_FINISHED"
    assert patch_slot(admin_client, 999, team_id=t1).status_code == 404


# ---- 라운드·매치 편집 ----


def test_match_crud(app: FastAPI, admin_client: TestClient) -> None:
    [t1] = add_teams(app, 1)
    r1 = make_round(admin_client, "임시 1라운드")
    r2 = make_round(admin_client, "임시 2라운드")
    assert (r1["sort_order"], r2["sort_order"]) == (1, 2)

    m1 = make_match(admin_client, r1["id"], "M1", slot_count=3)
    assert [s["slot_index"] for s in m1["slots"]] == [0, 1, 2]
    assert m1["status"] == "scheduled" and m1["sort_order"] == 1
    dup = admin_client.post(f"{ADMIN}/bracket/matches", json={"round_id": r1["id"], "label": "M1"})
    assert dup.status_code == 409 and dup.json()["code"] == "DUPLICATE"
    no_round = admin_client.post(f"{ADMIN}/bracket/matches", json={"round_id": 999, "label": "M9"})
    assert no_round.status_code == 422

    url = f"{ADMIN}/bracket/matches/{m1['id']}"
    live = admin_client.patch(
        url,
        json={
            "version": 1,
            "status": "live",
            "label": "QF1",
            "round_id": r2["id"],
            "scheduled_at": "2026-11-01T10:00:00+09:00",
        },
    )
    assert live.status_code == 200, live.text
    assert (live.json()["status"], live.json()["label"], live.json()["round_id"]) == (
        "live",
        "QF1",
        r2["id"],
    )
    assert live.json()["scheduled_at"] == "2026-11-01T01:00:00Z"
    assert admin_client.patch(url, json={"version": 2, "status": "finished"}).status_code == 422
    assert admin_client.patch(url, json={"version": 1, "label": "X"}).status_code == 409

    grown = admin_client.patch(url, json={"version": 2, "slot_count": 4}).json()
    assert len(grown["slots"]) == 4
    patch_slot(admin_client, grown["slots"][3]["id"], team_id=t1)
    blocked = admin_client.patch(url, json={"version": 4, "slot_count": 2})
    assert blocked.status_code == 422
    patch_slot(admin_client, grown["slots"][3]["id"], team_id=None)
    shrunk = admin_client.patch(url, json={"version": 5, "slot_count": 2})
    assert shrunk.status_code == 200 and len(shrunk.json()["slots"]) == 2

    # 이 매치를 출처로 쓰는 슬롯은 매치가 지워지면 출처를 잃는다
    m2 = make_match(admin_client, r2["id"], "M2")
    patch_slot(admin_client, m2["slots"][0]["id"], source_match_id=m1["id"], source_rank=1)
    admin_client.put(f"{ADMIN}/live/state", json={"phase": "bracket", "current_match_id": m1["id"]})
    assert admin_client.delete(url).status_code == 204
    m2_after = matches_by_label(admin_client)["M2"]
    assert (m2_after["slots"][0]["source_match_id"], m2_after["slots"][0]["source_rank"]) == (
        None,
        None,
    )
    assert admin_client.get("/api/live/state").json()["current_match"] is None
    assert admin_client.delete(url).status_code == 404


def test_round_update_and_cascade_delete(admin_client: TestClient) -> None:
    r1 = make_round(admin_client)
    r2 = make_round(admin_client, "임시 결승")
    m1 = make_match(admin_client, r1["id"], "M1")
    m2 = make_match(admin_client, r2["id"], "M2")
    patch_slot(admin_client, m2["slots"][0]["id"], source_match_id=m1["id"], source_rank=1)

    renamed = admin_client.patch(
        f"{ADMIN}/bracket/rounds/{r1['id']}", json={"name_en": "Temporary round", "sort_order": 5}
    )
    assert renamed.status_code == 200 and renamed.json()["name_en"] == "Temporary round"
    assert [r["id"] for r in admin_client.get(f"{ADMIN}/bracket/rounds").json()] == [
        r2["id"],
        r1["id"],
    ]

    assert admin_client.delete(f"{ADMIN}/bracket/rounds/{r1['id']}").status_code == 204
    rounds = bracket(admin_client)["rounds"]
    assert [r["id"] for r in rounds] == [r2["id"]]
    assert rounds[0]["matches"][0]["slots"][0]["source_match_id"] is None
    # 지워진 매치의 라벨은 다시 쓸 수 있다
    make_match(admin_client, r2["id"], "M1")


def test_generate_single_elimination(admin_client: TestClient) -> None:
    response = admin_client.post(f"{ADMIN}/bracket/generate", json={"size": 8})
    assert response.status_code == 201
    rounds = response.json()["rounds"]
    assert [(r["name_ko"], r["name_en"], len(r["matches"])) for r in rounds] == [
        ("8강", "Quarterfinal", 4),
        ("4강", "Semifinal", 2),
        ("결승", "Final", 1),
    ]
    seeds = [[s["seed_rank"] for s in m["slots"]] for m in rounds[0]["matches"]]
    assert seeds == [[1, 8], [4, 5], [2, 7], [3, 6]]
    final = rounds[2]["matches"][0]
    assert [(s["source_match_label"], s["source_rank"]) for s in final["slots"]] == [
        ("M5", 1),
        ("M6", 1),
    ]

    again = admin_client.post(f"{ADMIN}/bracket/generate", json={"size": 4})
    assert again.status_code == 409 and again.json()["code"] == "BRACKET_EXISTS"
    for bad in (6, 32):  # 참가 팀이 최대 15팀이라 16강까지
        assert admin_client.post(f"{ADMIN}/bracket/generate", json={"size": bad}).status_code == 422


# ---- 칸 자리 바꾸기 (관리자 화면에서 끌어 놓기) ----


def swap_body(match: dict, index: int, target: dict, target_index: int) -> dict:
    return {
        "slot_id": match["slots"][index]["id"],
        "target_slot_id": target["slots"][target_index]["id"],
        "version": match["version"],
        "target_version": target["version"],
    }


def swap(client: TestClient, match: dict, index: int, target: dict, target_index: int):
    return client.post(
        f"{ADMIN}/bracket/slots/swap", json=swap_body(match, index, target, target_index)
    )


def test_swap_moves_team_with_its_seed(app: FastAPI, admin_client: TestClient, db: Session):
    t1, t2, t3, t4 = setup_four(app, admin_client, db)
    m = matches_by_label(admin_client)
    assert team_ids(m["M1"]) == [t1, t4] and team_ids(m["M2"]) == [t2, t3]

    response = swap(admin_client, m["M1"], 1, m["M2"], 0)
    assert response.status_code == 200, response.text
    swapped = {x["label"]: x for r in response.json()["rounds"] for x in r["matches"]}
    assert team_ids(swapped["M1"]) == [t1, t2] and team_ids(swapped["M2"]) == [t4, t3]
    # '예선 N위' 표시가 팀을 따라가서, 경기 전에 시드를 다시 채워도 옮긴 자리가 유지된다
    assert [s["seed_rank"] for s in swapped["M1"]["slots"]] == [1, 2]
    assert [s["seed_rank"] for s in swapped["M2"]["slots"]] == [4, 3]
    assert swapped["M1"]["version"] == m["M1"]["version"] + 1
    assert swapped["M2"]["version"] == m["M2"]["version"] + 1
    assert admin_client.post(f"{ADMIN}/bracket/seed-from-ranking").status_code == 200
    m2 = matches_by_label(admin_client)
    assert team_ids(m2["M1"]) == [t1, t2] and team_ids(m2["M2"]) == [t4, t3]
    logs = admin_client.get(f"{ADMIN}/audit").json()["items"]
    # 이미 맞는 자리라 시드 채우기는 바꾼 것이 없어 기록도 없다
    assert [log["action"] for log in logs[:2]] == ["swap", "swap"]

    # 낡은 화면에서 옮기면 막는다
    stale = swap(admin_client, m["M1"], 0, m["M2"], 1)
    assert stale.status_code == 409 and stale.json()["code"] == "VERSION_CONFLICT"
    # 같은 매치 안에서는 칸 순서만 바뀐다
    same = swap(admin_client, m2["M2"], 0, m2["M2"], 1)
    assert same.status_code == 200
    assert team_ids(matches_by_label(admin_client)["M2"]) == [t3, t4]

    # 끝난 매치의 칸은 결과를 되돌리기 전에는 옮길 수 없다
    m = matches_by_label(admin_client)
    assert finish(admin_client, m["M1"], [1, 2]).status_code == 200
    m = matches_by_label(admin_client)
    blocked = swap(admin_client, m["M2"], 0, m["M1"], 1)
    assert blocked.status_code == 409 and blocked.json()["code"] == "MATCH_FINISHED"
    assert team_ids(matches_by_label(admin_client)["M2"]) == [t3, t4]


def test_swap_moves_result_link(app: FastAPI, admin_client: TestClient, db: Session):
    """앞 매치 결과를 받는 칸은 결과 연결째 옮겨져, 되돌리기·다시 입력도 옮긴 칸을 따라간다."""
    t1, t2, t3, t4 = setup_four(app, admin_client, db)
    m = matches_by_label(admin_client)
    finish(admin_client, m["M1"], [2, 1])  # t4 승
    m = matches_by_label(admin_client)
    final, third = m["M4"], m["M3"]
    assert team_ids(final) == [t4, None] and team_ids(third) == [t1, None]

    # 결승의 'M1 승' 칸과 3·4위전의 'M2 패' 칸을 바꾼다
    assert swap(admin_client, final, 0, third, 1).status_code == 200
    m = matches_by_label(admin_client)
    assert team_ids(m["M4"]) == [None, None] and team_ids(m["M3"]) == [t1, t4]
    assert [s["source_match_label"] for s in m["M3"]["slots"]] == ["M1", "M1"]

    assert admin_client.post(f"{ADMIN}/matches/{m['M1']['id']}/reopen").status_code == 200
    m = matches_by_label(admin_client)
    assert team_ids(m["M3"]) == [None, None]
    finish(admin_client, m["M1"], [1, 2])  # 이번엔 t1 승
    finish(admin_client, matches_by_label(admin_client)["M2"], [1, 2])  # t2 승, t3 패
    m = matches_by_label(admin_client)
    assert team_ids(m["M3"]) == [t4, t1] and team_ids(m["M4"]) == [t3, t2]


def test_swap_validation(admin_client: TestClient, app: FastAPI, db: Session) -> None:
    setup_four(app, admin_client, db)
    m = matches_by_label(admin_client)
    same = swap(admin_client, m["M1"], 0, m["M1"], 0)
    assert same.status_code == 422
    # 'M1 승' 칸을 M1 안으로 옮기면 M1 이 자기 결과를 기다리게 된다
    cycle = swap(admin_client, m["M4"], 0, m["M1"], 0)
    assert cycle.status_code == 422 and "자기 결과" in cycle.json()["detail"]
    missing = admin_client.post(
        f"{ADMIN}/bracket/slots/swap", json={**swap_body(m["M1"], 0, m["M2"], 0), "slot_id": 999}
    )
    assert missing.status_code == 404

    r = make_round(admin_client)
    a, b = make_match(admin_client, r["id"], "A"), make_match(admin_client, r["id"], "B")
    for match, seeds in ((a, (5, 6)), (b, (5, 7))):
        for slot, seed in zip(match["slots"], seeds, strict=True):
            assert patch_slot(admin_client, slot["id"], seed_rank=seed).status_code == 200
    m = matches_by_label(admin_client)
    duplicate = swap(admin_client, m["A"], 1, m["B"], 0)
    assert duplicate.status_code == 422 and "예선 순위" in duplicate.json()["detail"]
    # 거절되면 아무것도 바뀌지 않는다
    after = matches_by_label(admin_client)
    assert after["A"] == m["A"] and after["B"] == m["B"]


def test_referee_permissions_on_bracket(
    app: FastAPI, admin_client: TestClient, db: Session
) -> None:
    setup_four(app, admin_client, db)
    m1 = matches_by_label(admin_client)["M1"]
    create_user(app, "referee1", "referee")
    with TestClient(app, headers={"X-Requested-With": "fetch"}) as referee:
        login(referee, "referee1")
        for method, path, body in [
            ("POST", f"{ADMIN}/bracket/rounds", {"name_ko": "x"}),
            ("PATCH", f"{ADMIN}/bracket/matches/{m1['id']}", {"version": 1}),
            ("PATCH", f"{ADMIN}/bracket/slots/{m1['slots'][0]['id']}", {"team_id": None}),
            ("DELETE", f"{ADMIN}/bracket/matches/{m1['id']}", None),
            ("POST", f"{ADMIN}/bracket/slots/swap", swap_body(m1, 0, m1, 1)),
        ]:
            assert referee.request(method, path, json=body).status_code == 403, path
        # 랭킹과 시드 채우기는 모니터링 관리 기능이라 심판도 쓴다
        assert referee.post(f"{ADMIN}/bracket/seed-from-ranking").status_code == 200
        assert finish(referee, m1, [1, 2]).status_code == 200
        assert referee.post(f"{ADMIN}/matches/{m1['id']}/reopen").status_code == 200


# ---- 진행 상태 ----


def test_live_state(app: FastAPI, admin_client: TestClient) -> None:
    t1, _ = add_teams(app, 2, inactive=(2,))
    initial = admin_client.get("/api/live/state")
    assert initial.headers["cache-control"] == "no-store"
    assert initial.json()["phase"] == "idle"
    assert initial.json()["on_track_team"] is None

    r = make_round(admin_client)
    m1 = make_match(admin_client, r["id"], "M1")
    body = {
        "phase": "bracket",
        "on_track_team_id": t1,
        "current_match_id": m1["id"],
        "message_ko": "임시 공지",
        "message_en": "  ",
    }
    state = admin_client.put(f"{ADMIN}/live/state", json=body)
    assert state.status_code == 200
    data = state.json()
    assert data["phase"] == "bracket"
    assert data["on_track_team"]["id"] == 1
    assert data["current_match"] == {"id": m1["id"], "label": "M1"}
    assert (data["message_ko"], data["message_en"]) == ("임시 공지", None)
    assert admin_client.get("/api/live/state").json() == data

    for bad in (
        {"phase": "racing"},
        {"phase": "idle", "on_track_team_id": 2},
        {"phase": "idle", "on_track_team_id": 999},
        {"phase": "idle", "current_match_id": 999},
    ):
        assert admin_client.put(f"{ADMIN}/live/state", json=bad).status_code == 422, bad

    # 연습 주행: 트랙 위 팀을 보일 수 있다
    practice = admin_client.put(
        f"{ADMIN}/live/state", json={"phase": "practice", "on_track_team_id": t1}
    )
    assert practice.status_code == 200
    assert admin_client.get("/api/live/state").json()["phase"] == "practice"
    mapping = admin_client.put(f"{ADMIN}/live/state", json={"phase": "mapping"})
    assert mapping.status_code == 200 and mapping.json()["phase"] == "mapping"

    cleared = admin_client.put(f"{ADMIN}/live/state", json={"phase": "idle"}).json()
    assert (cleared["on_track_team"], cleared["current_match"], cleared["message_ko"]) == (
        None,
        None,
        None,
    )


def test_reopen_current_match_stays_live(app: FastAPI, admin_client: TestClient, db: Session):
    setup_four(app, admin_client, db)
    m1 = matches_by_label(admin_client)["M1"]
    body = {"phase": "bracket", "on_track_team_id": None, "current_match_id": m1["id"]}
    assert admin_client.put(f"{ADMIN}/live/state", json=body).status_code == 200
    m1 = matches_by_label(admin_client)["M1"]
    assert finish(admin_client, m1, [1, 2]).status_code == 200
    reopened = admin_client.post(f"{ADMIN}/matches/{m1['id']}/reopen", json={})
    assert reopened.json()["status"] == "live"  # 아직 진행 중 매치로 골라 둔 상태


# ---- 결과 동결 ----


def test_freeze_locks_bracket(app: FastAPI, admin_client: TestClient, db: Session) -> None:
    t1, t2, t3, t4 = setup_four(app, admin_client, db)
    m = matches_by_label(admin_client)
    finish(admin_client, m["M1"], [1, 2])
    finish(admin_client, m["M2"], [2, 1])
    assert admin_client.get("/api/live/state").json()["bracket_frozen"] is False

    with app.state.session_factory() as session:
        bracket_service.freeze(session, None)
        session.commit()

    assert admin_client.get("/api/live/state").json()["bracket_frozen"] is True
    before = bracket(admin_client)
    m = matches_by_label(admin_client)
    round_id = before["rounds"][0]["id"]
    slot_id = m["M4"]["slots"][0]["id"]
    # 결과 입력·되돌리기, 대진 편집, 시드 채우기 모두 막는다
    for response in (
        finish(admin_client, m["M4"], [1, 2]),
        admin_client.post(f"{ADMIN}/matches/{m['M1']['id']}/reopen", json={}),
        admin_client.post(f"{ADMIN}/bracket/seed-from-ranking"),
        admin_client.post(f"{ADMIN}/bracket/generate", json={"size": 4}),
        admin_client.post(f"{ADMIN}/bracket/rounds", json={"name_ko": "임시"}),
        admin_client.patch(f"{ADMIN}/bracket/rounds/{round_id}", json={"name_ko": "임시"}),
        admin_client.delete(f"{ADMIN}/bracket/rounds/{round_id}"),
        admin_client.post(
            f"{ADMIN}/bracket/matches", json={"round_id": round_id, "label": "X1", "slot_count": 2}
        ),
        admin_client.patch(
            f"{ADMIN}/bracket/matches/{m['M4']['id']}",
            json={"version": m["M4"]["version"], "label": "X2"},
        ),
        admin_client.delete(f"{ADMIN}/bracket/matches/{m['M4']['id']}"),
        patch_slot(admin_client, slot_id, team_id=None),
        swap(admin_client, m["M3"], 0, m["M4"], 0),
    ):
        assert response.status_code == 409, response.text
        assert response.json()["code"] == "BRACKET_FROZEN"
    logs = admin_client.get(f"{ADMIN}/audit").json()["items"]
    assert logs[0]["action"] == "bracket_freeze"
    with app.state.session_factory() as session, pytest.raises(AppError):
        bracket_service.freeze(session, None)

    # 기권(비활성화)해도 끝나지 않은 매치의 칸을 그대로 둔다
    team = next(t for t in admin_client.get(f"{ADMIN}/teams").json() if t["id"] == t1)
    body = {"version": team["version"], "is_active": False}
    assert admin_client.patch(f"{ADMIN}/teams/{t1}", json=body).status_code == 200
    assert team_ids(matches_by_label(admin_client)["M4"]) == [t1, t3]
    after = bracket(admin_client)
    assert [[x["version"] for x in r["matches"]] for r in after["rounds"]] == [
        [x["version"] for x in r["matches"]] for r in before["rounds"]
    ]


def test_freeze_needs_bracket(app: FastAPI) -> None:
    with app.state.session_factory() as session, pytest.raises(AppError):
        bracket_service.freeze(session, None)
