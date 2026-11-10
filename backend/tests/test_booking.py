"""Booking invariants run against a disposable SQLite database, never live data."""

import hashlib
import hmac
from datetime import timedelta

import pytest
from fastapi import HTTPException
from sqlalchemy import insert, select, update
from sqlalchemy.ext.asyncio import create_async_engine

from app.infrastructure.database import metadata, tables, utcnow
from app.features.booking.appointments import change_status
from app.features.booking.service import acquire_hold, confirm_hold, release_hold
from app.features.payments.service import initiate_checkout, verify_payment
from app.features.payments.refunds import enqueue_refund
from app.features.payments.gateway import verify_signature


@pytest.fixture
async def booking_db():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as db:
        await db.run_sync(metadata.create_all)
    async with engine.connect() as db:
        now = utcnow()
        await db.execute(insert(tables["Location"]).values(pincode=123456, city="Test", state="Test"))
        for uid, role in (("du", "DOCTOR"), ("pu", "PATIENT"), ("other", "PATIENT")):
            await db.execute(
                insert(tables["User"]).values(
                    id=uid,
                    email=f"{uid}@example.test",
                    phoneNo="1234567890",
                    name=uid,
                    password="not-used",
                    age=25,
                    gender="MALE",
                    role=role,
                    address="Test",
                    pinCode=123456,
                    createdAt=now,
                    updatedAt=now,
                )
            )
        await db.execute(
            insert(tables["Doctor"]).values(id="doc", userId="du", specialty="GENERAL_PHYSICIAN", fees=500)
        )
        await db.execute(insert(tables["Patient"]).values(id="pat", userId="pu"))
        await db.execute(insert(tables["Patient"]).values(id="otherpat", userId="other"))
        await db.execute(
            insert(tables["Slot"]).values(
                id="slot",
                doctorId="doc",
                date=(now + timedelta(days=1)).date(),
                startTime=now + timedelta(days=1),
                endTime=now + timedelta(days=1, minutes=30),
                status="AVAILABLE",
            )
        )
        await db.commit()
        yield db
    await engine.dispose()


def test_payment_signature_fails_closed():
    message, secret = b"order_123|pay_123", "test-signing-key"
    signature = hmac.new(secret.encode(), message, hashlib.sha256).hexdigest()
    assert verify_signature(message, signature, secret)
    assert not verify_signature(b"order_other|pay_123", signature, secret)
    assert not verify_signature(message, signature, "")
    assert not verify_signature(message, "a" * 63, secret)


async def test_slot_hold_is_exclusive_and_owner_bound(booking_db):
    hold = await acquire_hold(booking_db, "slot", "doc", "pat")
    with pytest.raises(HTTPException) as conflict:
        await acquire_hold(booking_db, "slot", "doc", "otherpat")
    assert conflict.value.status_code == 409
    assert not await release_hold(booking_db, "slot", "otherpat", hold["holdToken"])
    assert not await release_hold(booking_db, "slot", "pat", "wrong-token")
    assert await release_hold(booking_db, "slot", "pat", hold["holdToken"])


async def test_expired_owner_cannot_release_new_hold(booking_db):
    old = await acquire_hold(booking_db, "slot", "doc", "pat")
    slot = tables["Slot"]
    await booking_db.execute(
        update(slot).where(slot.c.id == "slot").values(holdExpiresAt=utcnow() - timedelta(seconds=1))
    )
    newer = await acquire_hold(booking_db, "slot", "doc", "otherpat")
    assert not await release_hold(booking_db, "slot", "pat", old["holdToken"])
    assert await release_hold(booking_db, "slot", "otherpat", newer["holdToken"])


async def test_client_transaction_id_cannot_authorize_paid_booking(booking_db):
    hold = await acquire_hold(booking_db, "slot", "doc", "pat")
    result = await confirm_hold(
        booking_db,
        slot_id="slot",
        doctor_id="doc",
        patient_id="pat",
        token=hold["holdToken"],
        payment_method="ONLINE",
    )
    assert result is None


async def test_offline_checkout_is_idempotent_and_cannot_change_details(booking_db):
    user, patient = {"id": "pu", "role": "PATIENT"}, {"id": "pat"}
    payload = dict(idempotencyKey="checkout-key-123", doctorId="doc", slotId="slot", paymentMethod="OFFLINE")
    first = await initiate_checkout(booking_db, user, patient, payload)
    second = await initiate_checkout(booking_db, user, patient, payload)
    assert first["appointment"]["id"] == second["appointment"]["id"]
    assert second["reused"]
    with pytest.raises(HTTPException) as conflict:
        await initiate_checkout(booking_db, user, patient, dict(payload, slotId="different"))
    assert conflict.value.status_code == 409
    outbox = tables["NotificationOutbox"]
    assert len((await booking_db.execute(select(outbox))).all()) == 2


