"""Durable notification delivery and scheduled appointment expiry invariants."""

from datetime import timedelta

import pytest
from sqlalchemy import insert, select, update

from app.features.booking.service import expire_holds
from app.features.operations.outbox import dispatch_outbox
from app.features.operations import service as operations
from app.infrastructure.database import tables, utcnow


async def add_outbox(db, ident="outbox-test", **overrides):
    values = dict(
        id=ident,
        eventId=ident,
        channel="SOCKET_NOTIFICATION",
        targetUserId="patient",
        payload={"message": ident},
        status="PENDING",
    )
    values.update(overrides)
    await db.execute(insert(tables["NotificationOutbox"]).values(**values))


async def test_delivery_failure_persists_backoff_then_recovers_without_losing_event(db, monkeypatch):
    import app.infrastructure.realtime as realtime

    await add_outbox(db)
    calls = []

    async def fail(channel, target, payload):
        calls.append(payload)
        raise RuntimeError("private transport failure")

    monkeypatch.setattr(realtime, "publish_outbox", fail)
    assert await dispatch_outbox(db) == {"delivered": 0, "failed": 1}
    failed = (await db.execute(select(tables["NotificationOutbox"]))).mappings().one()
    assert failed["status"] == "FAILED" and failed["attempts"] == 1
    assert failed["lastError"] == "Realtime delivery failed"
    assert failed["leaseOwner"] is failed["leaseExpiresAt"] is None
    assert await dispatch_outbox(db) == {"delivered": 0, "failed": 0}

    async def succeed(channel, target, payload):
        calls.append(payload)

    monkeypatch.setattr(realtime, "publish_outbox", succeed)
    await db.execute(
        update(tables["NotificationOutbox"]).values(nextAttemptAt=utcnow() - timedelta(seconds=1))
    )
    assert await dispatch_outbox(db) == {"delivered": 1, "failed": 0}
    delivered = (await db.execute(select(tables["NotificationOutbox"]))).mappings().one()
    assert delivered["status"] == "DELIVERED" and delivered["attempts"] == 2
    assert delivered["deliveredAt"] is not None and len(calls) == 2
    assert await dispatch_outbox(db) == {"delivered": 0, "failed": 0}


@pytest.mark.parametrize("field", ["leaseExpiresAt", "nextAttemptAt"])
async def test_outbox_respects_active_lease_and_retry_schedule(db, monkeypatch, field):
    import app.infrastructure.realtime as realtime

    await add_outbox(db, **{field: utcnow() + timedelta(minutes=1)})

    async def forbidden(*args, **kwargs):
        raise AssertionError("An ineligible event must not be delivered")

    monkeypatch.setattr(realtime, "publish_outbox", forbidden)
    assert await dispatch_outbox(db) == {"delivered": 0, "failed": 0}
    assert (await db.execute(select(tables["NotificationOutbox"].c.attempts))).scalar_one() == 0


async def test_expired_outbox_lease_is_reclaimed_and_delivery_batch_is_bounded(db, monkeypatch):
    import app.infrastructure.realtime as realtime

    for n in range(4):
        await add_outbox(
            db,
            f"batch-{n}",
            targetUserId=f"patient-{n}",
            status="PROCESSING",
            leaseExpiresAt=utcnow() - timedelta(seconds=1),
            leaseOwner="dead-worker",
        )
    delivered = []

    async def publish(channel, target, payload):
        delivered.append(target)

    monkeypatch.setattr(realtime, "publish_outbox", publish)
    assert await dispatch_outbox(db, limit=2) == {"delivered": 2, "failed": 0}
    assert len(set(delivered)) == 2
    assert await dispatch_outbox(db, limit=2) == {"delivered": 2, "failed": 0}
    assert len(set(delivered)) == 4


async def test_blocked_recipient_does_not_block_delivery_to_other_recipients(db, monkeypatch):
    import app.infrastructure.realtime as realtime

    now = utcnow()
    await add_outbox(db, "old-blocked", createdAt=now, nextAttemptAt=now + timedelta(minutes=1))
    await add_outbox(db, "newer", createdAt=now + timedelta(seconds=1))
    await add_outbox(db, "other", targetUserId="other-patient", createdAt=now)
    delivered = []

    async def publish(channel, target, payload):
        delivered.append(payload["message"])

    monkeypatch.setattr(realtime, "publish_outbox", publish)
    assert await dispatch_outbox(db) == {"delivered": 1, "failed": 0}
    assert delivered == ["other"]


