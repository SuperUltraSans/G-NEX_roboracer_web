"""그룹 연습: 팀마다 연습 조(A·B·C)와 고른 시각

Revision ID: 0007
Revises: 0006
Create Date: 2026-11-01
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0007"
down_revision: str | Sequence[str] | None = "0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("teams") as batch_op:
        batch_op.add_column(sa.Column("practice_group", sa.String(length=1), nullable=True))
        batch_op.add_column(sa.Column("practice_group_at", sa.DateTime(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("teams") as batch_op:
        batch_op.drop_column("practice_group_at")
        batch_op.drop_column("practice_group")
