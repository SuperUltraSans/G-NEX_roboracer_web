"""맵핑 순서: 팀마다 맵핑 순서(무작위)와 맵핑을 마친 시각

Revision ID: 0006
Revises: 0005
Create Date: 2026-11-01
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0006"
down_revision: str | Sequence[str] | None = "0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("teams") as batch_op:
        batch_op.add_column(sa.Column("mapping_order", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("mapped_at", sa.DateTime(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("teams") as batch_op:
        batch_op.drop_column("mapped_at")
        batch_op.drop_column("mapping_order")
