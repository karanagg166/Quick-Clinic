"""Provision, inspect, or reset the dedicated testing schema in PostgreSQL.

Usage:
    PYTHONPATH=. uv run python scripts/setup_testing_schema.py [--reset]
"""

import asyncio
import sys
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine
from app.infrastructure.database import database_url, metadata


async def main():
    reset = "--reset" in sys.argv
    url = database_url()
    is_sqlite = url.startswith("sqlite")
    if is_sqlite:
        print("SQLite detected; testing schema is only applicable to PostgreSQL.")
        return

    admin_engine = create_async_engine(url)

    if reset:
        print("Resetting 'testing' schema...")
        async with admin_engine.begin() as conn:
            await conn.execute(text("DROP SCHEMA IF EXISTS testing CASCADE"))
            await conn.execute(text("CREATE SCHEMA testing"))
        print("Dropped and recreated 'testing' schema.")
    else:
        async with admin_engine.begin() as conn:
            await conn.execute(text("CREATE SCHEMA IF NOT EXISTS testing"))

    await admin_engine.dispose()

    # Create all tables in testing schema using search_path
    engine = create_async_engine(url, connect_args={"server_settings": {"search_path": "testing"}})
    async with engine.begin() as conn:
        await conn.run_sync(metadata.create_all)

        # Seed reference locations from public if empty
        loc_cnt = await conn.scalar(text('SELECT count(*) FROM testing."Location"'))
        if loc_cnt == 0:
            await conn.execute(text("""
                INSERT INTO testing."Location" (pincode, city, state)
                SELECT pincode, city, state FROM public."Location"
                ON CONFLICT DO NOTHING
            """))
            print("Seeded reference locations from public.Location into testing.Location.")

        res = await conn.execute(text("""
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'testing' 
            ORDER BY table_name
        """))
        tables = [r[0] for r in res.fetchall()]
        print(f"Testing schema tables ({len(tables)}): {tables}")

    await engine.dispose()
    print("Testing schema setup completed successfully!")


if __name__ == "__main__":
    asyncio.run(main())
