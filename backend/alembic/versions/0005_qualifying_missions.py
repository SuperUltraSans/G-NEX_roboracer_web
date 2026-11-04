"""예선을 규칙대로: 랩의 미션(Q1·Q2·Q3), 무효 랩, 차량 검사 시각, FA 실패·순위 강등 판정

Revision ID: 0005
Revises: 0004
Create Date: 2026-10-26
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0005"
down_revision: str | Sequence[str] | None = "0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # 예전 랩은 미션 구분이 없어 Q1 로 둔다. DNF·실격은 '무효 랩'이 된다
    with op.batch_alter_table("qualifying_laps") as batch_op:
        batch_op.add_column(
            sa.Column("mission", sa.String(length=2), nullable=False, server_default="Q1")
        )
    op.execute("UPDATE qualifying_laps SET status = 'invalid' WHERE status IN ('dnf', 'dsq')")
    with op.batch_alter_table("teams") as batch_op:
        batch_op.add_column(sa.Column("inspected_at", sa.DateTime(), nullable=True))
    op.create_table(
        "qualifying_events",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("team_id", sa.Integer(), nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("reason", sa.String(), nullable=False),
        sa.Column("recorded_by", sa.Integer(), nullable=True),
        sa.Column("recorded_at", sa.DateTime(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(
            ["recorded_by"],
            ["users.id"],
            name=op.f("fk_qualifying_events_recorded_by_users"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["team_id"],
            ["teams.id"],
            name=op.f("fk_qualifying_events_team_id_teams"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_qualifying_events")),
    )
    with op.batch_alter_table("qualifying_events") as batch_op:
        batch_op.create_index(batch_op.f("ix_qualifying_events_team_id"), ["team_id"], unique=False)


def downgrade() -> None:
    with op.batch_alter_table("qualifying_events") as batch_op:
        batch_op.drop_index(batch_op.f("ix_qualifying_events_team_id"))
    op.drop_table("qualifying_events")
    with op.batch_alter_table("teams") as batch_op:
        batch_op.drop_column("inspected_at")
    op.execute("UPDATE qualifying_laps SET status = 'dnf' WHERE status = 'invalid'")
    with op.batch_alter_table("qualifying_laps") as batch_op:
        batch_op.drop_column("mission")
