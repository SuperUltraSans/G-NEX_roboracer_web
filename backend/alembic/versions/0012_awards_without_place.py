"""대회 결과: 순위는 빼고 상만 둔다

Revision ID: 0012
Revises: 0011
Create Date: 2026-11-03
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0012"
down_revision: str | Sequence[str] | None = "0011"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("awards") as batch_op:
        batch_op.drop_column("place")


def downgrade() -> None:
    with op.batch_alter_table("awards") as batch_op:
        batch_op.add_column(sa.Column("place", sa.Integer(), nullable=False, server_default="0"))
