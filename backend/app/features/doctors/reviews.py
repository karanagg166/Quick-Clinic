"""Verified completed-appointment reviews and public rating summaries."""

from fastapi import HTTPException
from sqlalchemy import func, insert, select, update
from sqlalchemy.ext.asyncio import AsyncConnection
from app.infrastructure.database import new_id, utcnow
from .repository import appointments_table, patients_table, ratings_table, comments_table, users_table


async def rating_summary(doctor_id: str, db: AsyncConnection):
    row = (
        await db.execute(
            select(func.avg(ratings_table.c.rating), func.count()).where(
                ratings_table.c.doctorId == doctor_id
            )
        )
    ).one()
    return {"average": round(float(row[0] or 0), 1), "count": row[1]}


async def review_patient(db, doctor_id, user):
    if user["role"] != "PATIENT":
        raise HTTPException(403, "Forbidden")
    patient_id = (
        await db.execute(select(patients_table.c.id).where(patients_table.c.userId == user["id"]))
    ).scalar()
    completed = (
        await db.execute(
            select(appointments_table.c.id)
            .where(
                appointments_table.c.doctorId == doctor_id,
                appointments_table.c.patientId == patient_id,
                appointments_table.c.status == "COMPLETED",
            )
            .limit(1)
        )
    ).scalar()
    if not completed:
        raise HTTPException(403, "You can review only after a completed appointment")
    return patient_id


async def submit_rating(doctor_id: str, body, user, db: AsyncConnection):
    patient = await review_patient(db, doctor_id, user)
    if body.get("patientId") and body["patientId"] != patient:
        raise HTTPException(403, "Forbidden")
    rating = body.get("rating")
    if isinstance(rating, bool) or not isinstance(rating, int) or (not 1 <= rating <= 5):
        raise HTTPException(400, "Rating must be between 1 and 5")
    existing = (
        await db.execute(
            select(ratings_table.c.id).where(
                ratings_table.c.doctorId == doctor_id, ratings_table.c.patientId == patient
            )
        )
    ).scalar()
    if existing:
        await db.execute(
            update(ratings_table)
            .where(ratings_table.c.id == existing)
            .values(rating=rating, updatedAt=utcnow())
        )
    else:
        await db.execute(
            insert(ratings_table).values(id=new_id(), doctorId=doctor_id, patientId=patient, rating=rating)
        )
    return {"message": "Rating submitted", "rating": await rating_summary(doctor_id, db)}


async def list_comments(doctor_id: str, db: AsyncConnection):
    rows = (
        (
            await db.execute(
                select(
                    comments_table,
                    users_table.c.name,
                    users_table.c.profileImageUrl,
                    users_table.c.id.label("reviewerId"),
                )
                .join(patients_table, comments_table.c.patientId == patients_table.c.id)
                .join(users_table, patients_table.c.userId == users_table.c.id)
                .where(comments_table.c.doctorId == doctor_id)
                .order_by(comments_table.c.createdAt.desc())
            )
        )
        .mappings()
        .all()
    )
    return {
        "comments": [
            {
                **{k: row[k] for k in comments_table.c.keys()},
                "user": {
                    "id": row["reviewerId"],
                    "name": row["name"],
                    "profileImageUrl": row["profileImageUrl"],
                },
            }
            for row in rows
        ]
    }


async def create_comment(doctor_id: str, body, user, db: AsyncConnection):
    patient = await review_patient(db, doctor_id, user)
    if body.get("patientId") and body["patientId"] != patient:
        raise HTTPException(403, "Forbidden")
    text = body.get("text")
    if not isinstance(text, str) or not text.strip() or len(text) > 10000:
        raise HTTPException(400, "Comment text is required (maximum 10000 characters)")
    comment_id = new_id()
    await db.execute(
        insert(comments_table).values(id=comment_id, doctorId=doctor_id, patientId=patient, text=text.strip())
    )
    return {
        "comment": dict(
            (await db.execute(select(comments_table).where(comments_table.c.id == comment_id)))
            .mappings()
            .one()
        )
    }