@pytest.fixture
async def visit(db, seed_user):
    doctor, patient = await seed_user("DOCTOR"), await seed_user()
    now = utcnow()
    slot = dict(
        id="expiry-slot",
        doctorId=doctor["doctorId"],
        date=(now - timedelta(days=1)).date(),
        startTime=now - timedelta(days=1),
        endTime=now - timedelta(days=1) + timedelta(minutes=30),
        status="BOOKED",
    )
    await db.execute(insert(tables["Slot"]).values(**slot))
    values = dict(
        id="expiry-appointment",
        doctorId=doctor["doctorId"],
        patientId=patient["patientId"],
        slotId=slot["id"],
        status="CONFIRMED",
        paymentMethod="OFFLINE",
        notes="original note",
    )
    await db.execute(insert(tables["Appointment"]).values(**values))
    return doctor, patient, values


@pytest.mark.parametrize("status", ["PENDING", "CONFIRMED"])
async def test_past_unfinished_visits_expire_with_notification_and_history_retained(db, visit, status):
    await db.execute(update(tables["Appointment"]).values(status=status))
    result = await operations.expire_appointments(db)
    assert result == {"expired": 1, "refunded": 0, "refundFailed": 0}
    row = (await db.execute(select(tables["Appointment"]))).mappings().one()
    assert row["id"] == "expiry-appointment" and row["status"] == "EXPIRED"
    assert row["notes"].startswith("original note") and "Auto-expired" in row["notes"]
    assert (await db.execute(select(tables["Slot"].c.status))).scalar_one() == "AVAILABLE"
    assert len((await db.execute(select(tables["Notification"]))).all()) == 2
    assert len((await db.execute(select(tables["NotificationOutbox"]))).all()) == 2
    assert (await operations.expire_appointments(db))["expired"] == 0


@pytest.mark.parametrize("status", ["COMPLETED", "NO_SHOW", "CANCELLED", "EXPIRED", "RESCHEDULED"])
async def test_automatic_expiry_preserves_terminal_and_rescheduled_history(db, visit, status):
    await db.execute(update(tables["Appointment"]).values(status=status))
    assert (await operations.expire_appointments(db))["expired"] == 0
    assert (await db.execute(select(tables["Appointment"].c.status))).scalar_one() == status
    assert not (await db.execute(select(tables["Notification"]))).all()


async def test_todays_visits_are_not_expired_based_only_on_elapsed_start_time(db, visit):
    await db.execute(update(tables["Slot"]).values(date=utcnow().date()))
    assert (await operations.expire_appointments(db))["expired"] == 0


@pytest.mark.parametrize("refund_result,refunded,failed", [("REFUNDED", 1, 0), ("REFUND_PENDING", 0, 1)])
async def test_expired_pending_paid_visit_enqueues_refund_then_executes_after_commit(
    db, visit, monkeypatch, refund_result, refunded, failed
):
    doctor, patient, appointment = visit
    await db.execute(
        insert(tables["Payment"]).values(
            id="expiry-payment",
            userId=patient["id"],
            amount=50000,
            currency="INR",
            status="SUCCESS",
            razorpayOrderId="order_expiry",
            razorpayPaymentId="pay_expiry",
        )
    )
    await db.execute(
        update(tables["Appointment"]).values(
            status="PENDING", paymentMethod="ONLINE", paymentId="expiry-payment"
        )
    )
    calls = []

    async def execute(connection, refund_id):
        assert not connection.in_transaction(), "Refund intent must commit before provider I/O"
        calls.append(refund_id)
        return refund_result

    monkeypatch.setattr(operations, "execute_refund", execute)
    result = await operations.expire_appointments(db)
    assert result == {"expired": 1, "refunded": refunded, "refundFailed": failed}
    assert len(calls) == 1
    refund = (await db.execute(select(tables["Refund"]))).mappings().one()
    assert refund["paymentId"] == "expiry-payment" and refund["amount"] == 50000


@pytest.mark.parametrize("legacy", [False, True])
async def test_hold_expiry_supports_explicit_deadline_and_pre_migration_held_at(db, visit, legacy):
    await db.execute(
        update(tables["Slot"]).values(
            status="HELD",
            heldByPatientId=visit[1]["patientId"],
            holdToken="stale-token",
            heldAt=utcnow() - timedelta(minutes=11),
            holdExpiresAt=None if legacy else utcnow() - timedelta(seconds=1),
        )
    )
    assert await expire_holds(db, "expiry-slot") == 1
    row = (await db.execute(select(tables["Slot"]))).mappings().one()
    assert row["status"] == "AVAILABLE"
    assert all(row[key] is None for key in ("heldByPatientId", "holdToken", "heldAt", "holdExpiresAt"))


async def test_hold_cleanup_does_not_release_an_unexpired_hold(db, visit):
    await db.execute(
        update(tables["Slot"]).values(
            status="HELD",
            heldByPatientId=visit[1]["patientId"],
            holdToken="live-token",
            heldAt=utcnow(),
            holdExpiresAt=utcnow() + timedelta(minutes=10),
        )
    )
    assert await expire_holds(db) == 0
    assert (await db.execute(select(tables["Slot"].c.holdToken))).scalar_one() == "live-token"
