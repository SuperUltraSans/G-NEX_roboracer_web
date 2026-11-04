"""운영 명령. 사용법: uv run python -m app.cli <command> --help"""

import argparse
import json
import os
import secrets
import sqlite3
import sys
from collections.abc import Callable
from getpass import getpass
from pathlib import Path

from pydantic import ValidationError
from sqlalchemy import inspect, select
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session

from app.auth import ROLES, hash_password
from app.config import Settings, get_settings
from app.db import create_db_engine
from app.errors import AppError
from app.models import User, utcnow
from app.schemas.auth import UserCreate
from app.schemas.content import MonitorKeyUpdate
from app.services import (
    audit,
    demo,
    publishing,
    rules_document,
    rules_package,
    site_settings,
)
from app.services.rules_markdown import LANGS, filename


def _fail(message: str) -> int:
    print(f"오류: {message}", file=sys.stderr)
    return 1


def _open_db(settings: Settings) -> Session | None:
    engine = create_db_engine(settings.database_url)
    if not inspect(engine).has_table("users"):
        engine.dispose()
        return None
    return Session(engine)


def _with_db(settings: Settings, action: Callable[[Session], int]) -> int:
    db = _open_db(settings)
    if db is None:
        return _fail("DB 가 준비되지 않았습니다. 먼저 `uv run alembic upgrade head` 를 실행하세요.")
    try:
        with db:
            return action(db)
    finally:
        db.get_bind().dispose()


def create_user(args: argparse.Namespace, settings: Settings) -> int:
    password = getpass("비밀번호: ")
    if password != getpass("비밀번호 확인: "):
        return _fail("두 비밀번호가 다릅니다.")
    try:
        body = UserCreate(username=args.username, password=password, role=args.role)
    except ValidationError as exc:
        return _fail("; ".join(f"{'.'.join(map(str, e['loc']))}: {e['msg']}" for e in exc.errors()))

    def action(db: Session) -> int:
        if db.scalar(select(User.id).where(User.username == body.username)) is not None:
            return _fail(f"이미 있는 아이디입니다: {body.username}")
        user = User(
            username=body.username, password_hash=hash_password(body.password), role=body.role
        )
        db.add(user)
        audit.record_change(db, None, "create", user, None)
        db.commit()
        print(f"{body.role} 계정 {body.username} 을(를) 만들었습니다.")
        return 0

    return _with_db(settings, action)


def export_openapi(args: argparse.Namespace, settings: Settings) -> int:
    from app.main import create_app

    app = create_app(settings)
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(app.openapi(), ensure_ascii=False, indent=2) + "\n", "utf-8")
    app.state.engine.dispose()
    print(f"OpenAPI 스키마를 {out} 에 저장했습니다.")
    return 0


def seed_demo(args: argparse.Namespace, settings: Settings) -> int:
    if settings.is_production:
        return _fail("APP_ENV=production 에서는 데모 데이터를 넣을 수 없습니다.")

    def action(db: Session) -> int:
        if not demo.is_empty(db):
            if not args.force:
                return _fail(
                    "DB 에 이미 데이터가 있습니다. 지우고 다시 넣으려면 --force 를 붙이세요."
                )
            demo.clear(db)
        demo.seed_demo(db, utcnow())
        db.commit()
        rules_document.write_documents_safely(db, settings.rules_dir)
        print("데모 데이터를 넣었습니다 (팀 12, 일정, 규칙, 예선 기록, 8강 대진).")
        return 0

    return _with_db(settings, action)


def export_rules(args: argparse.Namespace, settings: Settings) -> int:
    def action(db: Session) -> int:
        try:
            paths = rules_document.write_documents(db, settings.rules_dir)
        except OSError as exc:
            return _fail(f"규칙 문서를 쓰지 못했습니다: {exc}")
        for path in paths:
            print(f"규칙 문서를 {path} 에 저장했습니다.")
        return 0

    return _with_db(settings, action)


def import_rules(args: argparse.Namespace, settings: Settings) -> int:
    path = Path(args.file) if args.file else settings.rules_dir / filename(args.lang)
    try:
        if path.is_file() and path.stat().st_size > rules_package.MAX_PACKAGE_BYTES:
            return _fail(f"{rules_package.payload_too_large().detail}: {path}")
        data = path.read_bytes()
    except FileNotFoundError:
        return _fail(f"파일이 없습니다: {path}")
    except OSError as exc:
        return _fail(f"파일을 읽지 못했습니다: {exc}")
    is_zip = path.suffix.lower() == ".zip" or data.startswith(b"PK\x03\x04")
    if not is_zip:
        try:
            markdown = data.decode("utf-8-sig")
        except UnicodeDecodeError:
            return _fail(f"UTF-8 로 읽을 수 없습니다. UTF-8 로 저장한 뒤 다시 실행하세요: {path}")

    def action(db: Session) -> int:
        try:
            if is_zip:
                report = rules_package.import_package(db, None, args.lang, data, settings.rules_dir)
            else:
                report = rules_package.import_markdown(
                    db, None, args.lang, markdown, settings.rules_dir
                )
        except AppError as exc:
            return _fail(exc.detail)
        counts = report.counts
        print(
            f"{path} 을(를) 반영했습니다: 새 섹션 {counts.created}, 바뀐 섹션 {counts.updated},"
            f" 지운 섹션 {counts.deleted}, 그림 {report.assets}개."
        )
        for warning in report.warnings:
            print(f"확인: {warning}")
        print("관리자 화면이나 `publish --resource rules` 로 게시해야 공개 사이트에 보입니다.")
        return 0

    return _with_db(settings, action)


