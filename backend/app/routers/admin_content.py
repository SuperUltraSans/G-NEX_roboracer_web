from typing import Annotated, Any

from fastapi import APIRouter, Depends, Request, Response, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.auth import AdminUser, AppSettings
from app.config import Settings
from app.db import DbSession
from app.errors import check_version, duplicate, invalid, not_found, team_limit
from app.live.events import Events
from app.models import Base, RuleSection, ScheduleItem, Team, User
from app.routers.common import next_sort_order, reorder
from app.schemas.common import OrderUpdate
from app.schemas.competition import MAX_ACTIVE_TEAMS, TeamAdmin, TeamCreate, TeamUpdate
from app.schemas.content import (
    AdminSettings,
    AdminSettingsUpdate,
    MonitorKeyUpdate,
    PageStates,
    RulesDocument,
    RulesDocumentImport,
    RuleSectionAdmin,
    RuleSectionCreate,
    RuleSectionUpdate,
    RulesImportResult,
    ScheduleDocument,
    ScheduleDocumentImport,
    ScheduleImportResult,
    ScheduleItemAdmin,
    ScheduleItemCreate,
    ScheduleItemUpdate,
)
from app.services import audit, rules_document, rules_package, schedule_document, teams
from app.services.rules_markdown import Lang, filename
from app.services.site_settings import (
    read_settings,
    write_monitor_key,
    write_pages,
    write_settings,
)

router = APIRouter()


def _get(db: Session, model: type[Any], item_id: int, what: str) -> Any:
    item = db.get(model, item_id)
    if item is None:
        raise not_found(what)
    return item


def _create(db: Session, actor: User, item: Base) -> None:
    db.add(item)
    audit.record_change(db, actor, "create", item, None)
    db.commit()


def _patch(actor: User, item: Any, body: Any) -> dict[str, Any]:
    """version 을 검사하고 보낸 필드만 반영한다. 감사 로그용 이전 값을 돌려준다."""
    check_version(item.version, body.version)
    before = audit.snapshot(item)
    for key, value in body.model_dump(exclude_unset=True, exclude={"version"}).items():
        setattr(item, key, value)
    if hasattr(item, "updated_by"):
        item.updated_by = actor.id
    item.bump_version()
    return before


def _delete(db: Session, actor: User, item: Base) -> None:
    before = audit.snapshot(item)
    db.delete(item)
    audit.record_change(db, actor, "delete", item, before)
    db.commit()


# ---- 신청 설정 ----


@router.get("/settings", response_model=AdminSettings, tags=["content"])
def get_admin_settings(_: AdminUser, db: DbSession) -> AdminSettings:
    return read_settings(db)


@router.put("/settings", response_model=AdminSettings, tags=["content"])
def put_admin_settings(
    body: AdminSettingsUpdate, actor: AdminUser, db: DbSession, events: Events
) -> AdminSettings:
    result = write_settings(db, body, actor)
    db.commit()
    events.content("settings")
    return result


@router.put("/settings/monitor", response_model=AdminSettings, tags=["content"])
def put_monitor_key(body: MonitorKeyUpdate, actor: AdminUser, db: DbSession) -> AdminSettings:
    """모니터링 관리 주소(?pw=...)의 비밀 값을 바꾼다. 바꾸면 예전 주소는 바로 막힌다."""
    result = write_monitor_key(db, body.key, actor)
    db.commit()
    return result


@router.put("/settings/pages", response_model=AdminSettings, tags=["content"])
def put_admin_pages(
    body: PageStates, actor: AdminUser, db: DbSession, events: Events
) -> AdminSettings:
    """일정, 규칙, 모니터링 페이지를 열고 닫는다. 닫힌 페이지는 공개 화면에 안내 문구만 보인다."""
    result = write_pages(db, body, actor)
    db.commit()
    events.content("settings")
    return result


# ---- 일정 ----


def _schedule_items(db: Session) -> list[ScheduleItem]:
    return list(
        db.scalars(
            select(ScheduleItem).order_by(
                ScheduleItem.starts_at, ScheduleItem.sort_order, ScheduleItem.id
            )
        )
    )


@router.get("/schedule", response_model=list[ScheduleItemAdmin], tags=["content"])
def list_schedule_items(_: AdminUser, db: DbSession) -> list[ScheduleItemAdmin]:
    return [ScheduleItemAdmin.model_validate(item) for item in _schedule_items(db)]


