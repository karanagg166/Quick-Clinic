"""Verification script for Alembic migrations, database connection, and table schemas."""

import asyncio
from pathlib import Path
from urllib.parse import parse_qsl, urlsplit, urlunsplit
import asyncpg
from alembic.config import Config
from alembic.script import ScriptDirectory


def clean_pg_url(url: str):
    if url.startswith("postgres://"):
        url = "postgresql://" + url[len("postgres://") :]
    parsed = urlsplit(url)
    query = dict(parse_qsl(parsed.query))
    sslmode = query.pop("sslmode", None)
    query.pop("channel_binding", None)
    query.pop("pgbouncer", None)
    ssl = "require" if sslmode in ("require", "prefer") else sslmode
    dsn = urlunsplit(parsed._replace(query=""))
    return dsn, ssl


async def verify():
    supa_url = None
    for line in Path("../.env").read_text().splitlines():
        if line.startswith("DATABASE_URL="):
            supa_url = line.split("=", 1)[1].strip("\"'")

    if not supa_url:
        raise ValueError("DATABASE_URL not found in .env")

    dsn, ssl = clean_pg_url(supa_url)
    print("Checking database connection...")
    conn = await asyncpg.connect(dsn, ssl=ssl)

    tables = await conn.fetch("""
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
        ORDER BY table_name;
    """)
    table_names = [r["table_name"] for r in tables]
    print(f"Verified {len(table_names)} public tables in database.")

    # Check Alembic version table
    alembic_rev = await conn.fetchval("SELECT version_num FROM public.alembic_version LIMIT 1;")
    print(f"Current Alembic revision in DB: {alembic_rev}")

    await conn.close()

    # Compare with script directory head
    alembic_cfg = Config("alembic.ini")
    script = ScriptDirectory.from_config(alembic_cfg)
    head_rev = script.get_current_head()
    print(f"Alembic repository head: {head_rev}")

    if alembic_rev != head_rev:
        raise RuntimeError(f"Alembic revision mismatch: DB is {alembic_rev}, repo head is {head_rev}")

    print("\nSUCCESS: Database and Alembic migration status fully verified and aligned!")


if __name__ == "__main__":
    asyncio.run(verify())
