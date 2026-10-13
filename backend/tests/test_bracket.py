from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

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
    """팀 4개(앞의 timed 팀만 예선 기록) + 4강/3·4위전/결승 대진 + 시드 채우기.

    예선 순위는 팀 번호 순이다 (1번 팀이 1위).
    """
    ids = add_teams(app, 4)
    insert_laps(
        db, [(team_id, 40_000 + i * 1_000, "valid", i) for i, team_id in enumerate(ids)][:timed]
    )
    assert (
        client.post(f"{ADMIN}/bracket/generate", json={"size": 4, "third_place": True}).status_code
        == 201
    )
    assert client.post(f"{ADMIN}/bracket/seed-from-qualifying").status_code == 200
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


def test_seed_from_qualifying(app: FastAPI, admin_client: TestClient, db: Session) -> None:
    t1, t2, t3, t4 = setup_four(app, admin_client, db, timed=3)
    m = matches_by_label(admin_client)
    # 4위 기록이 없으면 비워 둔다
    assert team_ids(m["M1"]) == [t1, None]
    assert team_ids(m["M2"]) == [t2, t3]

    finish(admin_client, m["M2"], [1, 2])
    # 4번 팀이 1위가 되는 기록을 추가하고 다시 시드를 채운다
    insert_laps(db, [(t4, 30_000, "valid", 30)])
    response = admin_client.post(f"{ADMIN}/bracket/seed-from-qualifying")
    assert response.status_code == 200
    seeded = {m["label"]: m for r in response.json()["rounds"] for m in r["matches"]}
    assert team_ids(seeded["M1"]) == [t4, t3]  # 1위 t4, 4위 t3
    assert team_ids(seeded["M2"]) == [t2, t3]  # 종료된 매치는 그대로


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
    assert admin_client.post(f"{ADMIN}/bracket/generate", json={"size": 6}).status_code == 422


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
            ("POST", f"{ADMIN}/bracket/seed-from-qualifying", None),
            ("DELETE", f"{ADMIN}/bracket/matches/{m1['id']}", None),
        ]:
            assert referee.request(method, path, json=body).status_code == 403, path
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
    assert data["on_track_team"]["car_number"] == 1
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

    cleared = admin_client.put(f"{ADMIN}/live/state", json={"phase": "idle"}).json()
    assert (cleared["on_track_team"], cleared["current_match"], cleared["message_ko"]) == (
        None,
        None,
        None,
    )
