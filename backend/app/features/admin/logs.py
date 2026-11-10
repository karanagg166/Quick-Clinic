"""Administrator log queries with scoped filters and deterministic cursor paging."""

import re
from datetime import UTC, datetime, timedelta

from fastapi import HTTPException
from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncConnection

from app.infrastructure.database import tables, utcnow


def parse_log_limit(raw: str) -> int:
    """Retain the previous parseInt fallback and the public 1–100 limit."""
    match = re.match(r"^[+-]?\d+", raw.strip())
    value = int(match.group()) if match else 50
    return min(100, max(1, value))


def parse_log_timestamp(raw: str | None) -> datetime | None:
    if not raw:
        return None
    try:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        if parsed.tzinfo is not None:
            parsed = parsed.astimezone(UTC).replace(tzinfo=None)
        return parsed
    except (ValueError, OverflowError):
        # Existing clients may submit partial date input while editing filters.
        return None


def date_conditions(log_table, params: dict[str, str]) -> list:
    created_at = log_table.c.createdAt
    if params.get("timeRange") == "last5Mins":
        return [created_at >= utcnow() - timedelta(minutes=5)]
    if params.get("startDate") or params.get("endDate"):
        start = parse_log_timestamp(params.get("startDate"))
        end = parse_log_timestamp(params.get("endDate"))
        conditions = []
        if start is not None:
            conditions.append(created_at >= start)
        if end is not None:
            conditions.append(created_at <= end)
        return conditions
    single_day = parse_log_timestamp(params.get("date"))
    if single_day is not None:
        return [created_at >= single_day, created_at < single_day + timedelta(days=1)]
    return []


async def list_logs(params: dict[str, str], user: dict, db: AsyncConnection) -> dict:
    if user["role"] != "ADMIN":
        raise HTTPException(403, "Forbidden")
    log_table = tables["AccessLog" if params.get("type") == "access" else "AuditLog"]
    users = tables["User"]
    limit = parse_log_limit(params.get("limit", "50"))
    conditions = date_conditions(log_table, params)
    owner_id = user["id"] if params.get("scope") == "my" else params.get("userId")
    if owner_id:
        conditions.append(log_table.c.userId == owner_id)
    if params.get("action"):
        escaped = params["action"].replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        conditions.append(log_table.c.action.ilike(f"%{escaped}%", escape="\\"))
    if params.get("tag"):
        conditions.append(log_table.c.tag == params["tag"])
    if params.get("role"):
        role = params["role"].upper()
        if role not in {"ADMIN", "DOCTOR", "PATIENT"}:
            raise HTTPException(400, "Invalid role filter")
        conditions.append(users.c.role == role)
    if params.get("cursor"):
        cursor = (
            await db.execute(
                select(log_table.c.id, log_table.c.createdAt).where(log_table.c.id == params["cursor"])
            )
        ).first()
        if cursor is None:
            return {"logs": [], "pagination": {"limit": limit, "nextCursor": None, "hasMore": False}}
        conditions.append(
            or_(
                log_table.c.createdAt < cursor.createdAt,
                and_(log_table.c.createdAt == cursor.createdAt, log_table.c.id < cursor.id),
            )
        )
    statement = (
        select(
            log_table,
            users.c.id.label("actor_id"),
            users.c.name.label("actor_name"),
            users.c.email.label("actor_email"),
            users.c.role.label("actor_role"),
        )
        .select_from(log_table.outerjoin(users, log_table.c.userId == users.c.id))
        .where(*conditions)
        .order_by(log_table.c.createdAt.desc(), log_table.c.id.desc())
        .limit(limit + 1)
    )
    rows = (await db.execute(statement)).mappings().all()
    has_more = len(rows) > limit
    logs = []
    for row in rows[:limit]:
        entry = {column.name: row[column.name] for column in log_table.columns}
        entry["user"] = (
            {
                "id": row["actor_id"],
                "name": row["actor_name"],
                "email": row["actor_email"],
                "role": row["actor_role"],
            }
            if row["actor_id"] is not None
            else None
        )
        logs.append(entry)
    return {
        "logs": logs,
        "pagination": {
            "limit": limit,
            "nextCursor": logs[-1]["id"] if has_more else None,
            "hasMore": has_more,
        },
    }
