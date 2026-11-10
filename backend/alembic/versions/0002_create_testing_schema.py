"""Create and maintain dedicated testing schema isolated from production public schema.

Revision ID: 0002_create_testing_schema
Revises: 0001_initial_baseline
Create Date: 2026-11-11 04:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0002_create_testing_schema"
down_revision: Union[str, None] = "0001_initial_baseline"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    conn.execute(sa.text("CREATE SCHEMA IF NOT EXISTS testing"))
    conn.execute(sa.text("""
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'testing' AND table_name = 'Location') THEN
                INSERT INTO testing."Location" (pincode, city, state)
                SELECT pincode, city, state FROM public."Location"
                ON CONFLICT DO NOTHING;
            END IF;
        END $$;
    """))


def downgrade() -> None:
    conn = op.get_bind()
    conn.execute(sa.text("DROP SCHEMA IF EXISTS testing CASCADE"))
