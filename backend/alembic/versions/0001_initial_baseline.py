"""Initial baseline representing existing Quick-Clinic schema.

Revision ID: 0001_initial_baseline
Revises:
Create Date: 2026-11-10 18:00:00.000000

"""
from typing import Sequence, Union

# revision identifiers, used by Alembic.
revision: str = '0001_initial_baseline'
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Baseline: tables already exist in PostgreSQL from historical migrations.
    pass


def downgrade() -> None:
    # Do not drop existing production tables.
    pass
