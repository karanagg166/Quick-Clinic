"""Create a fresh development/test database. Never use to change an existing production schema."""

import asyncio
from sqlalchemy import text
from app.infrastructure.database import engine, metadata


async def main():
    async with engine.begin() as db:
        await db.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
        await db.run_sync(metadata.create_all)
    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
