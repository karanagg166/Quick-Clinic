"""Doctor earnings and atomic withdrawal reservations, with paise accounting."""

from datetime import timedelta
from fastapi import HTTPException
from sqlalchemy import func, insert, select, update
from sqlalchemy.ext.asyncio import AsyncConnection
from app.infrastructure.database import new_id, tables, utcnow
from .repository import (
    doctors_table,
    users_table,
    appointments_table,
    patients_table,
    slots_table,
    withdrawals_table,
    bank_accounts_table,
    owned_doctor,
)


async def get_balance(doctor_id: str, user, db: AsyncConnection):
    doctor = await owned_doctor(db, doctor_id, user)
    return {"balance": doctor["balance"], "balanceInRupees": doctor["balance"] / 100, "fees": doctor["fees"]}


async def list_earnings(doctor_id: str, filters, user, db: AsyncConnection):
    doctor = await owned_doctor(db, doctor_id, user)
    stmt = (
        select(appointments_table.c.id, slots_table.c.startTime, users_table.c.name)
        .join(slots_table, appointments_table.c.slotId == slots_table.c.id)
        .join(patients_table, appointments_table.c.patientId == patients_table.c.id)
        .join(users_table, patients_table.c.userId == users_table.c.id)
        .where(appointments_table.c.doctorId == doctor_id, appointments_table.c.status == "COMPLETED")
    )
    for key, comparison in (("startDate", "ge"), ("endDate", "le")):
        if filters.get(key):
            from app.features.scheduling.validation import parse_datetime

            time = filters.get(
                "startTime" if key == "startDate" else "endTime",
                "00:00:00" if key == "startDate" else "23:59:59",
            )
            value = parse_datetime(filters[key] + "T" + time)
            stmt = stmt.where(
                slots_table.c.startTime >= value if comparison == "ge" else slots_table.c.startTime <= value
            )
    rows = (await db.execute(stmt.order_by(slots_table.c.startTime.desc()))).mappings().all()
    items = [
        {
            "id": r["id"],
            "earned": doctor["fees"],
            "patientName": r["name"],
            "appointmentDateTime": r["startTime"],
        }
        for r in rows
    ]
    return {"total": doctor["fees"] * len(items), "count": len(items), "earnings": items}


async def get_doctor_statistics(doctor_id: str, user, db: AsyncConnection):
    doctor = await owned_doctor(db, doctor_id, user)
    today = utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    stmt = (
        select(appointments_table.c.status, slots_table.c.startTime)
        .join(slots_table, appointments_table.c.slotId == slots_table.c.id)
        .where(appointments_table.c.doctorId == doctor_id)
    )
    rows = (await db.execute(stmt)).mappings().all()
    relation = tables["DoctorPatientRelation"]
    count = (
        await db.execute(
            select(func.count()).select_from(relation).where(relation.c.doctorsUserId == doctor["userId"])
        )
    ).scalar()
    return {
        "todayAppointments": sum(
            (
                r["status"] in ("PENDING", "CONFIRMED")
                and today <= r["startTime"] < today + timedelta(days=1)
                for r in rows
            )
        ),
        "activePatients": count,
        "pendingConsults": sum((r["status"] == "PENDING" for r in rows)),
        "monthlyEarnings": doctor["fees"]
        * sum(
            (
                r["status"] == "COMPLETED"
                and r["startTime"].year == today.year
                and (r["startTime"].month == today.month)
                for r in rows
            )
        ),
    }


async def list_withdrawals(doctor_id: str, user, db: AsyncConnection):
    doctor = await owned_doctor(db, doctor_id, user)
    bank = (
        (
            await db.execute(
                select(bank_accounts_table).where(bank_accounts_table.c.userId == doctor["userId"])
            )
        )
        .mappings()
        .first()
    )
    rows = (
        (
            await db.execute(
                select(withdrawals_table)
                .where(withdrawals_table.c.doctorId == doctor_id)
                .order_by(withdrawals_table.c.createdAt.desc())
            )
        )
        .mappings()
        .all()
    )
    fields = {k: bank[k] if bank else "N/A" for k in ("bankIFSC", "bankAccountHolderName", "bankName")}
    fields["bankAccountNumber"] = "********" + bank["bankAccountNumber"][-4:] if bank else "N/A"
    return [{**dict(row), **fields, "amountInRupees": row["amount"] / 100} for row in rows]


async def request_withdrawal(doctor_id: str, body, user, db: AsyncConnection):
    doctor = await owned_doctor(db, doctor_id, user, lock=True)
    amount = body.get("amount")
    if isinstance(amount, bool) or not isinstance(amount, int) or amount < 100:
        raise HTTPException(400, "Minimum withdrawal amount is ₹100 (integer rupees)")
    bank = (
        (
            await db.execute(
                select(bank_accounts_table).where(bank_accounts_table.c.userId == doctor["userId"])
            )
        )
        .mappings()
        .first()
    )
    if not bank:
        raise HTTPException(400, "Bank details not set. Please add bank details first.")
    result = await db.execute(
        update(doctors_table)
        .where(doctors_table.c.id == doctor_id, doctors_table.c.balance >= amount * 100)
        .values(balance=doctors_table.c.balance - amount * 100, updatedAt=utcnow())
    )
    if not result.rowcount:
        raise HTTPException(400, "Insufficient balance")
    withdrawal_id = new_id()
    await db.execute(
        insert(withdrawals_table).values(
            id=withdrawal_id, doctorId=doctor_id, amount=amount * 100, currency="INR", status="PENDING"
        )
    )
    row = dict(
        (await db.execute(select(withdrawals_table).where(withdrawals_table.c.id == withdrawal_id)))
        .mappings()
        .one()
    )
    return {
        "message": "Withdrawal request created successfully",
        "withdrawal": {
            **row,
            "amountInRupees": amount,
            "bankAccountNumber": "********" + bank["bankAccountNumber"][-4:],
            **{k: bank[k] for k in ("bankIFSC", "bankAccountHolderName", "bankName")},
        },
    }
