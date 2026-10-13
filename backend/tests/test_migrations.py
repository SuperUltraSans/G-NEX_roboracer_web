from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from fastapi import FastAPI
from sqlalchemy import text

from app.models import Base


def test_migration_matches_models(app: FastAPI) -> None:
    with app.state.engine.connect() as connection:
        context = MigrationContext.configure(connection, opts={"render_as_batch": True})
        assert compare_metadata(context, Base.metadata) == []


def test_migration_seeds_live_state_and_pragmas(app: FastAPI) -> None:
    with app.state.engine.connect() as connection:
        rows = connection.execute(text("SELECT id, phase FROM live_state")).all()
        assert [tuple(row) for row in rows] == [(1, "idle")]
        assert connection.execute(text("PRAGMA foreign_keys")).scalar() == 1
        assert connection.execute(text("PRAGMA journal_mode")).scalar() == "wal"
        assert connection.execute(text("PRAGMA busy_timeout")).scalar() == 5000
