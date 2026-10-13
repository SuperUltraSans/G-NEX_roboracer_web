from typing import Annotated, Any

from pydantic import BaseModel, BeforeValidator, ConfigDict, Field, StringConstraints


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class FieldError(BaseModel):
    loc: list[str | int]
    msg: str


class ErrorResponse(BaseModel):
    detail: str
    code: str
    errors: list[FieldError] | None = None


class OrderUpdate(BaseModel):
    ids: list[int] = Field(description="전체 항목 id 를 원하는 순서대로 한 번씩")


def _blank_to_none(value: Any) -> Any:
    if isinstance(value, str):
        value = value.strip()
        return value or None
    return value


def _text(min_length: int, max_length: int) -> StringConstraints:
    return StringConstraints(strip_whitespace=True, min_length=min_length, max_length=max_length)


# 한국어 필드는 필수, 영어 필드는 비워 두면 화면에서 한국어로 대체한다.
Title = Annotated[str, _text(1, 200)]
TitleEn = Annotated[str, _text(0, 200)]
Markdown = Annotated[str, _text(0, 100_000)]
# 선택 필드: 빈 문자열은 null 로 저장
ShortText = Annotated[Annotated[str, _text(0, 200)] | None, BeforeValidator(_blank_to_none)]
LongText = Annotated[Annotated[str, _text(0, 5000)] | None, BeforeValidator(_blank_to_none)]
Notice = Annotated[Annotated[str, _text(0, 500)] | None, BeforeValidator(_blank_to_none)]