@router.post(
    "/schedule",
    response_model=ScheduleItemAdmin,
    status_code=status.HTTP_201_CREATED,
    tags=["content"],
)
def create_schedule_item(
    body: ScheduleItemCreate, actor: AdminUser, db: DbSession, events: Events
) -> ScheduleItemAdmin:
    data = body.model_dump()
    if data["sort_order"] is None:
        data["sort_order"] = next_sort_order(db, ScheduleItem.sort_order)
    item = ScheduleItem(**data, updated_by=actor.id)
    _create(db, actor, item)
    events.content("schedule")
    return ScheduleItemAdmin.model_validate(item)


@router.get("/schedule/document", response_model=ScheduleDocument, tags=["content"])
def export_schedule_document(
    _: AdminUser, db: DbSession, settings: AppSettings
) -> ScheduleDocument:
    """일정 전체를 Markdown 문서 하나로 (한국어·영어 함께)"""
    items = schedule_document.list_items(db)
    markdown = schedule_document.render(items, settings.event_timezone)
    return ScheduleDocument(filename=schedule_document.FILENAME, markdown=markdown)


@router.put("/schedule/document", response_model=ScheduleImportResult, tags=["content"])
def import_schedule_document(
    body: ScheduleDocumentImport,
    actor: AdminUser,
    db: DbSession,
    settings: AppSettings,
    events: Events,
) -> ScheduleImportResult:
    """Markdown 문서로 일정 전체를 바꾼다. 형식이 틀리면 몇 번째 줄인지 알려 주는 422."""
    created, deleted = schedule_document.import_document(
        db, actor, body.markdown, settings.event_timezone
    )
    db.commit()
    events.content("schedule")
    items = [ScheduleItemAdmin.model_validate(item) for item in schedule_document.list_items(db)]
    return ScheduleImportResult(created=created, deleted=deleted, items=items)


@router.put("/schedule/order", response_model=list[ScheduleItemAdmin], tags=["content"])
def reorder_schedule_items(
    body: OrderUpdate, actor: AdminUser, db: DbSession, events: Events
) -> list[ScheduleItemAdmin]:
    reorder(_schedule_items(db), body.ids)
    audit.record(db, actor, "reorder", "schedule_items", "*", None, {"ids": body.ids})
    db.commit()
    events.content("schedule")
    return [ScheduleItemAdmin.model_validate(item) for item in _schedule_items(db)]


@router.patch("/schedule/{item_id}", response_model=ScheduleItemAdmin, tags=["content"])
def update_schedule_item(
    item_id: int, body: ScheduleItemUpdate, actor: AdminUser, db: DbSession, events: Events
) -> ScheduleItemAdmin:
    item = _get(db, ScheduleItem, item_id, "일정")
    before = _patch(actor, item, body)
    if item.ends_at is not None and item.ends_at <= item.starts_at:
        raise invalid("종료 시각은 시작 시각보다 뒤여야 합니다.")
    audit.record_change(db, actor, "update", item, before)
    db.commit()
    events.content("schedule")
    return ScheduleItemAdmin.model_validate(item)


@router.delete("/schedule/{item_id}", status_code=status.HTTP_204_NO_CONTENT, tags=["content"])
def delete_schedule_item(item_id: int, actor: AdminUser, db: DbSession, events: Events) -> Response:
    _delete(db, actor, _get(db, ScheduleItem, item_id, "일정"))
    events.content("schedule")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---- 규칙 ----


def _rule_sections_admin(db: Session) -> list[RuleSectionAdmin]:
    return [RuleSectionAdmin.model_validate(s) for s in rules_document.list_sections(db)]


def _rules_changed(db: Session, settings: Settings, events: Events) -> None:
    """커밋한 뒤에 부른다. 서버의 규칙 문서를 다시 쓰고 열려 있는 화면에 알린다."""
    rules_document.write_documents_safely(db, settings.rules_dir)
    events.content("rules")


@router.get("/rules", response_model=list[RuleSectionAdmin], tags=["content"])
def list_rule_sections(_: AdminUser, db: DbSession) -> list[RuleSectionAdmin]:
    return _rule_sections_admin(db)


@router.post(
    "/rules", response_model=RuleSectionAdmin, status_code=status.HTTP_201_CREATED, tags=["content"]
)
def create_rule_section(
    body: RuleSectionCreate, actor: AdminUser, db: DbSession, settings: AppSettings, events: Events
) -> RuleSectionAdmin:
    data = body.model_dump()
    if data["sort_order"] is None:
        data["sort_order"] = next_sort_order(db, RuleSection.sort_order)
    section = RuleSection(**data, updated_by=actor.id)
    _create(db, actor, section)
    _rules_changed(db, settings, events)
    return RuleSectionAdmin.model_validate(section)


