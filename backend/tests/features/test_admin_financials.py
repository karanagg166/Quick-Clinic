"""Financial reports use paise consistently and withdrawal decisions are final."""

from datetime import timedelta

import pytest
from sqlalchemy import insert, select

from app.core.security import issue_token
from app.infrastructure.database import new_id, tables, utcnow


def auth(user):
    return {"Authorization": "Bearer " + issue_token(user)}


async def withdrawal(db, doctor, status="PENDING", amount=12345):
    identifier = new_id()
    await db.execute(
        insert(tables["Withdrawal"]).values(
            id=identifier, doctorId=doctor["doctorId"], amount=amount, status=status
        )
    )
    return identifier


async def test_analytics_reports_active_roles_success_only_money_and_recent_login(client, db, seed_user):
    admin, doctor = await seed_user("ADMIN"), await seed_user("DOCTOR")
    await seed_user("DOCTOR", isActive=False)
    patient = await seed_user()
    for status, amount in (("SUCCESS", 12345), ("FAILED", 99999), ("CREATED", 99999)):
        await db.execute(
            insert(tables["Payment"]).values(
                id=new_id(), userId=patient["id"], amount=amount, status=status, razorpayOrderId=new_id()
            )
        )
    await withdrawal(db, doctor, "COMPLETED", 2000)
    await withdrawal(db, doctor, "FAILED", 9000)
    await db.execute(
        insert(tables["AuditLog"]),
        [
            {"id": new_id(), "userId": admin["id"], "action": "User Login", "createdAt": utcnow()},
            {
                "id": new_id(),
                "userId": admin["id"],
                "action": "User Login",
                "createdAt": utcnow() - timedelta(days=2),
            },
            {"id": new_id(), "userId": admin["id"], "action": "Updated Profile", "createdAt": utcnow()},
        ],
    )
    response = await client.get("/api/admin/analytics", headers=auth(admin))
    assert response.status_code == 200
    result = response.json()
    assert result["users"] == {"total": 4, "doctors": 2, "patients": 1, "admins": 1, "activeDoctors": 1}
    assert result["appointments"] == {"total": 0, "completed": 0, "cancelled": 0}
    assert result["activity"] == {"recentLogins24h": 1}
    assert result["financials"] == {
        "grossTransactionVolumePaise": 12345,
        "grossTransactionVolumeRupees": 123.45,
        "successfulPaymentsCount": 1,
        "totalWithdrawnPaise": 2000,
        "totalWithdrawnRupees": 20,
        "approvedWithdrawalsCount": 1,
    }


async def test_empty_analytics_financials_are_numeric_zero(client, seed_user):
    admin = await seed_user("ADMIN")
    response = await client.get("/api/admin/analytics", headers=auth(admin))
    assert response.status_code == 200 and all(value == 0 for value in response.json()["financials"].values())


@pytest.mark.parametrize(
    "requested,stored", [("approved", "COMPLETED"), ("rejected", "FAILED"), ("PROCESSING", "PROCESSING")]
)
async def test_withdrawal_filters_support_legacy_status_aliases_and_doctor_scope(
    client, db, seed_user, requested, stored
):
    admin, doctor, other = await seed_user("ADMIN"), await seed_user("DOCTOR"), await seed_user("DOCTOR")
    identifier = await withdrawal(db, doctor, stored)
    await withdrawal(db, other, stored)
    await withdrawal(db, doctor, "PENDING")
    response = await client.get(
        "/api/admin/withdrawals",
        headers=auth(admin),
        params={"status": requested, "doctorId": doctor["doctorId"]},
    )
    assert response.status_code == 200
    (row,) = response.json()["withdrawals"]
    assert row["id"] == identifier and row["amountInRupees"] == 123.45
    assert row["bankAccountNumber"] == "N/A" and row["doctorEmail"] == doctor["email"]


@pytest.mark.parametrize(
    "decision,expected_status,expected_balance",
    [
        ("APPROVED", "COMPLETED", 5000),
        ("COMPLETED", "COMPLETED", 5000),
        ("REJECTED", "FAILED", 17345),
        ("FAILED", "FAILED", 17345),
        ("CANCELLED", "FAILED", 17345),
    ],
)
async def test_withdrawal_finalization_completes_or_releases_reservation_exactly_once(
    client, db, seed_user, decision, expected_status, expected_balance
):
    admin = await seed_user("ADMIN")
    doctor = await seed_user("DOCTOR", profile={"balance": 5000})
    identifier = await withdrawal(db, doctor, "PROCESSING")
    payload = {"withdrawalId": identifier, "status": decision, "failureReason": "Bank rejected account"}
    response = await client.patch("/api/admin/withdrawals", headers=auth(admin), json=payload)
    assert response.status_code == 200
    result = response.json()["withdrawal"]
    assert result["status"] == expected_status and result["processedAt"] is not None
    if expected_status == "FAILED":
        assert result["failureReason"] == "Bank rejected account"
    assert (
        await client.patch("/api/admin/withdrawals", headers=auth(admin), json=payload)
    ).status_code == 409
    balance = (
        await db.execute(
            select(tables["Doctor"].c.balance).where(tables["Doctor"].c.id == doctor["doctorId"])
        )
    ).scalar_one()
    assert balance == expected_balance
    audit = (
        (await db.execute(select(tables["AuditLog"]).where(tables["AuditLog"].c.userId == admin["id"])))
        .mappings()
        .all()
    )
    assert len(audit) == 1 and audit[0]["metadata"]["amount"] == 12345


@pytest.mark.parametrize("status", ["PENDING", "PROCESSING", "UNKNOWN"])
async def test_withdrawal_rejects_nonfinal_decision_without_balance_change(client, db, seed_user, status):
    admin, doctor = await seed_user("ADMIN"), await seed_user("DOCTOR", profile={"balance": 5000})
    identifier = await withdrawal(db, doctor)
    response = await client.patch(
        "/api/admin/withdrawals", headers=auth(admin), json={"withdrawalId": identifier, "status": status}
    )
    assert response.status_code == 400
    assert (
        await db.execute(select(tables["Withdrawal"].c.status).where(tables["Withdrawal"].c.id == identifier))
    ).scalar_one() == "PENDING"
    assert (
        await db.execute(
            select(tables["Doctor"].c.balance).where(tables["Doctor"].c.id == doctor["doctorId"])
        )
    ).scalar_one() == 5000


async def test_missing_withdrawal_and_invalid_filter_return_client_errors(client, seed_user):
    admin = await seed_user("ADMIN")
    assert (await client.get("/api/admin/withdrawals?status=UNKNOWN", headers=auth(admin))).status_code == 400
    assert (
        await client.patch(
            "/api/admin/withdrawals",
            headers=auth(admin),
            json={"withdrawalId": "missing", "status": "APPROVED"},
        )
    ).status_code == 404
