from typing import Any

from fastapi import Response
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import InstrumentedAttribute

from app.errors import invalid
from app.schemas.common import ErrorResponse

# 모든 오류는 {"detail", "code"} 형식이다. FastAPI 기본 422 스키마 대신 이것을 쓴다.
ERROR_RESPONSES: dict[int | str, dict[str, Any]] = {
    "default": {"model": ErrorResponse, "description": "오류 ({detail, code})"}
}


def no_store(response: Response) -> None:
    response.headers["Cache-Control"] = "no-store"


def next_sort_order(db: Session, column: InstrumentedAttribute[int]) -> int:
    return (db.scalar(select(func.max(column))) or 0) + 1


def reorder(items: list[Any], ids: list[int]) -> None:
    """ids 는 전체 항목을 한 번씩 담아야 한다. 위치대로 sort_order 를 매긴다."""
    by_id = {item.id: item for item in items}
    if len(ids) != len(set(ids)) or set(ids) != by_id.keys():
        raise invalid("ids 에는 모든 항목의 id 가 한 번씩 들어 있어야 합니다.")
    for position, item_id in enumerate(ids):
        by_id[item_id].sort_order = position