@router.put("/rules/order", response_model=list[RuleSectionAdmin], tags=["content"])
def reorder_rule_sections(
    body: OrderUpdate, actor: AdminUser, db: DbSession, settings: AppSettings, events: Events
) -> list[RuleSectionAdmin]:
    reorder(rules_document.list_sections(db), body.ids)
    audit.record(db, actor, "reorder", "rule_sections", "*", None, {"ids": body.ids})
    db.commit()
    _rules_changed(db, settings, events)
    return _rule_sections_admin(db)


@router.get("/rules/document", response_model=RulesDocument, tags=["content"])
def export_rules_document(
    lang: Lang, _: AdminUser, db: DbSession, settings: AppSettings
) -> RulesDocument:
    """규칙 섹션 전체를 한 언어의 Markdown 문서로 만든다. 서버의 문서 파일도 다시 쓴다."""
    rules_document.write_documents_safely(db, settings.rules_dir)
    markdown = rules_document.render(rules_document.list_sections(db), lang)
    return RulesDocument(lang=lang, filename=filename(lang), markdown=markdown)


def _import_result(
    db: Session, lang: Lang, report: rules_package.ImportReport
) -> RulesImportResult:
    return RulesImportResult(
        lang=lang,
        created=report.counts.created,
        updated=report.counts.updated,
        deleted=report.counts.deleted,
        sections=_rule_sections_admin(db),
        assets=report.assets,
        warnings=report.warnings,
    )


@router.put("/rules/document", response_model=RulesImportResult, tags=["content"])
def import_rules_document(
    body: RulesDocumentImport,
    actor: AdminUser,
    db: DbSession,
    settings: AppSettings,
    events: Events,
) -> RulesImportResult:
    """Markdown 문서를 올려 규칙 섹션을 문서의 `## 제목` 섹션으로 순서대로 바꾼다.

    ko 는 한국어 제목·본문·공개 여부를 바꾸고 섹션 수를 문서에 맞춘다 (남는 섹션은 삭제).
    en 은 영어 제목·본문만 바꾼다. 문서의 섹션이 지금 섹션보다 많으면 422.
    그림 주소는 서버에 이미 저장된 그림(이전에 올린 ZIP)으로 찾아 `/경로` 로 바꾼다.
    """
    report = rules_package.import_markdown(db, actor, body.lang, body.markdown, settings.rules_dir)
    events.content("rules")
    return _import_result(db, body.lang, report)


async def _package_body(request: Request) -> bytes:
    """요청 본문(ZIP)을 읽는다. 한도를 넘으면 다 읽기 전에 413."""
    declared = request.headers.get("content-length", "")
    if declared.isdigit() and int(declared) > rules_package.MAX_PACKAGE_BYTES:
        raise rules_package.payload_too_large()
    chunks: list[bytes] = []
    size = 0
    async for chunk in request.stream():
        size += len(chunk)
        if size > rules_package.MAX_PACKAGE_BYTES:
            raise rules_package.payload_too_large()
        chunks.append(chunk)
    if not size:
        raise invalid("올린 내용이 비어 있습니다. ZIP 파일을 고르세요.")
    return b"".join(chunks)


PackageBody = Annotated[bytes, Depends(_package_body)]
ZIP_CONTENT = {"application/zip": {"schema": {"type": "string", "format": "binary"}}}


@router.put(
    "/rules/package",
    response_model=RulesImportResult,
    tags=["content"],
    openapi_extra={"requestBody": {"required": True, "content": ZIP_CONTENT}},
)
def import_rules_package(
    lang: Lang,
    actor: AdminUser,
    data: PackageBody,
    db: DbSession,
    settings: AppSettings,
    events: Events,
) -> RulesImportResult:
    """Markdown 문서 하나와 그림을 묶은 ZIP 을 올린다 (본문 = ZIP 바이트, application/zip).

    문서는 `PUT /rules/document` 와 같이 적용한다. 문서의 그림 주소(상대 경로, `/` 로 시작하는
    패키지 경로, 작성자 컴퓨터의 절대 경로)를 ZIP 안의 파일로 찾아 `/패키지 경로` 로 바꾸고,
    쓰는 그림만 서버에 저장한다 (`GET /api/rules/files/{path}`). 찾지 못한 주소와 넣지 않은
    파일은 warnings 로 알린다. 한도: 요청 50MB, 압축을 푼 크기 200MB, 항목 1,000개.
    """
    report = rules_package.import_package(db, actor, lang, data, settings.rules_dir)
    events.content("rules")
    return _import_result(db, lang, report)


