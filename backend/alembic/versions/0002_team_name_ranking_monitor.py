"""팀은 이름으로 구분(차량 번호 삭제), 랭킹 표, 시스템 계정 표시

Revision ID: 0002
Revises: 0001
Create Date: 2026-10-19
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0002"
down_revision: str | Sequence[str] | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("teams") as batch_op:
        batch_op.drop_constraint("uq_teams_car_number", type_="unique")
        batch_op.drop_column("car_number")
        batch_op.create_unique_constraint(batch_op.f("uq_teams_name_ko"), ["name_ko"])
    with op.batch_alter_table("users") as batch_op:
        batch_op.add_column(
            sa.Column("is_system", sa.Boolean(), nullable=False, server_default=sa.false())
        )
    op.create_table(
        "team_rankings",
        sa.Column("team_id", sa.Integer(), nullable=False),
        sa.Column("rank", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(
            ["team_id"],
            ["teams.id"],
            name=op.f("fk_team_rankings_team_id_teams"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("team_id", name=op.f("pk_team_rankings")),
        sa.UniqueConstraint("rank", name=op.f("uq_team_rankings_rank")),
    )


def downgrade() -> None:
    op.drop_table("team_rankings")
    with op.batch_alter_table("users") as batch_op:
        batch_op.drop_column("is_system")
    # 차량 번호는 되살릴 값이 없으므로 팀 ID 로 채운다
    with op.batch_alter_table("teams") as batch_op:
        batch_op.drop_constraint("uq_teams_name_ko", type_="unique")
        batch_op.add_column(sa.Column("car_number", sa.Integer(), nullable=True))
    op.execute("UPDATE teams SET car_number = id")
    with op.batch_alter_table("teams") as batch_op:
        batch_op.alter_column("car_number", nullable=False)
        batch_op.create_unique_constraint("uq_teams_car_number", ["car_number"])
