"""Withdrawal decisions retain row locks and compare-and-set finalization."""

from fastapi import HTTPException
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncConnection
from app.infrastructure.database import tables, utcnow
from app.infrastructure.audit import record_audit_event


async def list_withdrawals(params: dict[str, str], user: dict, db: AsyncConnection):
    table, doctor, users, bank = (tables[key] for key in ("Withdrawal", "Doctor", "User", "BankAccount"))
    query = select(table).order_by(table.c.createdAt.desc())
    status = params.get("status", "").upper()
    status = {"APPROVED": "COMPLETED", "REJECTED": "FAILED"}.get(status, status)
    if status:
        if status not in {"PENDING", "PROCESSING", "COMPLETED", "FAILED", "CANCELLED"}:
            raise HTTPException(400, "Invalid status")
        query = query.where(table.c.status == status)
    if params.get("doctorId"):
        query = query.where(table.c.doctorId == params["doctorId"])
    result = []
    for row in (await db.execute(query.limit(500))).mappings():
        owner = (
            (
                await db.execute(
                    select(users)
                    .select_from(users.join(doctor, doctor.c.userId == users.c.id))
                    .where(doctor.c.id == row["doctorId"])
                )
            )
            .mappings()
            .one()
        )
        bank_account = (await db.execute(select(bank).where(bank.c.userId == owner["id"]))).mappings().first()
        result.append(
            {
                **dict(row),
                "doctorName": owner["name"],
                "doctorEmail": owner["email"],
                "amountInRupees": row["amount"] / 100,
                "bankAccountNumber": "********" + bank_account["bankAccountNumber"][-4:]
                if bank_account
                else "N/A",
                "bankIFSC": bank_account["bankIFSC"] if bank_account else "N/A",
                "bankName": bank_account["bankName"] if bank_account else "N/A",
            }
        )
    return {"withdrawals": result}


async def finalize_withdrawal(body: dict, user: dict, db: AsyncConnection):
    status = str(body.get("status", "")).upper()
    if not body.get("withdrawalId") or status not in {
        "APPROVED",
        "COMPLETED",
        "REJECTED",
        "FAILED",
        "CANCELLED",
    }:
        raise HTTPException(400, "withdrawalId and approval/rejection status are required")
    table, doctor = (tables["Withdrawal"], tables["Doctor"])
    row = (
        (await db.execute(select(table).where(table.c.id == body["withdrawalId"]).with_for_update()))
        .mappings()
        .first()
    )
    if not row:
        raise HTTPException(404, "Withdrawal not found")
    if row["status"] not in {"PENDING", "PROCESSING"}:
        raise HTTPException(409, "Cannot change status of already finalized withdrawal")
    approved = status in {"APPROVED", "COMPLETED"}
    values = dict(status="COMPLETED" if approved else "FAILED", processedAt=utcnow(), updatedAt=utcnow())
    if not approved:
        values["failureReason"] = str(body.get("failureReason") or "Rejected by administrator")[:1000]
    updated = (
        (
            await db.execute(
                update(table)
                .where(table.c.id == row["id"], table.c.status.in_(["PENDING", "PROCESSING"]))
                .values(**values)
                .returning(table)
            )
        )
        .mappings()
        .first()
    )
    if not updated:
        raise HTTPException(409, "Withdrawal was already finalized")
    if not approved:
        await db.execute(
            update(doctor)
            .where(doctor.c.id == row["doctorId"])
            .values(balance=doctor.c.balance + row["amount"], updatedAt=utcnow())
        )
    await record_audit_event(
        db,
        user["id"],
        f"{('Approved' if approved else 'Rejected')} Withdrawal {row['id']}",
        {"amount": row["amount"], "doctorId": row["doctorId"]},
    )
    return {"success": True, "withdrawal": dict(updated)}