@router.get(
    "/rules/package",
    response_class=Response,
    tags=["content"],
    responses={200: {"description": "rules.<lang>.md 와 그림을 담은 ZIP", "content": ZIP_CONTENT}},
)
def export_rules_package(
    lang: Lang, _: AdminUser, db: DbSession, settings: AppSettings
) -> Response:
    """rules.<lang>.md 와 문서가 쓰는 그림을 담은 ZIP. 그대로 다시 올릴 수 있다."""
    rules_document.write_documents_safely(db, settings.rules_dir)
    data = rules_package.export_package(db, lang, settings.rules_dir)
    name = rules_package.package_filename(lang)
    return Response(
        data,
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="{name}"',
            "Cache-Control": "no-store",
        },
    )


@router.patch("/rules/{section_id}", response_model=RuleSectionAdmin, tags=["content"])
def update_rule_section(
    section_id: int,
    body: RuleSectionUpdate,
    actor: AdminUser,
    db: DbSession,
    settings: AppSettings,
    events: Events,
) -> RuleSectionAdmin:
    section = _get(db, RuleSection, section_id, "규칙 섹션")
    before = _patch(actor, section, body)
    audit.record_change(db, actor, "update", section, before)
    db.commit()
    _rules_changed(db, settings, events)
    return RuleSectionAdmin.model_validate(section)


@router.delete("/rules/{section_id}", status_code=status.HTTP_204_NO_CONTENT, tags=["content"])
def delete_rule_section(
    section_id: int, actor: AdminUser, db: DbSession, settings: AppSettings, events: Events
) -> Response:
    _delete(db, actor, _get(db, RuleSection, section_id, "규칙 섹션"))
    _rules_changed(db, settings, events)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---- 팀 ----


def _ensure_unique_name(db: Session, name: str, team_id: int | None = None) -> None:
    # 팀은 이름으로 구분한다. 대소문자만 다른 이름도 같은 팀으로 본다 (INJECT 와 Inject)
    existing = db.scalar(select(Team.id).where(func.lower(Team.name_ko) == name.lower()))
    if existing is not None and existing != team_id:
        raise duplicate(f"'{name}' 팀이 이미 있습니다. 다른 이름을 쓰세요.")


def _ensure_team_slot(db: Session, team_id: int | None = None) -> None:
    # 참가(활성) 팀은 최대 MAX_ACTIVE_TEAMS 팀. 비활성 팀은 세지 않는다
    query = select(func.count()).select_from(Team).where(Team.is_active.is_(True))
    if team_id is not None:
        query = query.where(Team.id != team_id)
    if db.scalar(query) >= MAX_ACTIVE_TEAMS:
        raise team_limit(MAX_ACTIVE_TEAMS)


def _team_changed(events: Events) -> None:
    # 팀 이름은 리더보드, 대진, 진행 상태에도 나오므로 모두 다시 보낸다.
    events.content("teams")
    events.content("ranking")  # 비활성화하면 랭킹에서 빠진다
    events.qualifying()
    events.bracket()
    events.live_state()


@router.get("/teams", response_model=list[TeamAdmin], tags=["teams"])
def list_teams(_: AdminUser, db: DbSession) -> list[TeamAdmin]:
    teams = db.scalars(select(Team).order_by(Team.id))
    return [TeamAdmin.model_validate(team) for team in teams]


@router.post(
    "/teams", response_model=TeamAdmin, status_code=status.HTTP_201_CREATED, tags=["teams"]
)
def create_team(body: TeamCreate, actor: AdminUser, db: DbSession, events: Events) -> TeamAdmin:
    _ensure_unique_name(db, body.name_ko)
    if body.is_active:
        _ensure_team_slot(db)
    team = Team(**body.model_dump())
    _create(db, actor, team)
    _team_changed(events)
    return TeamAdmin.model_validate(team)


@router.patch("/teams/{team_id}", response_model=TeamAdmin, tags=["teams"])
def update_team(
    team_id: int, body: TeamUpdate, actor: AdminUser, db: DbSession, events: Events
) -> TeamAdmin:
    team = _get(db, Team, team_id, "팀")
    check_version(team.version, body.version)
    if body.name_ko is not None:
        _ensure_unique_name(db, body.name_ko, team.id)
    if body.is_active and not team.is_active:
        _ensure_team_slot(db, team.id)
    was_active = team.is_active
    before = _patch(actor, team, body)
    audit.record_change(db, actor, "update", team, before)
    if was_active and not team.is_active:
        teams.withdraw(db, team, actor)
    db.commit()
    _team_changed(events)
    return TeamAdmin.model_validate(team)
