import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.errors import AppError
from app.schemas.competition import AwardItem
from app.services import results
from tests.conftest import add_teams

ADMIN = "/api/admin"


def write(app: FastAPI, items: list[tuple[int, str]]) -> None:
    with app.state.session_factory() as db:
        results.write_awards(db, [AwardItem(team_id=t, award=a) for t, a in items], None)
        db.commit()


def test_results_empty_until_written(client: TestClient) -> None:
    response = client.get("/api/results")
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    assert response.json() == {"entries": []}


def test_results_group_by_award(app: FastAPI, client: TestClient, admin_client: TestClient) -> None:
    t1, t2, t3, t4 = add_teams(app, 4)
    # 상은 대상 → 최우수상 → 우수상 순, 같은 상 안에서는 적은 순서대로 (팀 번호 순이 아니다)
    write(app, [(t4, "merit"), (t2, "grand"), (t3, "merit"), (t1, "excellence")])
    entries = client.get("/api/results").json()["entries"]
    assert [(e["award"], [t["id"] for t in e["teams"]]) for e in entries] == [
        ("grand", [t2]),
        ("excellence", [t1]),
        ("merit", [t4, t3]),
    ]
    # 순위는 내지 않는다
    assert set(entries[0]) == {"award", "teams"}
    assert set(entries[0]["teams"][0]) == {
        "id",
        "name_ko",
        "name_en",
        "affiliation_ko",
        "affiliation_en",
    }
    logs = admin_client.get(f"{ADMIN}/audit").json()["items"]
    assert (logs[0]["action"], logs[0]["entity"]) == ("update", "awards")

    # 통째로 바꾸고, 받은 팀이 없는 상은 빠진다
    write(app, [(t1, "merit")])
    entries = client.get("/api/results").json()["entries"]
    assert [(e["award"], [t["id"] for t in e["teams"]]) for e in entries] == [("merit", [t1])]


@pytest.mark.parametrize(
    "items",
    [
        [(1, "grand"), (1, "merit")],  # 같은 팀 두 번
        [(99, "grand")],  # 없는 팀
    ],
)
def test_results_validation(app: FastAPI, items: list[tuple[int, str]]) -> None:
    add_teams(app, 2)
    with pytest.raises(AppError):
        write(app, items)
