import json
import sqlite3
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app import cli
from app.config import Settings
from app.main import create_app
from app.models import AuditLog, QualifyingLap, User
from tests.conftest import login


def run(settings: Settings, *argv: str) -> int:
    return cli.main(list(argv), settings=settings)


def fake_getpass(monkeypatch: pytest.MonkeyPatch, *answers: str) -> None:
    replies = iter(answers)
    monkeypatch.setattr(cli, "getpass", lambda prompt="": next(replies))


def test_create_user(settings: Settings, monkeypatch: pytest.MonkeyPatch, capsys) -> None:
    fake_getpass(monkeypatch, "first-admin-pw", "first-admin-pw")
    assert run(settings, "create-user", "--username", "admin1", "--role", "admin") == 0

    fake_getpass(monkeypatch, "first-admin-pw", "different-pw")
    assert run(settings, "create-user", "--username", "admin2", "--role", "admin") == 1
    fake_getpass(monkeypatch, "short", "short")
    assert run(settings, "create-user", "--username", "admin2", "--role", "admin") == 1
    fake_getpass(monkeypatch, "another-long-pw", "another-long-pw")
    assert run(settings, "create-user", "--username", "admin1", "--role", "referee") == 1
    assert "이미 있는 아이디" in capsys.readouterr().err

    app = create_app(settings)
    with TestClient(app) as client:
        assert login(client, "admin1", "first-admin-pw").json()["role"] == "admin"
    with app.state.session_factory() as db:
        assert db.scalar(select(func.count()).select_from(User)) == 1
        log = db.scalar(select(AuditLog).where(AuditLog.action == "create"))
        assert log.user_id is None and "password_hash" not in log.after
    app.state.engine.dispose()


def test_commands_require_migrated_db(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    settings = Settings(
        _env_file=None,
        database_url=f"sqlite:///{tmp_path / 'empty.db'}",
        rules_dir=tmp_path / "rules",
    )
    fake_getpass(monkeypatch, "first-admin-pw", "first-admin-pw")
    assert run(settings, "create-user", "--username", "admin1", "--role", "admin") == 1
    assert run(settings, "seed-demo") == 1


def test_seed_demo(settings: Settings) -> None:
    assert run(settings, "seed-demo") == 0
    assert run(settings, "seed-demo") == 1  # 비어 있지 않으면 거부
    assert run(settings, "seed-demo", "--force") == 0
    production = settings.model_copy(update={"app_env": "production"})
    assert run(production, "seed-demo", "--force") == 1

    app = create_app(settings)
    with TestClient(app) as client:
        teams = client.get("/api/teams").json()
        assert [t["name_ko"] for t in teams] == [f"Mock Team {n:02d}" for n in range(1, 13)]
        assert {t["affiliation_ko"] for t in teams} == {"Mock University"}

        rows = client.get("/api/qualifying/leaderboard").json()["rows"]
        assert sum(1 for r in rows if r["rank"] is not None) == 11
        assert rows[-1]["rank"] is None  # 아직 기록이 없는 팀
        assert sum(1 for r in rows if r["fa"]) == 4 and sum(r["rank_drops"] for r in rows) == 1

        rounds = client.get("/api/bracket").json()["rounds"]
        assert [r["name_en"] for r in rounds] == [
            "Quarterfinal",
            "Semifinal",
            "Third place",
            "Final",
        ]
        quarterfinals = rounds[0]["matches"]
        assert [[s["seed_rank"] for s in m["slots"]] for m in quarterfinals] == [
            [1, 8],
            [4, 5],
            [2, 7],
            [3, 6],
        ]
        assert all(s["team"] for m in quarterfinals for s in m["slots"])
        assert all(m["status"] == "scheduled" for r in rounds for m in r["matches"])
        third_place = rounds[2]["matches"][0]["slots"]
        assert [s["source_rank"] for s in third_place] == [2, 2]

        schedule = client.get("/api/schedule").json()
        rules = client.get("/api/rules").json()
        for item in schedule:
            assert item["title_ko"].startswith("임시 ")
            assert item["title_en"] == "" or item["title_en"].startswith("Temporary ")
        assert any(item["title_en"] == "" for item in schedule)
        assert all(rule["title_ko"].startswith("임시 ") for rule in rules)
        bodies_en = [rule["body_en"] for rule in rules]
        assert all(body == "" or body.startswith("Temporary ") for body in bodies_en)
        assert "" in bodies_en  # 영어 본문이 빈 섹션은 한국어로 대체된다
        assert any(
            "| --- |" in rule["body_ko"] and "](https://" in rule["body_ko"] for rule in rules
        )

        state = client.get("/api/live/state").json()
        assert state["phase"] == "qualifying" and state["on_track_team"] is not None

    with app.state.session_factory() as db:
        voids = db.scalars(select(QualifyingLap).where(QualifyingLap.status == "void")).all()
        assert len(voids) == 1 and voids[0].void_reason
    app.state.engine.dispose()


def test_backup(settings: Settings, tmp_path: Path) -> None:
    run(settings, "seed-demo")
    out = tmp_path / "backups" / "copy.db"
    assert run(settings, "backup", "--out", str(out)) == 0
    assert run(settings, "backup", "--out", str(out)) == 0  # 덮어쓰기
    with sqlite3.connect(out) as conn:
        assert conn.execute("SELECT count(*) FROM teams").fetchone() == (12,)
        assert conn.execute("PRAGMA journal_mode").fetchone() == ("delete",)
    assert not out.with_name("copy.db.partial").exists()

    missing = Settings(_env_file=None, database_url=f"sqlite:///{tmp_path / 'nope.db'}")
    assert run(missing, "backup", "--out", str(tmp_path / "x.db")) == 1


def test_export_openapi(settings: Settings, tmp_path: Path) -> None:
    out = tmp_path / "openapi.json"
    assert run(settings, "export-openapi", "--out", str(out)) == 0
    spec = json.loads(out.read_text("utf-8"))
    assert "/api/admin/matches/{match_id}/result" in spec["paths"]
    schemas = spec["components"]["schemas"]
    for name in ("Leaderboard", "Bracket", "LiveState", "ErrorResponse", "TeamPublic"):
        assert name in schemas
    assert "HTTPValidationError" not in schemas


def test_monitor_key(settings: Settings, capsys) -> None:
    assert run(settings, "monitor-key", "--value", "bad key") == 1
    assert run(settings, "monitor-key", "--generate") == 0
    key = capsys.readouterr().out.split("비밀 값: ")[1].split()[0]
    app = create_app(settings)
    headers = {"X-Requested-With": "fetch", "X-Monitor-Key": key}
    with TestClient(app, headers=headers) as client:
        assert client.get("/api/admin/monitor/access").json()["via"] == "key"
        assert run(settings, "monitor-key", "--off") == 0
        assert client.get("/api/admin/monitor/access").status_code == 403
    with app.state.session_factory() as db:
        logs = db.scalars(select(AuditLog).where(AuditLog.entity_id == "monitor_key")).all()
        assert [log.after for log in logs] == [{"set": True}, {"set": False}]
        assert all(log.user_id is None and key not in str(log.after) for log in logs)
    app.state.engine.dispose()
