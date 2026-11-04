"""게시: 일정·규칙·사이트 설정의 공개본

Revision ID: 0003
Revises: 0002
Create Date: 2026-10-19
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0003"
down_revision: str | Sequence[str] | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # 처음 공개본은 서버가 시작할 때 지금 내용으로 만든다 (배포해도 공개 사이트가 바뀌지 않게)
    op.create_table(
        "published_content",
        sa.Column("resource", sa.String(length=16), nullable=False),
        sa.Column("data", sa.JSON(), nullable=False),
        sa.Column("published_at", sa.DateTime(), nullable=False),
        sa.Column("published_by", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(
            ["published_by"],
            ["users.id"],
            name=op.f("fk_published_content_published_by_users"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("resource", name=op.f("pk_published_content")),
    )


def downgrade() -> None:
    op.drop_table("published_content")
