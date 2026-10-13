from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from alembic import command
from alembic.config import Config
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.auth import hash_password
from app.config import Settings
from app.main import create_app
from app.models import Team, User

BACKEND_DIR = Path(__file__).resolve().parents[1]
PASSWORD = "correct-horse-battery"
FETCH = {"X-Requested-With": "fetch"}


def migrate(database_url: str) -> None:
    config = Config(str(BACKEND_DIR / "alembic.ini"))
    config.attributes["database_url"] = database_url
    config.attributes["configure_logger"] = False
    command.upgrade(config, "head")


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    database_url = f"sqlite:///{tmp_path / 'test.db'}"
    migrate(database_url)
    return Settings(
        _env_file=None,
        database_url=database_url,
        frontend_dist=tmp_path / "dist",
        rules_dir=tmp_path / "rules",
    )


@pytest.fixture
def app(settings: Settings) -> Iterator[FastAPI]:
    app = create_app(settings)
    yield app
    app.state.engine.dispose()


@pytest.fixture
def db(app: FastAPI) -> Iterator[Session]:
    with app.state.session_factory() as session:
        yield session


@pytest.fixture
def client(app: FastAPI) -> Iterator[TestClient]:
    # 한 이벤트 루프를 공유해야 WebSocket 과 HTTP 요청이 같은 허브를 쓴다.
    with TestClient(app) as test_client:
        yield test_client


def create_user(app: FastAPI, username: str, role: str = "admin", active: bool = True) -> int:
    with app.state.session_factory() as session:
        user = User(
            username=username,
            password_hash=hash_password(PASSWORD),
            role=role,
            is_active=active,
        )
        session.add(user)
        session.commit()
        return user.id


def login(client: TestClient, username: str, password: str = PASSWORD) -> Any:
    return client.post(
        "/api/admin/auth/login", json={"username": username, "password": password}, headers=FETCH
    )


@pytest.fixture
def admin_client(app: FastAPI, client: TestClient) -> TestClient:
    create_user(app, "admin1", "admin")
    assert login(client, "admin1").status_code == 200
    client.headers.update(FETCH)
    return client


@pytest.fixture
def referee_client(app: FastAPI, client: TestClient) -> TestClient:
    create_user(app, "referee1", "referee")
    assert login(client, "referee1").status_code == 200
    client.headers.update(FETCH)
    return client


def add_teams(app: FastAPI, count: int, inactive: tuple[int, ...] = ()) -> list[int]:
    """car_number 1..count 인 팀을 만든다. inactive 에 든 번호는 비활성."""
    with app.state.session_factory() as session:
        teams = [
            Team(
                car_number=n,
                name_ko=f"Mock Team {n:02d}",
                name_en=f"Mock Team {n:02d}",
                is_active=n not in inactive,
            )
            for n in range(1, count + 1)
        ]
        session.add_all(teams)
        session.commit()
        return [team.id for team in teams]
