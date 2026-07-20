"""Add activity heart-rate analysis columns.

Revision ID: 20260720_0002
Revises: 20260720_0001
Create Date: 2026-07-20
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "20260720_0002"
down_revision: str | None = "20260720_0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "activities", sa.Column("average_heart_rate_bpm", sa.Float(), nullable=True)
    )
    op.add_column("activities", sa.Column("max_heart_rate_bpm", sa.Float(), nullable=True))


def downgrade() -> None:
    op.drop_column("activities", "max_heart_rate_bpm")
    op.drop_column("activities", "average_heart_rate_bpm")
