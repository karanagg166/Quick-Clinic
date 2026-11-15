"""PostgreSQL locks and uniqueness must be tested on PostgreSQL, not SQLite."""

import asyncio
from datetime import timedelta
from fastapi import HTTPException
from sqlalchemy import insert, select, func
from app.infrastructure.database import tables, utcnow
from app.features.booking.service import acquire_hold, confirm_hold
from app.features.documents.ingestion_jobs import claim_next_ingestion_job, enqueue_ingestion_job


async def seed(engine):
    start = utcnow() + timedelta(days=1)
    async with engine.begin() as db:
        await db.execute(insert(tables["Location"]).values(pincode=110001, city="Test", state="Test"))
        for n in range(13):
            await db.execute(
                insert(tables["User"]).values(
                    id=f"u{n}",
                    email=f"u{n}@example.test",
                    phoneNo="9999999999",
                    name="Test",
                    password="unused",
                    age=30,
                    gender="MALE",
                    role="DOCTOR" if n == 0 else "PATIENT",
                    address="Test",
                    pinCode=110001,
                )
            )
            if n == 0:
                await db.execute(
                    insert(tables["Doctor"]).values(
                        id="doctor", userId="u0", specialty="GENERAL_PHYSICIAN", fees=500
                    )
                )
            else:
                await db.execute(insert(tables["Patient"]).values(id=f"p{n}", userId=f"u{n}"))
        await db.execute(
            insert(tables["Slot"]).values(
                id="slot",
                doctorId="doctor",
                date=start.date(),
                startTime=start,
                endTime=start + timedelta(minutes=30),
            )
        )


async def test_postgres_concurrent_holds_have_exactly_one_winner(pg_engine):
    await seed(pg_engine)

    async def reserve(n):
        async with pg_engine.connect() as db:
            try:
                hold = await acquire_hold(db, "slot", "doctor", f"p{n}")
                await db.commit()
                return hold
            except HTTPException as exc:
                await db.rollback()
                assert exc.status_code == 409
                return None

    results = await asyncio.gather(*(reserve(n) for n in range(1, 13)))
    assert sum(value is not None for value in results) == 1


async def test_postgres_same_hold_confirmation_is_idempotent(pg_engine):
    await seed(pg_engine)
    async with pg_engine.begin() as db:
        hold = await acquire_hold(db, "slot", "doctor", "p1")

    async def confirm():
        async with pg_engine.connect() as db:
            try:
                result = await confirm_hold(
                    db,
                    slot_id="slot",
                    doctor_id="doctor",
                    patient_id="p1",
                    token=hold["holdToken"],
                    payment_method="OFFLINE",
                )
                await db.commit()
                return result
            except HTTPException as exc:
                await db.rollback()
                assert exc.status_code == 409
                return None

    results = await asyncio.gather(*(confirm() for _ in range(6)))
    successes = [result for result in results if result]
    assert successes
    assert len({result["id"] for result in successes}) == 1
    async with pg_engine.connect() as db:
        assert (await db.execute(select(func.count()).select_from(tables["Appointment"]))).scalar_one() == 1


async def test_postgres_concurrent_ingestion_job_claims_have_single_winner(pg_engine):
    await seed(pg_engine)
    now = utcnow()
    async with pg_engine.begin() as db:
        await db.execute(
            insert(tables["MedicalDocument"]).values(
                id="doc_pg_claim",
                patientId="p1",
                title="PG Concurrency Lab",
                type="LAB_REPORT",
                fileName="pg_lab.pdf",
                mimeType="application/pdf",
                fileSize=128,
                storagePath="patients/p1/pg_lab.pdf",
                reportDate=now,
                processingStatus="PENDING",
                createdAt=now,
                updatedAt=now,
            )
        )
        j1 = await enqueue_ingestion_job(db, document_id="doc_pg_claim")
        j2 = await enqueue_ingestion_job(db, document_id="doc_pg_claim")
        assert j1["id"] == j2["id"]

    async def claim():
        async with pg_engine.connect() as db:
            job = await claim_next_ingestion_job(db, document_id="doc_pg_claim")
            await db.commit()
            return job

    claims = await asyncio.gather(*(claim() for _ in range(8)))
    winners = [job for job in claims if job is not None]
    assert len(winners) == 1
    assert winners[0]["id"] == j1["id"]
    assert winners[0]["status"] == "RUNNING"
    assert winners[0]["leaseToken"]
    async with pg_engine.connect() as db:
        total_jobs = (
            await db.execute(
                select(func.count())
                .select_from(tables["MedicalIngestionJob"])
                .where(tables["MedicalIngestionJob"].c.documentId == "doc_pg_claim")
            )
        ).scalar_one()
        assert total_jobs == 1
