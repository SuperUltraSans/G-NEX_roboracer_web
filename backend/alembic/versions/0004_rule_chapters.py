"""규칙 섹션의 단계: 장(# 큰 제목)과 절(## 섹션)

Revision ID: 0004
Revises: 0003
Create Date: 2026-10-23
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0004"
down_revision: str | Sequence[str] | None = "0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # 지금 섹션은 모두 절(2). 장 제목이 본문에 섞여 있으면 규칙 문서를 다시 가져오면 나뉜다
    with op.batch_alter_table("rule_sections") as batch_op:
        batch_op.add_column(sa.Column("level", sa.Integer(), nullable=False, server_default="2"))


def downgrade() -> None:
    with op.batch_alter_table("rule_sections") as batch_op:
        batch_op.drop_column("level")
