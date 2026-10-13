"""initial schema

Revision ID: 0001
Revises:
Create Date: 2026-10-12
"""

from collections.abc import Sequence
from datetime import UTC, datetime

import sqlalchemy as sa
from alembic import op

revision: str = "0001"
down_revision: str | Sequence[str] | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "bracket_rounds",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name_ko", sa.String(), nullable=False),
        sa.Column("name_en", sa.String(), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_bracket_rounds")),
    )
    op.create_table(
        "teams",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("car_number", sa.Integer(), nullable=False),
        sa.Column("name_ko", sa.String(), nullable=False),
        sa.Column("name_en", sa.String(), nullable=False),
        sa.Column("affiliation_ko", sa.String(), nullable=True),
        sa.Column("affiliation_en", sa.String(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_teams")),
        sa.UniqueConstraint("car_number", name=op.f("uq_teams_car_number")),
    )
    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("username", sa.String(length=32), nullable=False),
        sa.Column("password_hash", sa.String(), nullable=False),
        sa.Column("role", sa.String(length=16), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_users")),
        sa.UniqueConstraint("username", name=op.f("uq_users_username")),
    )
    op.create_table(
        "audit_logs",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=True),
        sa.Column("action", sa.String(length=32), nullable=False),
        sa.Column("entity", sa.String(length=64), nullable=False),
        sa.Column("entity_id", sa.String(length=64), nullable=False),
        sa.Column("before_json", sa.String(), nullable=True),
        sa.Column("after_json", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name=op.f("fk_audit_logs_user_id_users")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_audit_logs")),
    )
    with op.batch_alter_table("audit_logs", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_audit_logs_user_id"), ["user_id"], unique=False)

    op.create_table(
        "matches",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("round_id", sa.Integer(), nullable=False),
        sa.Column("label", sa.String(length=20), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("scheduled_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(
            ["round_id"],
            ["bracket_rounds.id"],
            name=op.f("fk_matches_round_id_bracket_rounds"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_matches")),
        sa.UniqueConstraint("label", name=op.f("uq_matches_label")),
    )
    with op.batch_alter_table("matches", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_matches_round_id"), ["round_id"], unique=False)

    op.create_table(
        "qualifying_laps",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("team_id", sa.Integer(), nullable=False),
        sa.Column("attempt_no", sa.Integer(), nullable=False),
        sa.Column("lap_time_ms", sa.Integer(), nullable=True),
        sa.Column("status", sa.String(length=8), nullable=False),
        sa.Column("void_reason", sa.String(), nullable=True),
        sa.Column("recorded_by", sa.Integer(), nullable=True),
        sa.Column("recorded_at", sa.DateTime(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(
            ["recorded_by"],
            ["users.id"],
            name=op.f("fk_qualifying_laps_recorded_by_users"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["team_id"], ["teams.id"], name=op.f("fk_qualifying_laps_team_id_teams")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_qualifying_laps")),
        sa.UniqueConstraint(
            "team_id", "attempt_no", name=op.f("uq_qualifying_laps_team_id_attempt_no")
        ),
    )
    with op.batch_alter_table("qualifying_laps", schema=None) as batch_op:
        batch_op.create_index(
            batch_op.f("ix_qualifying_laps_recorded_at"), ["recorded_at"], unique=False
        )
        batch_op.create_index(batch_op.f("ix_qualifying_laps_team_id"), ["team_id"], unique=False)

    op.create_table(
        "rule_sections",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("title_ko", sa.String(), nullable=False),
        sa.Column("title_en", sa.String(), nullable=False),
        sa.Column("body_ko", sa.String(), nullable=False),
        sa.Column("body_en", sa.String(), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.Column("is_published", sa.Boolean(), nullable=False),
        sa.Column("updated_by", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(
            ["updated_by"],
            ["users.id"],
            name=op.f("fk_rule_sections_updated_by_users"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_rule_sections")),
    )
    with op.batch_alter_table("rule_sections", schema=None) as batch_op:
        batch_op.create_index(
            batch_op.f("ix_rule_sections_sort_order"), ["sort_order"], unique=False
        )

    op.create_table(
        "schedule_items",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("starts_at", sa.DateTime(), nullable=False),
        sa.Column("ends_at", sa.DateTime(), nullable=True),
        sa.Column("title_ko", sa.String(), nullable=False),
        sa.Column("title_en", sa.String(), nullable=False),
        sa.Column("location_ko", sa.String(), nullable=True),
        sa.Column("location_en", sa.String(), nullable=True),
        sa.Column("description_ko", sa.String(), nullable=True),
        sa.Column("description_en", sa.String(), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.Column("is_published", sa.Boolean(), nullable=False),
        sa.Column("updated_by", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(
            ["updated_by"],
            ["users.id"],
            name=op.f("fk_schedule_items_updated_by_users"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_schedule_items")),
    )
    with op.batch_alter_table("schedule_items", schema=None) as batch_op:
        batch_op.create_index(
            batch_op.f("ix_schedule_items_starts_at"), ["starts_at"], unique=False
        )

    op.create_table(
        "sessions",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name=op.f("fk_sessions_user_id_users"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_sessions")),
    )
    with op.batch_alter_table("sessions", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_sessions_user_id"), ["user_id"], unique=False)

    op.create_table(
        "site_settings",
        sa.Column("key", sa.String(length=64), nullable=False),
        sa.Column("value", sa.String(), nullable=False),
        sa.Column("updated_by", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(
            ["updated_by"],
            ["users.id"],
            name=op.f("fk_site_settings_updated_by_users"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("key", name=op.f("pk_site_settings")),
    )
    op.create_table(
        "live_state",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("phase", sa.String(length=16), nullable=False),
        sa.Column("on_track_team_id", sa.Integer(), nullable=True),
        sa.Column("current_match_id", sa.Integer(), nullable=True),
        sa.Column("message_ko", sa.String(), nullable=True),
        sa.Column("message_en", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(
            ["current_match_id"],
            ["matches.id"],
            name=op.f("fk_live_state_current_match_id_matches"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["on_track_team_id"],
            ["teams.id"],
            name=op.f("fk_live_state_on_track_team_id_teams"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_live_state")),
    )
    op.create_table(
        "match_slots",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("match_id", sa.Integer(), nullable=False),
        sa.Column("slot_index", sa.Integer(), nullable=False),
        sa.Column("team_id", sa.Integer(), nullable=True),
        sa.Column("seed_rank", sa.Integer(), nullable=True),
        sa.Column("source_match_id", sa.Integer(), nullable=True),
        sa.Column("source_rank", sa.Integer(), nullable=True),
        sa.Column("placeholder_ko", sa.String(), nullable=True),
        sa.Column("placeholder_en", sa.String(), nullable=True),
        sa.Column("result_rank", sa.Integer(), nullable=True),
        sa.Column("result_text", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(
            ["match_id"],
            ["matches.id"],
            name=op.f("fk_match_slots_match_id_matches"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["source_match_id"],
            ["matches.id"],
            name=op.f("fk_match_slots_source_match_id_matches"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["team_id"], ["teams.id"], name=op.f("fk_match_slots_team_id_teams")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_match_slots")),
        sa.UniqueConstraint(
            "match_id", "slot_index", name=op.f("uq_match_slots_match_id_slot_index")
        ),
    )
    with op.batch_alter_table("match_slots", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_match_slots_match_id"), ["match_id"], unique=False)
        batch_op.create_index(
            batch_op.f("ix_match_slots_source_match_id"), ["source_match_id"], unique=False
        )

    # 진행 상태는 단일 행(id=1)으로 운영한다.
    now = datetime.now(UTC).replace(tzinfo=None)
    live_state = sa.table(
        "live_state",
        sa.column("id", sa.Integer),
        sa.column("phase", sa.String),
        sa.column("created_at", sa.DateTime),
        sa.column("updated_at", sa.DateTime),
    )
    op.bulk_insert(live_state, [{"id": 1, "phase": "idle", "created_at": now, "updated_at": now}])


def downgrade() -> None:
    op.drop_table("match_slots")
    op.drop_table("live_state")
    op.drop_table("site_settings")
    op.drop_table("sessions")
    op.drop_table("schedule_items")
    op.drop_table("rule_sections")
    op.drop_table("qualifying_laps")
    op.drop_table("matches")
    op.drop_table("audit_logs")
    op.drop_table("users")
    op.drop_table("teams")
    op.drop_table("bracket_rounds")
