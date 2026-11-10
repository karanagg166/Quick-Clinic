"""Account profile, public response mapping and shared location persistence."""

from fastapi import HTTPException
from sqlalchemy import insert, select, update
from sqlalchemy.ext.asyncio import AsyncConnection
from app.core.security import ensure_owner
from app.infrastructure.database import tables, utcnow
from app.infrastructure.audit import record_audit_event
from .avatars import sanitize_avatar_url


async def get_account(db: AsyncConnection, user_id: str):
    users = tables["User"]
    row = (await db.execute(select(users).where(users.c.id == user_id))).mappings().first()
    if not row:
        raise HTTPException(404, "User not found")
    return dict(row)


async def get_profile(user_id: str, user: dict, db: AsyncConnection):
    ensure_owner(user, user_id)
    return await get_user_details(db, await get_account(db, user_id))


async def update_profile(user_id: str, body: dict, user: dict, db: AsyncConnection):
    ensure_owner(user, user_id)
    await get_account(db, user_id)
    values = {key: body[key] for key in ("name", "phoneNo", "address", "gender") if key in body}
    if any((not isinstance(value, str) or not value.strip() for value in values.values())):
        raise HTTPException(400, "Profile fields must be non-empty strings")
    if "gender" in values and values["gender"] not in {"MALE", "FEMALE", "BINARY"}:
        raise HTTPException(400, "Invalid gender")
    if "age" in body:
        try:
            values["age"] = int(body["age"])
        except (ValueError, TypeError) as exc:
            raise HTTPException(400, "Invalid age") from exc
        if not 0 <= values["age"] <= 150:
            raise HTTPException(400, "Invalid age")
    if "pinCode" in body:
        values["pinCode"] = await ensure_location(
            db, body["pinCode"], body.get("city", ""), body.get("state", "")
        )
    await db.execute(
        update(tables["User"]).where(tables["User"].c.id == user_id).values(**values, updatedAt=utcnow())
    )
    await record_audit_event(db, user["id"], "Updated Profile", {"updatedFields": list(values)})
    return await get_user_details(db, await get_account(db, user_id))


async def get_user_details(db: AsyncConnection, user: dict):
    result = {
        key: user.get(key)
        for key in (
            "id",
            "email",
            "name",
            "phoneNo",
            "age",
            "gender",
            "role",
            "address",
            "pinCode",
            "emailVerified",
        )
    }
    location = tables["Location"]
    loc = (await db.execute(select(location).where(location.c.pincode == user["pinCode"]))).mappings().first()
    result.update(city=loc["city"] if loc else "", state=loc["state"] if loc else "")
    for model, key in (("Doctor", "doctorId"), ("Patient", "patientId")):
        table = tables[model]
        result[key] = (
            await db.execute(select(table.c.id).where(table.c.userId == user["id"]))
        ).scalar_one_or_none()
    result["profileImageUrl"] = sanitize_avatar_url(user.get("profileImageUrl"))
    return result


async def ensure_location(db: AsyncConnection, pincode, city="", state=""):
    try:
        pincode = int(pincode)
    except (ValueError, TypeError) as exc:
        raise HTTPException(400, "Invalid pinCode") from exc
    if not 100000 <= pincode <= 999999:
        raise HTTPException(400, "Invalid pinCode")
    table = tables["Location"]
    if not (await db.execute(select(table.c.pincode).where(table.c.pincode == pincode))).first():
        from sqlalchemy.exc import IntegrityError

        try:
            async with db.begin_nested():
                await db.execute(insert(table).values(pincode=pincode, city=str(city), state=str(state)))
        except IntegrityError:
            pass
    return pincode