def backup(args: argparse.Namespace, settings: Settings) -> int:
    database = make_url(settings.database_url).database
    if not database or database == ":memory:" or not Path(database).is_file():
        return _fail(f"DB 파일을 찾을 수 없습니다: {database}")
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    partial = out.with_name(out.name + ".partial")
    partial.unlink(missing_ok=True)
    source = sqlite3.connect(database)
    target = sqlite3.connect(partial)
    try:
        source.backup(target)
        # 사본은 -wal 파일 없이 한 파일로 옮길 수 있게 한다
        target.execute("PRAGMA journal_mode=DELETE")
    finally:
        target.close()
        source.close()
    os.replace(partial, out)
    print(f"백업을 {out} 에 저장했습니다.")
    return 0


def monitor_key(args: argparse.Namespace, settings: Settings) -> int:
    if args.value is not None:
        try:
            key = MonitorKeyUpdate(key=args.value).key
        except ValidationError:
            return _fail("비밀 값은 영문, 숫자, -, _ 만 써서 6~64자여야 합니다.")
    else:
        key = None if args.off else secrets.token_urlsafe(12)

    def action(db: Session) -> int:
        site_settings.write_monitor_key(db, key, None)
        db.commit()
        if key is None:
            print("모니터링 관리 주소를 껐습니다. 로그인한 운영진만 열 수 있습니다.")
        else:
            print(f"모니터링 관리 주소를 바꿨습니다. 예전 주소는 바로 막힙니다.\n비밀 값: {key}")
            print(f"주소: <사이트 주소>/monitoring-admin?pw={key}")
        return 0

    return _with_db(settings, action)


def publish(args: argparse.Namespace, settings: Settings) -> int:
    resources = publishing.RESOURCES if args.resource == "all" else (args.resource,)

    def action(db: Session) -> int:
        for resource in resources:
            pending = publishing.state(db, resource).pending
            publishing.publish(db, resource, None)
            result = "게시했습니다" if pending else "바뀐 것이 없지만 다시 게시했습니다"
            print(f"{resource}: {result}.")
        db.commit()
        print("서버가 돌고 있다면 열려 있는 공개 화면은 새로고침해야 바뀐 내용이 보입니다.")
        return 0

    return _with_db(settings, action)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="python -m app.cli", description="RoboRacer 운영 명령")
    commands = parser.add_subparsers(dest="command", required=True)

    cmd = commands.add_parser("create-user", help="관리자·심판 계정 생성 (비밀번호는 프롬프트)")
    cmd.add_argument("--username", required=True)
    cmd.add_argument("--role", required=True, choices=ROLES)
    cmd.set_defaults(handler=create_user)

    cmd = commands.add_parser("export-openapi", help="서버 없이 OpenAPI 스키마 저장")
    cmd.add_argument("--out", required=True)
    cmd.set_defaults(handler=export_openapi)

    cmd = commands.add_parser("seed-demo", help="가짜 팀·일정·규칙·기록·대진 생성 (개발용)")
    cmd.add_argument("--force", action="store_true", help="기존 데이터를 지우고 다시 생성")
    cmd.set_defaults(handler=seed_demo)

    cmd = commands.add_parser(
        "export-rules", help="규칙 섹션을 RULES_DIR 의 rules.ko.md, rules.en.md 로 저장"
    )
    cmd.set_defaults(handler=export_rules)

    cmd = commands.add_parser(
        "import-rules",
        help="규칙 Markdown 문서나 ZIP(문서 + 그림)을 DB 에 반영 (관리자 화면의 올리기와 같음)",
        description="ko 는 문서의 `## 제목` 섹션으로 규칙 섹션을 순서대로 바꾸고 남는 섹션은"
        " 지운다. en 은 영어 제목과 본문만 바꾼다. ZIP 이면 문서가 쓰는 그림을"
        " RULES_DIR/files 에 저장한다.",
    )
    cmd.add_argument("--lang", required=True, choices=LANGS)
    cmd.add_argument("--file", help="기본값: RULES_DIR/rules.<lang>.md. .md 또는 .zip")
    cmd.set_defaults(handler=import_rules)

    cmd = commands.add_parser(
        "publish",
        help="고친 일정·규칙·사이트 설정을 공개 사이트에 게시 (관리자 화면의 게시와 같음)",
    )
    cmd.add_argument("--resource", required=True, choices=[*publishing.RESOURCES, "all"])
    cmd.set_defaults(handler=publish)

    cmd = commands.add_parser(
        "monitor-key",
        help="모니터링 관리 주소(로그인 없이 /monitoring-admin?pw=값)의 비밀 값을 바꾸거나 끈다",
    )
    choice = cmd.add_mutually_exclusive_group(required=True)
    choice.add_argument("--generate", action="store_true", help="무작위 16자로 바꾼다")
    choice.add_argument("--value", help="직접 정한 값 (영문·숫자·-·_ 6~64자)")
    choice.add_argument("--off", action="store_true", help="주소를 끈다 (로그인한 운영진만)")
    cmd.set_defaults(handler=monitor_key)

    cmd = commands.add_parser("backup", help="SQLite 온라인 백업으로 DB 사본 생성")
    cmd.add_argument("--out", required=True)
    cmd.set_defaults(handler=backup)
    return parser


def main(argv: list[str] | None = None, settings: Settings | None = None) -> int:
    args = build_parser().parse_args(argv)
    return args.handler(args, settings or get_settings())


if __name__ == "__main__":
    sys.exit(main())
