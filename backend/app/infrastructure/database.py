"""SQLAlchemy mappings retain existing PostgreSQL names and data; never create tables at startup."""

import json
from collections.abc import AsyncIterator, Mapping
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4
from sqlalchemy import (
    JSON,
    Boolean,
    Column,
    Date,
    DateTime,
    Enum,
    Float,
    Index,
    Integer,
    MetaData,
    String,
    Table,
    UniqueConstraint,
    ForeignKey,
    text,
)
from sqlalchemy.ext.asyncio import AsyncConnection, create_async_engine
from app.core.config import get_settings


def new_id() -> str:
    return "c" + uuid4().hex


def utcnow() -> datetime:
    # Prisma PostgreSQL DateTime uses timestamp without timezone, containing UTC.
    return datetime.now(UTC).replace(tzinfo=None)


schema = json.loads(Path(__file__).with_name("schema.json").read_text())
metadata = MetaData()
tables: dict[str, Table] = {}
for name, model in schema["models"].items():
    columns = []
    for field in model["fields"]:
        kind = field["type"]
        types = {
            "String": String,
            "Int": Integer,
            "Float": Float,
            "Boolean": Boolean,
            "DateTime": Date if field["date"] else DateTime,
            "Json": JSON,
        }
        datatype = types.get(kind)
        if datatype is None:
            datatype = Enum(*schema["enums"][kind], name=kind, validate_strings=True)
        options = dict(
            primary_key=field["primary"],
            nullable=field["nullable"] and not field["primary"],
            unique=field["unique"] and not field["primary"],
        )
        if "default" in field:
            value = field["default"]
            options["default"] = new_id if value == "__id__" else utcnow if value == "__now__" else value
            if value == "__now__":
                options["server_default"] = text("CURRENT_TIMESTAMP")
            elif isinstance(value, bool):
                options["server_default"] = text("true" if value else "false")
            elif isinstance(value, int):
                options["server_default"] = text(str(value))
            elif value != "__id__":
                options["server_default"] = text("'" + value.replace("'", "''") + "'")
        if field["updated"]:
            options["onupdate"] = utcnow
            options.setdefault("default", utcnow)
        args = (
            [ForeignKey(field["foreign_key"], ondelete=field["on_delete"])] if "foreign_key" in field else []
        )
        columns.append(Column(field["name"], datatype, *args, **options))
    constraints = [
        UniqueConstraint(*fields, name=f"{name}_{'_'.join(fields)}_key") for fields in model["unique"]
    ]
    table = tables[name] = Table(name, metadata, *columns, *constraints)
    for fields in model["indexes"]:
        Index(f"{name}_{'_'.join(fields)}_idx", *[table.c[f] for f in fields])
Index(
    "Appointment_active_slot_unique",
    tables["Appointment"].c.slotId,
    unique=True,
    postgresql_where=text("\"status\" IN ('PENDING', 'CONFIRMED', 'COMPLETED', 'NO_SHOW')"),
    sqlite_where=text("\"status\" IN ('PENDING', 'CONFIRMED', 'COMPLETED', 'NO_SHOW')"),
)


def database_url() -> str:
    url = get_settings().database_url
    if url.startswith("postgres://"):
        url = "postgresql://" + url[len("postgres://") :]
    if url.startswith("postgresql://"):
        url = url.replace("postgresql://", "postgresql+asyncpg://", 1)
        # libpq options are not asyncpg connect arguments.
        from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

        parsed = urlsplit(url)
        query = dict(parse_qsl(parsed.query))
        sslmode = query.pop("sslmode", None)
        query.pop("channel_binding", None)
        query.pop("pgbouncer", None)
        if sslmode and sslmode != "disable":
            query["ssl"] = "require" if sslmode in ("require", "prefer") else sslmode
        url = urlunsplit(parsed._replace(query=urlencode(query)))
    return url


engine = create_async_engine(database_url(), pool_pre_ping=True)


async def get_db() -> AsyncIterator[AsyncConnection]:
    async with engine.connect() as connection:
        try:
            yield connection
            await connection.commit()
        except BaseException:
            await connection.rollback()
            raise


def public_user(row: Mapping) -> dict:
    return {key: value for key, value in dict(row).items() if key != "password"}
