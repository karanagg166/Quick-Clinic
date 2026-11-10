"""Log filters preserve administrator boundaries and stable cursor traversal."""

from datetime import timedelta

from sqlalchemy import insert

from app.core.security import issue_token
from app.infrastructure.database import tables, utcnow


def auth(user):
    return {"Authorization": "Bearer " + issue_token(user)}


async def test_logs_require_active_admin_and_scope_my_ignores_client_user(client, db, seed_user):
    admin = await seed_user("ADMIN")
    other = await seed_user("ADMIN")
    patient = await seed_user("PATIENT")
    await db.execute(
        insert(tables["AuditLog"]),
        [
            {
                "id": "own-log",
                "userId": admin["id"],
                "action": "User Login",
                "tag": "AUTH",
                "metadata": {"result": "success"},
            },
            {
                "id": "other-log",
                "userId": other["id"],
                "action": "Other Login",
                "tag": "AUTH",
                "metadata": None,
            },
        ],
    )
    assert (await client.get("/api/admin/logs")).status_code == 401
    assert (await client.get("/api/admin/logs", headers=auth(patient))).status_code == 403
    response = await client.get(
        "/api/admin/logs", headers=auth(admin), params={"scope": "my", "userId": other["id"]}
    )
    assert response.status_code == 200
    assert [row["id"] for row in response.json()["logs"]] == ["own-log"]
    actor = response.json()["logs"][0]["user"]
    assert actor == {key: admin[key] for key in ("id", "name", "email", "role")}
    assert "password" not in actor


async def test_log_cursor_pagination_orders_equal_timestamps_without_duplicates(client, db, seed_user):
    admin = await seed_user("ADMIN")
    timestamp = utcnow()
    await db.execute(
        insert(tables["AuditLog"]),
        [
            {"id": identifier, "userId": admin["id"], "action": "Login", "createdAt": timestamp}
            for identifier in ("log-a", "log-c", "log-b")
        ],
    )
    first = (await client.get("/api/admin/logs?limit=2", headers=auth(admin))).json()
    assert [row["id"] for row in first["logs"]] == ["log-c", "log-b"]
    assert first["pagination"] == {"limit": 2, "nextCursor": "log-b", "hasMore": True}
    second = (
        await client.get("/api/admin/logs", params={"limit": "2", "cursor": "log-b"}, headers=auth(admin))
    ).json()
    assert [row["id"] for row in second["logs"]] == ["log-a"]
    assert second["pagination"] == {"limit": 2, "nextCursor": None, "hasMore": False}


async def test_log_type_role_action_tag_and_time_filters(client, db, seed_user):
    admin = await seed_user("ADMIN")
    doctor = await seed_user("DOCTOR")
    now = utcnow()
    await db.execute(
        insert(tables["AccessLog"]),
        [
            {
                "id": "recent-match",
                "userId": doctor["id"],
                "targetId": "patient",
                "action": "Viewed Medical Profile",
                "tag": "MEDICAL",
                "createdAt": now,
            },
            {
                "id": "old-match",
                "userId": doctor["id"],
                "targetId": "patient",
                "action": "Viewed Medical Profile",
                "tag": "MEDICAL",
                "createdAt": now - timedelta(days=2),
            },
            {
                "id": "wrong-role",
                "userId": admin["id"],
                "targetId": "patient",
                "action": "Viewed Medical Profile",
                "tag": "MEDICAL",
                "createdAt": now,
            },
        ],
    )
    params = {
        "type": "access",
        "role": "DOCTOR",
        "action": "medical",
        "tag": "MEDICAL",
        "timeRange": "last5Mins",
    }
    response = await client.get("/api/admin/logs", params=params, headers=auth(admin))
    assert response.status_code == 200
    assert [row["id"] for row in response.json()["logs"]] == ["recent-match"]
    assert response.json()["logs"][0]["targetId"] == "patient"
    assert "metadata" not in response.json()["logs"][0]
    day = (now - timedelta(days=2)).date().isoformat()
    response = await client.get(
        "/api/admin/logs", params={"type": "access", "date": day}, headers=auth(admin)
    )
    assert [row["id"] for row in response.json()["logs"]] == ["old-match"]


async def test_logs_retain_system_actor_and_bound_limit_with_invalid_dates(client, db, seed_user):
    admin = await seed_user("ADMIN")
    await db.execute(
        insert(tables["AuditLog"]).values(id="system-event", userId=None, action="Reconciliation finished")
    )
    response = await client.get(
        "/api/admin/logs", params={"startDate": "invalid", "limit": "999"}, headers=auth(admin)
    )
    assert response.status_code == 200
    assert response.json()["pagination"]["limit"] == 100
    assert response.json()["logs"][0]["user"] is None
    fallback = await client.get("/api/admin/logs?limit=invalid", headers=auth(admin))
    assert fallback.json()["pagination"]["limit"] == 50