async def test_cancelled_history_is_preserved_when_slot_is_rebooked(booking_db):
    hold = await acquire_hold(booking_db, "slot", "doc", "pat")
    first = await confirm_hold(
        booking_db,
        slot_id="slot",
        doctor_id="doc",
        patient_id="pat",
        token=hold["holdToken"],
        payment_method="OFFLINE",
    )
    await change_status(booking_db, first, "CANCELLED")
    hold2 = await acquire_hold(booking_db, "slot", "doc", "otherpat")
    second = await confirm_hold(
        booking_db,
        slot_id="slot",
        doctor_id="doc",
        patient_id="otherpat",
        token=hold2["holdToken"],
        payment_method="OFFLINE",
    )
    assert first["id"] != second["id"]
    a = tables["Appointment"]
    rows = (await booking_db.execute(select(a))).mappings().all()
    assert {row["status"] for row in rows} == {"CANCELLED", "CONFIRMED"}


async def test_captured_payment_is_checked_and_doctor_credited_once(booking_db, monkeypatch):
    import app.features.payments.service as payments

    monkeypatch.setattr(payments.get_settings(), "razorpay_key_secret", "secret")
    monkeypatch.setattr(payments.get_settings(), "razorpay_key_id", "key")

    async def fake_provider(method, path, **kwargs):
        if path == "orders":
            return {"id": "order_1", "amount": 50000, "currency": "INR"}
        return {
            "id": "pay_1",
            "order_id": "order_1",
            "amount": 50000,
            "currency": "INR",
            "status": "captured",
            "captured": True,
        }

    monkeypatch.setattr(payments, "provider", fake_provider)
    import app.features.payments.refunds as refunds

    monkeypatch.setattr(refunds, "provider", fake_provider)
    co = await initiate_checkout(
        booking_db,
        {"id": "pu"},
        {"id": "pat"},
        dict(idempotencyKey="online-checkout-123", doctorId="doc", slotId="slot", paymentMethod="ONLINE"),
    )
    signature = hmac.new(b"secret", b"order_1|pay_1", hashlib.sha256).hexdigest()
    result = await verify_payment(
        booking_db, user_id="pu", checkout_id=co["checkoutId"], payment_id="pay_1", signature=signature
    )
    assert result["ok"]
    completed = await change_status(booking_db, result["appointment"], "COMPLETED")
    await change_status(booking_db, completed, "COMPLETED")
    d = tables["Doctor"]
    assert (await booking_db.execute(select(d.c.balance).where(d.c.id == "doc"))).scalar_one() == 50000
    with pytest.raises(HTTPException):
        await change_status(booking_db, completed, "CANCELLED")


async def test_late_payment_refunds_without_reacquiring_slot(booking_db, monkeypatch):
    import app.features.payments.service as payments

    monkeypatch.setattr(payments.get_settings(), "razorpay_key_secret", "secret")
    monkeypatch.setattr(payments.get_settings(), "razorpay_key_id", "key")

    async def fake_provider(method, path, **kwargs):
        if path == "orders":
            return {"id": "order_late", "amount": 50000, "currency": "INR"}
        if path.endswith("/refund"):
            return {"id": "refund_late", "status": "processed"}
        return {
            "id": "pay_late",
            "order_id": "order_late",
            "amount": 50000,
            "currency": "INR",
            "status": "captured",
            "captured": True,
        }

    monkeypatch.setattr(payments, "provider", fake_provider)
    import app.features.payments.refunds as refunds

    monkeypatch.setattr(refunds, "provider", fake_provider)
    co = await initiate_checkout(
        booking_db,
        {"id": "pu"},
        {"id": "pat"},
        dict(idempotencyKey="late-checkout-123", doctorId="doc", slotId="slot", paymentMethod="ONLINE"),
    )
    s = tables["Slot"]
    await booking_db.execute(
        update(s).where(s.c.id == "slot").values(holdExpiresAt=utcnow() - timedelta(seconds=1))
    )
    newer = await acquire_hold(booking_db, "slot", "doc", "otherpat")
    signature = hmac.new(b"secret", b"order_late|pay_late", hashlib.sha256).hexdigest()
    result = await verify_payment(
        booking_db, user_id="pu", checkout_id=co["checkoutId"], payment_id="pay_late", signature=signature
    )
    assert result["refundStatus"] == "REFUNDED"
    row = (await booking_db.execute(select(s).where(s.c.id == "slot"))).mappings().one()
    assert row["heldByPatientId"] == "otherpat"
    assert row["holdToken"] == newer["holdToken"]
    assert not (await booking_db.execute(select(tables["Appointment"]))).all()


