"""Database races use independent PostgreSQL connections and actual row locks."""

import asyncio
from datetime import timedelta

import pytest
from sqlalchemy import insert, select, func

from app.features.booking.service import acquire_hold
from app.features.payments.refunds import enqueue_refund
from app.features.messaging.service import persist_message
from app.infrastructure.database import tables, utcnow

pytestmark = pytest.mark.postgres


async def prepare(engine):
    async with engine.begin() as db:
        await db.execute(insert(tables["Location"]).values(pincode=110001, city="Test", state="Test"))
        for role, identifier in [("DOCTOR", "d"), ("PATIENT", "p")]:
            await db.execute(
                insert(tables["User"]).values(
                    id=identifier,
                    email=f"{identifier}@example.test",
                    name="Synthetic",
                    password="unused",
                    role=role,
                    phoneNo="9999999999",
                    age=30,
                    gender="MALE",
                    address="Test",
                    pinCode=110001,
                )
            )
            await db.execute(
                insert(tables[role.title()]).values(
                    id=identifier,
                    userId=identifier,
                    **({"specialty": "GENERAL_PHYSICIAN", "fees": 500} if role == "DOCTOR" else {}),
                )
            )
        start = utcnow() + timedelta(days=1)
        await db.execute(
            insert(tables["Slot"]).values(
                id="s",
                doctorId="d",
                date=start.date(),
                startTime=start,
                endTime=start + timedelta(minutes=30),
            )
        )


async def test_postgres_refund_enqueuing_is_singleton_under_concurrent_cancellation(pg_engine):
    await prepare(pg_engine)
    async with pg_engine.begin() as db:
        await db.execute(
            insert(tables["Payment"]).values(
                id="payment",
                userId="p",
                doctorId="d",
                slotId="s",
                amount=50000,
                status="CAPTURED",
                razorpayOrderId="synthetic-order",
                razorpayPaymentId="synthetic-payment",
            )
        )
        payment = dict((await db.execute(select(tables["Payment"]))).mappings().one())

    async def request_refund():
        async with pg_engine.begin() as db:
            return await enqueue_refund(db, payment, "CANCELLATION")

    outcomes = await asyncio.gather(*(request_refund() for _ in range(10)))
    assert len({row["id"] for row in outcomes}) == 1
    async with pg_engine.connect() as db:
        assert (await db.execute(select(func.count()).select_from(tables["Refund"]))).scalar_one() == 1
        assert (await db.execute(select(tables["Payment"].c.status))).scalar_one() == "REFUND_PENDING"


async def test_postgres_duplicate_message_race_persists_and_returns_one_message(pg_engine):
    await prepare(pg_engine)
    async with pg_engine.begin() as db:
        await db.execute(
            insert(tables["DoctorPatientRelation"]).values(
                id="relation", doctorsUserId="d", patientsUserId="p"
            )
        )

    async def send():
        async with pg_engine.begin() as db:
            return await persist_message(
                db,
                "relation",
                {"id": "p", "role": "PATIENT"},
                {"text": "Synthetic", "clientMessageId": "retry-key"},
            )

    outcomes = await asyncio.gather(*(send() for _ in range(8)))
    assert sum(not duplicate for _, duplicate in outcomes) == 1
    assert len({row["id"] for row, _ in outcomes}) == 1
    async with pg_engine.connect() as db:
        assert (await db.execute(select(func.count()).select_from(tables["ChatMessages"]))).scalar_one() == 1


async def test_postgres_rollback_releases_hold_and_does_not_leave_partial_reservation(pg_engine):
    await prepare(pg_engine)
    async with pg_engine.connect() as db:
        await acquire_hold(db, "s", "d", "p")
        await db.rollback()
    async with pg_engine.begin() as db:
        row = (await db.execute(select(tables["Slot"]))).mappings().one()
        assert row["status"] == "AVAILABLE"
        assert row["holdToken"] is None
        assert (await acquire_hold(db, "s", "d", "p"))["holdToken"]
