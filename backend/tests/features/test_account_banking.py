"""Banking validates account formats and prevents crossing account boundaries."""

import pytest
from sqlalchemy import func, select

from app.core.security import issue_token
from app.infrastructure.database import tables


def auth(user):
    return {"Authorization": "Bearer " + issue_token(user)}


def bank(**changes):
    return {
        "bankAccountNumber": "123456789012",
        "bankIFSC": "ABCD0123456",
        "bankAccountHolderName": "Test Doctor",
        "bankName": "Test Bank",
        **changes,
    }


async def test_bank_creation_normalizes_fields_and_update_does_not_duplicate(client, db, seed_user):
    doctor = await seed_user("DOCTOR")
    url = f"/api/user/{doctor['id']}/bank-details"
    empty = await client.get(url, headers=auth(doctor))
    assert empty.status_code == 200 and all(value is None for value in empty.json().values())
    saved = await client.patch(
        url, headers=auth(doctor), json=bank(bankIFSC="abcd0123456", bankName=" Test Bank ")
    )
    assert saved.status_code == 200 and saved.json()["bankDetails"]["bankIFSC"] == "ABCD0123456"
    assert saved.json()["bankDetails"]["bankName"] == "Test Bank"
    updated = await client.patch(
        f"/api/doctors/{doctor['doctorId']}/bank-details",
        headers=auth(doctor),
        json=bank(bankAccountNumber="987654321"),
    )
    assert updated.status_code == 200
    assert (await client.get(url, headers=auth(doctor))).json()["bankAccountNumber"] == "987654321"
    assert (await db.execute(select(func.count()).select_from(tables["BankAccount"]))).scalar_one() == 1


@pytest.mark.parametrize(
    "changes",
    [
        {"bankAccountNumber": "12345678"},
        {"bankAccountNumber": "1" * 19},
        {"bankAccountNumber": "12345678a"},
        {"bankIFSC": "ABCD1123456"},
        {"bankIFSC": "12340123456"},
        {"bankAccountHolderName": "   "},
        {"bankName": ""},
    ],
)
async def test_bank_validation_rejects_invalid_values_without_partial_rows(client, db, seed_user, changes):
    user = await seed_user()
    response = await client.patch(
        f"/api/user/{user['id']}/bank-details", headers=auth(user), json=bank(**changes)
    )
    assert response.status_code == 400
    assert (await db.execute(select(func.count()).select_from(tables["BankAccount"]))).scalar_one() == 0


@pytest.mark.parametrize("method", ["get", "patch"])
async def test_bank_routes_deny_other_patient_or_doctor_but_allow_admin(client, seed_user, method):
    doctor, stranger, admin = await seed_user("DOCTOR"), await seed_user("DOCTOR"), await seed_user("ADMIN")
    kwargs = {"json": bank()} if method == "patch" else {}
    for url in (f"/api/user/{doctor['id']}/bank-details", f"/api/doctors/{doctor['doctorId']}/bank-details"):
        assert (await client.request(method, url, headers=auth(stranger), **kwargs)).status_code == 403
        assert (await client.request(method, url, headers=auth(admin), **kwargs)).status_code == 200


async def test_missing_doctor_bank_owner_is_404(client, seed_user):
    admin = await seed_user("ADMIN")
    assert (await client.get("/api/doctors/missing/bank-details", headers=auth(admin))).status_code == 404
    assert (
        await client.patch("/api/user/missing/bank-details", headers=auth(admin), json=bank())
    ).status_code == 404


async def test_duplicate_bank_number_conflict_does_not_modify_other_owners_record(client, db, seed_user):
    first, second = await seed_user(), await seed_user()
    assert (
        await client.patch(f"/api/user/{first['id']}/bank-details", headers=auth(first), json=bank())
    ).status_code == 200
    response = await client.patch(
        f"/api/user/{second['id']}/bank-details", headers=auth(second), json=bank(bankName="Attacker Bank")
    )
    assert response.status_code == 409
    row = (await db.execute(select(tables["BankAccount"]))).mappings().one()
    assert row["userId"] == first["id"] and row["bankName"] == "Test Bank"
