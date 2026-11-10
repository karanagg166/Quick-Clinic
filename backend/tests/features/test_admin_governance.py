"""Administrator onboarding and user governance preserve hierarchy privileges."""

import pytest
from sqlalchemy import delete, func, insert, select

from app.core.security import issue_token
from app.infrastructure.database import new_id, tables


def auth(user):
    return {"Authorization": "Bearer " + issue_token(user)}


async def test_super_admin_onboarding_creates_profile_and_audits_without_secret(client, db, seed_user):
    admin = await seed_user("ADMIN")
    await db.execute(delete(tables["Admin"]).where(tables["Admin"].c.id == admin["adminId"]))
    response = await client.post(
        "/api/admin/onboarding",
        headers=auth(admin),
        json={
            "userId": admin["id"],
            "secretCode": "isolated-test-super-admin-code",
            "name": "Clinic Administrator",
            "age": 40,
        },
    )
    assert response.status_code == 200 and response.json() == {
        "success": True,
        "isActive": True,
        "managerId": None,
    }
    row = (
        (await db.execute(select(tables["Admin"]).where(tables["Admin"].c.userId == admin["id"])))
        .mappings()
        .one()
    )
    assert row["managerId"] is None
    audit = (await db.execute(select(tables["AuditLog"]))).mappings().one()
    assert audit["action"] == "Admin Onboarding" and "secretCode" not in str(audit["metadata"])


async def test_manager_onboarding_requires_activation_and_detailed_hierarchy_is_safe(client, db, seed_user):
    manager, admin = await seed_user("ADMIN"), await seed_user("ADMIN")
    response = await client.post(
        "/api/admin/onboarding",
        headers=auth(admin),
        json={
            "userId": admin["id"],
            "managerEmail": manager["email"],
            "name": "Pending Administrator",
        },
    )
    assert response.status_code == 200 and response.json()["managerId"] == manager["adminId"]
    assert not response.json()["isActive"]
    assert (await client.get("/api/admin/users", headers=auth(admin))).status_code == 401
    details = (await client.get(f"/api/admin/users/{admin['id']}", headers=auth(manager))).json()["user"]
    assert details["admin"]["manager"]["user"] == {key: manager[key] for key in ("id", "name", "email")}
    hierarchy = (await client.get(f"/api/admin/users/{manager['id']}", headers=auth(manager))).json()["user"]
    assert [row["userId"] for row in hierarchy["admin"]["subAdmins"]] == [admin["id"]]
    assert "password" not in details and "password" not in str(details["admin"])


@pytest.mark.parametrize(
    "changes,status",
    [
        ({"userId": "another-user", "secretCode": "isolated-test-super-admin-code"}, 403),
        ({"secretCode": "wrong-code"}, 400),
        ({}, 400),
        ({"managerEmail": "missing@example.test"}, 404),
        ({"secretCode": "isolated-test-super-admin-code", "name": "   "}, 400),
    ],
)
async def test_failed_admin_onboarding_preserves_account_state(client, db, seed_user, changes, status):
    admin = await seed_user("ADMIN")
    response = await client.post(
        "/api/admin/onboarding", headers=auth(admin), json={"userId": admin["id"], **changes}
    )
    assert response.status_code == status
    assert (
        await db.execute(select(tables["User"].c.isActive).where(tables["User"].c.id == admin["id"]))
    ).scalar_one()
    assert (
        await db.execute(select(tables["Admin"].c.managerId).where(tables["Admin"].c.userId == admin["id"]))
    ).scalar_one() is None
    assert (await db.execute(select(func.count()).select_from(tables["AuditLog"]))).scalar_one() == 0


@pytest.mark.parametrize("manager_case", ["self", "inactive", "nonadmin"])
async def test_admin_onboarding_rejects_invalid_manager_identity(client, seed_user, manager_case):
    admin = await seed_user("ADMIN")
    manager = (
        admin
        if manager_case == "self"
        else await seed_user(
            "ADMIN" if manager_case == "inactive" else "PATIENT", isActive=manager_case != "inactive"
        )
    )
    response = await client.post(
        "/api/admin/onboarding",
        headers=auth(admin),
        json={"userId": admin["id"], "managerEmail": manager["email"]},
    )
    assert response.status_code == 404


@pytest.mark.parametrize("role", ["PATIENT", "DOCTOR"])
async def test_nonadministrators_cannot_manage_users_or_financial_reporting(client, seed_user, role):
    actor = await seed_user(role)
    headers = auth(actor)
    for endpoint in ("users", "logs", "analytics", "withdrawals"):
        assert (await client.get(f"/api/admin/{endpoint}", headers=headers)).status_code == 403
    assert (
        await client.patch(f"/api/admin/users/{actor['id']}", headers=headers, json={"isActive": False})
    ).status_code == 403
    assert (await client.delete(f"/api/admin/users/{actor['id']}", headers=headers)).status_code == 403
    assert (
        await client.post(
            "/api/admin/onboarding",
            headers=headers,
            json={"userId": actor["id"], "secretCode": "isolated-test-super-admin-code"},
        )
    ).status_code == 403


