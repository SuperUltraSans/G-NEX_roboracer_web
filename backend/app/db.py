from collections.abc import Iterator
from typing import Annotated, Any

from fastapi import Depends, Request
from sqlalchemy import Engine, create_engine, event
from sqlalchemy.orm import Session, sessionmaker


def _set_sqlite_pragmas(dbapi_connection: Any, _record: Any) -> None:
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.execute("PRAGMA busy_timeout=5000")
    cursor.close()


def create_db_engine(url: str) -> Engine:
    engine = create_engine(url, connect_args={"check_same_thread": False})
    event.listen(engine, "connect", _set_sqlite_pragmas)
    return engine


def create_session_factory(engine: Engine) -> sessionmaker[Session]:
    return sessionmaker(engine)


def get_db(request: Request) -> Iterator[Session]:
    with request.app.state.session_factory() as db:
        yield db


DbSession = Annotated[Session, Depends(get_db)]
