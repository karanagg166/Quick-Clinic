"""Bank account validation, persistence and doctor ownership rules."""

import re
from fastapi import HTTPException
from sqlalchemy import insert, select, update
from sqlalchemy.ext.asyncio import AsyncConnection
from app.core.security import ensure_owner
from app.infrastructure.database import new_id, tables
from .service import get_account

BANK_FIELDS = ("bankAccountNumber", "bankIFSC", "bankAccountHolderName", "bankName")


async def get_bank_details(user_id: str, user: dict, db: AsyncConnection):
    ensure_owner(user, user_id)
    bank = tables["BankAccount"]
    row = (await db.execute(select(bank).where(bank.c.userId == user_id))).mappings().first()
    return {key: row[key] if row else None for key in BANK_FIELDS}


async def save_bank_details(user_id: str, body: dict, user: dict, db: AsyncConnection):
    ensure_owner(user, user_id)
    await get_account(db, user_id)
    if any((not isinstance(body.get(key), str) or not body[key].strip() for key in BANK_FIELDS)):
        raise HTTPException(400, "All bank details are required")
    values = {key: body[key].strip() for key in BANK_FIELDS}
    values["bankIFSC"] = values["bankIFSC"].upper()
    if not re.fullmatch("[A-Z]{4}0[A-Z0-9]{6}", values["bankIFSC"]):
        raise HTTPException(400, "Invalid IFSC code format")
    if not re.fullmatch("\\d{9,18}", values["bankAccountNumber"]):
        raise HTTPException(400, "Invalid account number")
    bank = tables["BankAccount"]
    existing = (await db.execute(select(bank.c.id).where(bank.c.userId == user_id))).scalar_one_or_none()
    if existing:
        await db.execute(update(bank).where(bank.c.id == existing).values(**values))
    else:
        await db.execute(insert(bank).values(id=new_id(), userId=user_id, **values))
    return {"message": "Bank details saved successfully", "bankDetails": values}


async def get_doctor_bank_owner(db: AsyncConnection, doctor_id: str, user: dict):
    doctor = tables["Doctor"]
    owner = (await db.execute(select(doctor.c.userId).where(doctor.c.id == doctor_id))).scalar_one_or_none()
    if not owner:
        raise HTTPException(404, "Doctor not found")
    if user["role"] != "ADMIN" and (user["role"] != "DOCTOR" or user["id"] != owner):
        raise HTTPException(403, "Forbidden")
    return owner


async def get_doctor_bank_details(doctor_id: str, user: dict, db: AsyncConnection):
    return await get_bank_details(await get_doctor_bank_owner(db, doctor_id, user), user, db)


async def save_doctor_bank_details(doctor_id: str, body: dict, user: dict, db: AsyncConnection):
    result = await save_bank_details(await get_doctor_bank_owner(db, doctor_id, user), body, user, db)
    result["message"] = "Bank details updated successfully"
    return result