async def test_user_search_filters_roles_email_name_phone_and_paginates(client, seed_user):
    admin = await seed_user("ADMIN")
    doctor = await seed_user("DOCTOR", name="Unique Clinician", phoneNo="8888888888")
    await seed_user("PATIENT", name="Unrelated")
    for search in ("unique", doctor["email"], "8888888888"):
        response = await client.get(
            "/api/admin/users", headers=auth(admin), params={"role": "doctor", "search": search}
        )
        assert response.status_code == 200
        assert [row["id"] for row in response.json()["users"]] == [doctor["id"]]
        assert "password" not in response.json()["users"][0]
        assert response.json()["users"][0]["doctor"]["doctorQualifications"] == []
    page = (await client.get("/api/admin/users?limit=1&page=2", headers=auth(admin))).json()
    assert len(page["users"]) == 1
    assert page["pagination"] == {"page": 2, "limit": 1, "totalUsers": 3, "totalPages": 3, "hasMore": True}
    empty = (await client.get("/api/admin/users?search=missing&page=9", headers=auth(admin))).json()
    assert empty["users"] == [] and empty["pagination"]["totalPages"] == 0


@pytest.mark.parametrize("query", ["page=bad", "limit=bad"])
async def test_user_search_rejects_invalid_pagination(client, seed_user, query):
    admin = await seed_user("ADMIN")
    assert (await client.get(f"/api/admin/users?{query}", headers=auth(admin))).status_code == 400


async def test_subadmin_can_deactivate_patient_but_cannot_promote_or_modify_other_admin(
    client, db, seed_user
):
    manager = await seed_user("ADMIN")
    subadmin = await seed_user("ADMIN", profile={"managerId": manager["adminId"]})
    patient = await seed_user()
    headers = auth(subadmin)
    denied = await client.patch(f"/api/admin/users/{patient['id']}", headers=headers, json={"role": "ADMIN"})
    assert denied.status_code == 403
    assert (
        await client.patch(f"/api/admin/users/{manager['id']}", headers=headers, json={"isActive": False})
    ).status_code == 403
    changed = await client.patch(
        f"/api/admin/users/{patient['id']}", headers=headers, json={"isActive": False}
    )
    assert changed.status_code == 200 and not changed.json()["user"]["isActive"]
    assert (await client.get(f"/api/user/{patient['id']}", headers=auth(patient))).status_code == 401


@pytest.mark.parametrize("payload", [{"isActive": "false"}, {"isActive": 0}, {"role": "SUPER_ADMIN"}])
async def test_admin_user_mutations_reject_coerced_boolean_and_unknown_role(client, db, seed_user, payload):
    admin, user = await seed_user("ADMIN"), await seed_user()
    assert (
        await client.patch(f"/api/admin/users/{user['id']}", headers=auth(admin), json=payload)
    ).status_code == 400
    row = (await db.execute(select(tables["User"]).where(tables["User"].c.id == user["id"]))).mappings().one()
    assert row["isActive"] and row["role"] == "PATIENT"


async def test_superadmin_role_change_invalidates_previous_session(client, seed_user):
    admin, user = await seed_user("ADMIN"), await seed_user()
    old_token = auth(user)
    changed = await client.patch(
        f"/api/admin/users/{user['id']}", headers=auth(admin), json={"role": "DOCTOR"}
    )
    assert changed.status_code == 200 and changed.json()["user"]["role"] == "DOCTOR"
    assert (await client.get(f"/api/user/{user['id']}", headers=old_token)).status_code == 401


async def test_superadmin_deletion_cascades_owned_records_and_retains_audit(client, db, seed_user):
    admin, user = await seed_user("ADMIN"), await seed_user()
    await db.execute(insert(tables["Notification"]).values(id=new_id(), userId=user["id"], message="Owned"))
    assert (await client.delete(f"/api/admin/users/{user['id']}", headers=auth(admin))).status_code == 200
    for model in ("Patient", "Notification"):
        assert (
            await db.execute(
                select(func.count()).select_from(tables[model]).where(tables[model].c.userId == user["id"])
            )
        ).scalar_one() == 0
    assert (await client.get(f"/api/admin/users/{user['id']}", headers=auth(admin))).status_code == 404
    audit = (
        (await db.execute(select(tables["AuditLog"]).where(tables["AuditLog"].c.userId == admin["id"])))
        .mappings()
        .one()
    )
    assert audit["action"] == f"Admin Deleted User {user['id']}"


async def test_deletion_requires_superadmin_and_forbids_self_deletion(client, seed_user):
    manager = await seed_user("ADMIN")
    subadmin = await seed_user("ADMIN", profile={"managerId": manager["adminId"]})
    user = await seed_user()
    assert (await client.delete(f"/api/admin/users/{user['id']}", headers=auth(subadmin))).status_code == 403
    assert (
        await client.delete(f"/api/admin/users/{manager['id']}", headers=auth(manager))
    ).status_code == 409
    assert (await client.delete("/api/admin/users/missing", headers=auth(manager))).status_code == 404