async def test_order_timeout_leaves_recoverable_intent_and_never_reposts(booking_db, monkeypatch):
    import httpx
    import app.features.payments.service as payments

    monkeypatch.setattr(payments.get_settings(), "razorpay_key_secret", "secret")
    monkeypatch.setattr(payments.get_settings(), "razorpay_key_id", "key")
    calls = []

    async def timeout(method, path, **kwargs):
        calls.append((method, path))
        raise httpx.ReadTimeout("simulated ambiguous provider response")

    monkeypatch.setattr(payments, "provider", timeout)
    data = dict(idempotencyKey="timeout-checkout-123", doctorId="doc", slotId="slot", paymentMethod="ONLINE")
    first = await initiate_checkout(booking_db, {"id": "pu"}, {"id": "pat"}, data)
    second = await initiate_checkout(booking_db, {"id": "pu"}, {"id": "pat"}, data)
    assert first["status"] == second["status"] == "UNRESOLVED"
    assert calls == [("POST", "orders")]
    assert second["reused"]


async def test_outbox_recipient_events_remain_in_order(booking_db, monkeypatch):
    import app.infrastructure.realtime as realtime
    from app.features.operations.outbox import dispatch_outbox

    calls = []

    async def publish(channel, target_user_id, payload):
        calls.append(payload["sequence"])

    monkeypatch.setattr(realtime, "publish_outbox", publish)
    outbox = tables["NotificationOutbox"]
    now = utcnow()
    for sequence in (1, 2):
        await booking_db.execute(
            insert(outbox).values(
                id=f"fifo-{sequence}",
                eventId=f"fifo-{sequence}",
                channel="SOCKET_NOTIFICATION",
                targetUserId="pu",
                payload={"sequence": sequence},
                status="PENDING",
                createdAt=now + timedelta(seconds=sequence),
            )
        )
    await booking_db.commit()
    assert (await dispatch_outbox(booking_db))["delivered"] == 1
    assert calls == [1]
    assert (await dispatch_outbox(booking_db))["delivered"] == 1
    assert calls == [1, 2]


async def test_legacy_refund_key_is_reused_instead_of_refunding_twice(booking_db):
    pay, ref = tables["Payment"], tables["Refund"]
    await booking_db.execute(
        insert(pay).values(
            id="payment-legacy",
            userId="pu",
            amount=50000,
            currency="INR",
            status="REFUND_PENDING",
            razorpayOrderId="order_old",
            razorpayPaymentId="pay_old",
        )
    )
    await booking_db.execute(
        insert(ref).values(
            id="refund-legacy",
            paymentId="payment-legacy",
            amount=50000,
            currency="INR",
            reason="Old cancellation",
            status="PENDING",
            idempotencyKey="cancel_patient_legacy",
        )
    )
    payment = dict(
        (await booking_db.execute(select(pay).where(pay.c.id == "payment-legacy"))).mappings().one()
    )
    reused = await enqueue_refund(booking_db, payment, "New cancellation retry")
    assert reused["id"] == "refund-legacy"
    assert len((await booking_db.execute(select(ref))).all()) == 1


async def test_checkout_requires_authenticated_patient(client):
    response = await client.post(
        "/api/checkout",
        json=dict(
            action="INITIATE",
            doctorId="doc",
            slotId="slot",
            paymentMethod="OFFLINE",
            idempotencyKey="unauthorized-attempt",
        ),
    )
    assert response.status_code == 401


async def test_invalid_webhook_signature_cannot_create_event(client, db, monkeypatch):
    from app.core.config import get_settings

    monkeypatch.setattr(get_settings(), "razorpay_webhook_secret", "webhook-secret")
    response = await client.post(
        "/api/webhooks/razorpay",
        content=b'{"event":"payment.captured"}',
        headers={"x-razorpay-signature": "0" * 64},
    )
    assert response.status_code == 401
    assert not (await db.execute(select(tables["WebhookEvent"]))).all()


async def test_unconfigured_cron_fails_closed(client, monkeypatch):
    from app.core.config import get_settings

    monkeypatch.setattr(get_settings(), "cron_secret", "")
    monkeypatch.setattr(get_settings(), "internal_api_secret", "")
    response = await client.get("/api/cron/reconcile-payments", headers={"authorization": "Bearer undefined"})
    assert response.status_code == 503
