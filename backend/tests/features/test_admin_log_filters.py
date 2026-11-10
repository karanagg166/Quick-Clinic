"""Log searches escape wildcard input and retain deleted or system actors."""

from datetime import timedelta

from sqlalchemy import insert

from app.core.security import issue_token
from app.infrastructure.database import new_id, tables, utcnow


def auth(user):
    return {"Authorization": "Bearer " + issue_token(user)}


async def test_log_action_search_treats_sql_wildcards_as_literal_characters(client, db, seed_user):
    admin = await seed_user("ADMIN")
    await db.execute(
        insert(tables["AuditLog"]),
        [
            {"id": "literal", "userId": admin["id"], "action": "Progress 100%_done"},
            {"id": "wildcard", "userId": admin["id"], "action": "Progress 100XXdone"},
        ],
    )
    response = await client.get("/api/admin/logs", headers=auth(admin), params={"action": "100%_"})
    assert response.status_code == 200
    assert [row["id"] for row in response.json()["logs"]] == ["literal"]


async def test_log_date_range_is_inclusive_and_actor_filter_remains_scoped(client, db, seed_user):
    admin, other = await seed_user("ADMIN"), await seed_user("DOCTOR")
    start = utcnow() - timedelta(days=2)
    end = start + timedelta(hours=1)
    await db.execute(
        insert(tables["AuditLog"]),
        [
            {"id": "start", "userId": other["id"], "action": "Event", "createdAt": start},
            {"id": "end", "userId": other["id"], "action": "Event", "createdAt": end},
            {
                "id": "outside",
                "userId": other["id"],
                "action": "Event",
                "createdAt": end + timedelta(seconds=1),
            },
            {"id": "wrong-actor", "userId": admin["id"], "action": "Event", "createdAt": start},
        ],
    )
    response = await client.get(
        "/api/admin/logs",
        headers=auth(admin),
        params={
            "startDate": start.isoformat(),
            "endDate": end.isoformat(),
            "userId": other["id"],
        },
    )
    assert response.status_code == 200
    assert [row["id"] for row in response.json()["logs"]] == ["end", "start"]


async def test_invalid_log_role_is_rejected_and_unknown_cursor_is_empty(client, db, seed_user):
    admin = await seed_user("ADMIN")
    await db.execute(insert(tables["AuditLog"]).values(id=new_id(), userId=None, action="System event"))
    assert (await client.get("/api/admin/logs?role=SUPER_ADMIN", headers=auth(admin))).status_code == 400
    response = await client.get("/api/admin/logs?cursor=missing", headers=auth(admin))
    assert response.status_code == 200
    assert response.json() == {"logs": [], "pagination": {"limit": 50, "nextCursor": None, "hasMore": False}}
