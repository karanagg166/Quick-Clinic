"""Account and inbox operations retain ownership and public response boundaries."""

from datetime import timedelta

import pytest
from sqlalchemy import func, insert, select

from app.core.security import issue_token
from app.infrastructure.database import new_id, tables, utcnow


def auth(user):
    return {"Authorization": "Bearer " + issue_token(user)}


async def test_profile_partial_update_preserves_unset_fields_and_sensitive_columns(client, db, seed_user):
    user = await seed_user()
    response = await client.patch(
        f"/api/user/{user['id']}",
        headers=auth(user),
        json={
            "name": "Updated",
            "age": 0,
            "pinCode": 560001,
            "city": "Bengaluru",
            "state": "Karnataka",
            "role": "ADMIN",
            "password": "injected",
            "email": "attacker@example.test",
            "isActive": False,
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["name"] == "Updated" and body["age"] == 0 and body["city"] == "Bengaluru"
    assert body["phoneNo"] == user["phoneNo"] and body["patientId"] == user["patientId"]
    stored = (
        (await db.execute(select(tables["User"]).where(tables["User"].c.id == user["id"]))).mappings().one()
    )
    assert stored["role"] == "PATIENT" and stored["password"] == user["password"]
    assert stored["email"] == user["email"] and stored["isActive"]
    assert not {"password", "isActive", "bankAccountNumber"}.intersection(body)
    audit = (await db.execute(select(tables["AuditLog"]))).mappings().one()
    assert set(audit["metadata"]["updatedFields"]) == {"name", "age", "pinCode"}


@pytest.mark.parametrize(
    "payload",
    [
        {"name": " "},
        {"phoneNo": ""},
        {"address": None},
        {"age": -1},
        {"age": 151},
        {"age": None},
        {"gender": "UNKNOWN"},
        {"pinCode": 99999},
    ],
)
async def test_invalid_profile_changes_are_atomic(client, db, seed_user, payload):
    user = await seed_user()
    response = await client.patch(
        f"/api/user/{user['id']}", headers=auth(user), json={"name": "Uncommitted", **payload}
    )
    assert response.status_code == 400
    stored = (
        (await db.execute(select(tables["User"]).where(tables["User"].c.id == user["id"]))).mappings().one()
    )
    assert stored["name"] == user["name"] and stored["pinCode"] == 110001
    assert (await db.execute(select(func.count()).select_from(tables["AuditLog"]))).scalar_one() == 0


async def test_admin_can_read_update_profile_but_missing_targets_remain_404(client, seed_user):
    admin, patient = await seed_user("ADMIN"), await seed_user()
    headers = auth(admin)
    assert (await client.get(f"/api/user/{patient['id']}", headers=headers)).status_code == 200
    result = await client.patch(f"/api/user/{patient['id']}", headers=headers, json={"age": 150})
    assert result.status_code == 200 and result.json()["age"] == 150
    for method in ("get", "patch"):
        response = await client.request(
            method,
            "/api/user/missing",
            headers=headers,
            **({"json": {"name": "Missing"}} if method == "patch" else {}),
        )
        assert response.status_code == 404


async def test_existing_postcode_is_reused_without_mutating_other_accounts_location(client, db, seed_user):
    user = await seed_user()
    response = await client.patch(
        f"/api/user/{user['id']}",
        headers=auth(user),
        json={
            "pinCode": 110001,
            "city": "Injected City",
            "state": "Injected State",
        },
    )
    assert response.status_code == 200
    assert response.json()["city"] == "Delhi"
    assert (await db.execute(select(func.count()).select_from(tables["Location"]))).scalar_one() == 1


async def notification(db, user, message, *, created_at=None):
    identifier = new_id()
    await db.execute(
        insert(tables["Notification"]).values(
            id=identifier,
            userId=user["id"],
            message=message,
            createdAt=created_at or utcnow(),
        )
    )
    return identifier


async def test_inbox_orders_only_owners_messages_and_read_delete_persist(client, db, seed_user):
    user, other = await seed_user(), await seed_user()
    older = await notification(db, user, "Old", created_at=utcnow() - timedelta(days=1))
    newer = await notification(db, user, "New")
    await notification(db, other, "Private other inbox")
    url, headers = f"/api/user/{user['id']}/notification", auth(user)
    response = await client.get(url, headers=headers)
    assert response.status_code == 200
    assert [row["id"] for row in response.json()] == [newer, older]
    read = await client.patch(f"{url}/{newer}", headers=headers)
    assert read.status_code == 200 and read.json()["isRead"]
    assert read.json()["status"] == "READ" and read.json()["readAt"] is not None
    assert (await client.patch(f"{url}/{newer}", headers=headers)).status_code == 200
    assert (await client.delete(f"{url}/{older}", headers=headers)).status_code == 200
    assert [row["id"] for row in (await client.get(url, headers=headers)).json()] == [newer]
    assert (await client.delete(f"{url}/{older}", headers=headers)).status_code == 403


@pytest.mark.parametrize("method", ["get", "patch", "delete"])
async def test_inbox_idor_rejects_other_user_and_forged_notification_id(client, db, seed_user, method):
    user, other = await seed_user(), await seed_user()
    identifier = await notification(db, other, "Private")
    base = f"/api/user/{other['id']}/notification"
    assert (
        await client.request(method, base + (f"/{identifier}" if method != "get" else ""), headers=auth(user))
    ).status_code == 403
    if method != "get":
        forged = await client.request(
            method, f"/api/user/{user['id']}/notification/{identifier}", headers=auth(user)
        )
        assert forged.status_code == 403
    row = (
        (await db.execute(select(tables["Notification"]).where(tables["Notification"].c.id == identifier)))
        .mappings()
        .one()
    )
    assert not row["isRead"]


async def test_empty_inbox_and_administrator_inbox_access(client, seed_user):
    user, admin = await seed_user(), await seed_user("ADMIN")
    response = await client.get(f"/api/user/{user['id']}/notification", headers=auth(admin))
    assert response.status_code == 200 and response.json() == []
