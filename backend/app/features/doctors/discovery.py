"""Public doctor search and approximate/provided travel metrics."""

import math
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncConnection
from .repository import doctors_table, users_table, locations_table, doctor_view
from .schemas import SPECIALTIES
from .routing import route_metrics


async def search_doctors(filters, db: AsyncConnection):
    q = filters
    stmt = (
        select(doctors_table)
        .join(users_table, doctors_table.c.userId == users_table.c.id)
        .join(locations_table, users_table.c.pinCode == locations_table.c.pincode)
        .where(doctors_table.c.isReleaseFixture.is_(False), users_table.c.isActive.is_(True))
    )
    for key, column in (
        ("name", users_table.c.name),
        ("city", locations_table.c.city),
        ("state", locations_table.c.state),
    ):
        if q.get(key, "").strip():
            stmt = stmt.where(
                column.ilike("%" + q[key].strip().replace("%", "\\%").replace("_", "\\_") + "%", escape="\\")
            )
    if q.get("gender", "").upper() in ("MALE", "FEMALE", "BINARY"):
        stmt = stmt.where(users_table.c.gender == q["gender"].upper())
    specialty = (q.get("specialty") or q.get("specialization") or "").upper()
    if specialty in SPECIALTIES:
        stmt = stmt.where(doctors_table.c.specialty == specialty)
    for key, column, bound in (
        ("age", users_table.c.age, "eq"),
        ("maxFees", doctors_table.c.fees, "le"),
        ("minFees", doctors_table.c.fees, "ge"),
        ("minExperience", doctors_table.c.experience, "ge"),
        ("maxExperience", doctors_table.c.experience, "le"),
    ):
        raw = q.get(key) or (
            q.get("fees") if key == "maxFees" else q.get("experience") if key == "minExperience" else None
        )
        if raw:
            try:
                value = int(raw)
            except ValueError:
                raise HTTPException(400, f"Invalid {key}")
            stmt = stmt.where(
                column == value if bound == "eq" else column <= value if bound == "le" else column >= value
            )
    rows = (await db.execute(stmt.order_by(doctors_table.c.id))).mappings().all()
    result = [await doctor_view(db, row) for row in rows]
    if "lat" not in q and "lng" not in q:
        for item in result:
            for key in ("email", "userId", "latitude", "longitude"):
                item.pop(key, None)
        return result
    try:
        (lat, lng) = (float(q["lat"]), float(q["lng"]))
        if (
            not math.isfinite(lat)
            or not math.isfinite(lng)
            or (not -90 <= lat <= 90)
            or (not -180 <= lng <= 180)
        ):
            raise ValueError()
    except (KeyError, ValueError):
        raise HTTPException(400, "lat must be between -90 and 90 and lng must be between -180 and 180")
    metrics = await route_metrics(lat, lng, result)
    for item in result:
        item.pop("email", None)
        item.pop("userId", None)
        if item["latitude"] is not None and item["longitude"] is not None:
            a = (
                math.sin(math.radians(item["latitude"] - lat) / 2) ** 2
                + math.cos(math.radians(lat))
                * math.cos(math.radians(item["latitude"]))
                * math.sin(math.radians(item["longitude"] - lng) / 2) ** 2
            )
            item["distanceKm"] = round(6371 * 2 * math.atan2(math.sqrt(a), math.sqrt(max(0, 1 - a))), 1)
            item["durationMinutes"] = max(1, round(item["distanceKm"] / 35 * 60))
            if item["id"] in metrics:
                item.update(metrics[item["id"]])
    result.sort(key=lambda item: item.get("distanceKm", float("inf")))
    return {"doctors": result, "distanceUnavailable": not any(("distanceKm" in item for item in result))}
