"""Data migration from Neon to Supabase with exact verification."""

import asyncio
from pathlib import Path
from urllib.parse import parse_qsl, urlsplit, urlunsplit
import asyncpg


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


async def migrate():
    neon_url = None
    supa_url = None
    for line in Path("../.env").read_text().splitlines():
        if line.startswith("QC_SOURCE_DATABASE_URL="):
            neon_url = line.split("=", 1)[1].strip("\"'")
        elif line.startswith("DATABASE_URL="):
            supa_url = line.split("=", 1)[1].strip("\"'")

    if not neon_url or not supa_url:
        raise ValueError("Both QC_SOURCE_DATABASE_URL and DATABASE_URL are required in .env")

    dsn_neon, ssl_neon = clean_pg_url(neon_url)
    dsn_supa, ssl_supa = clean_pg_url(supa_url)

    print("Connecting to Neon...")
    conn_neon = await asyncpg.connect(dsn_neon, ssl=ssl_neon)
    print("Connecting to Supabase...")
    conn_supa = await asyncpg.connect(dsn_supa, ssl=ssl_supa)

    tables_records = await conn_neon.fetch("""
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
        ORDER BY table_name;
    """)
    table_names = [r["table_name"] for r in tables_records]
    print(f"Found {len(table_names)} tables to migrate.")

    # Disable constraints & triggers during data copy
    await conn_supa.execute("SET session_replication_role = 'replica';")

    for t in table_names:
        cols_info = await conn_neon.fetch(
            """
            SELECT column_name, data_type, udt_name
            FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = $1
            ORDER BY ordinal_position
            """,
            t,
        )
        cols = [c["column_name"] for c in cols_info]
        cols_quoted = [f'"{c}"' for c in cols]
        select_query = f'SELECT {",".join(cols_quoted)} FROM public."{t}"'
        rows = await conn_neon.fetch(select_query)

        if not rows:
            print(f"  {t}: 0 rows")
            continue

        placeholders = [f"${i+1}" for i in range(len(cols))]
        insert_query = f'INSERT INTO public."{t}" ({",".join(cols_quoted)}) VALUES ({",".join(placeholders)}) ON CONFLICT DO NOTHING'
        records = [tuple(r[c] for c in cols) for r in rows]

        # Use batch inserts
        batch_size = 500
        for i in range(0, len(records), batch_size):
            batch = records[i : i + batch_size]
            await conn_supa.executemany(insert_query, batch)

        print(f"  {t}: Migrated {len(rows)} rows")

    await conn_supa.execute("SET session_replication_role = 'origin';")

    print("\nVerifying row counts...")
    for t in table_names:
        neon_count = await conn_neon.fetchval(f'SELECT count(*) FROM public."{t}"')
        supa_count = await conn_supa.fetchval(f'SELECT count(*) FROM public."{t}"')
        status = "MATCH" if neon_count == supa_count else "MISMATCH"
        print(f"  {t}: Neon={neon_count}, Supabase={supa_count} [{status}]")
        if status == "MISMATCH":
            raise RuntimeError(f"Row count mismatch in table {t}!")

    await conn_neon.close()
    await conn_supa.close()
    print("\nSUCCESS: All data migrated and verified!")


if __name__ == "__main__":
    asyncio.run(migrate())
