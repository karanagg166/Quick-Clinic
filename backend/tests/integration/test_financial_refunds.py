"""Refund claims and provider outcomes across committed database transactions."""

from datetime import timedelta

import httpx
import pytest
from sqlalchemy import insert, select, update

from app.features.payments import refunds
from app.features.payments.queries import authoritative_status
from app.infrastructure.database import tables, utcnow


@pytest.fixture
async def payment(db, seed_user):
    patient = await seed_user()
    values = dict(
        id="refund-payment",
        userId=patient["id"],
        amount=73400,
        currency="INR",
        status="SUCCESS",
        razorpayOrderId="order_refund",
        razorpayPaymentId="pay_refund",
    )
    await db.execute(insert(tables["Payment"]).values(**values))
    return values


async def test_enqueued_refund_snapshots_full_captured_amount_and_deduplicates_reasons(db, payment):
    first = await refunds.enqueue_refund(db, payment, "Patient cancellation")
    second = await refunds.enqueue_refund(db, payment, "Recovery retry")
    assert first["id"] == second["id"]
    assert second["amount"] == 73400 and second["currency"] == "INR"
    assert second["reason"] == "Patient cancellation"
    assert second["idempotencyKey"] == f"refund:full:{payment['id']}"
    assert (await db.execute(select(tables["Payment"].c.status))).scalar_one() == "REFUND_PENDING"
    assert len((await db.execute(select(tables["Refund"]))).all()) == 1


async def test_already_refunded_payment_creates_a_terminal_claim_without_provider_call(
    db, payment, monkeypatch
):
    await db.execute(update(tables["Payment"]).values(status="REFUNDED"))
    claim = await refunds.enqueue_refund(db, payment, "Historical recovery")

    async def forbidden(*args, **kwargs):
        raise AssertionError("A completed refund must not contact the provider")

    monkeypatch.setattr(refunds, "provider", forbidden)
    assert claim["status"] == "PROCESSED"
    assert await refunds.execute_refund(db, claim["id"]) == "REFUNDED"
    row = (await db.execute(select(tables["Refund"]))).mappings().one()
    assert row["attempts"] == 0 and row["processedAt"] is not None


@pytest.mark.parametrize(
    "provider_status,local_status,result",
    [
        ("processed", "PROCESSED", "REFUNDED"),
        ("pending", "PENDING", "REFUND_PENDING"),
        ("failed", "FAILED", "REFUND_PENDING"),
    ],
)
async def test_refund_provider_outcome_is_persisted_and_lease_released(
    db, payment, monkeypatch, provider_status, local_status, result
):
    claim = await refunds.enqueue_refund(db, payment, "Cancellation")
    calls = []

    async def provider(method, path, **kwargs):
        calls.append((method, path, kwargs))
        return {"id": "rfnd_test", "status": provider_status}

    monkeypatch.setattr(refunds, "provider", provider)
    assert await refunds.execute_refund(db, claim["id"]) == result
    row = (await db.execute(select(tables["Refund"]))).mappings().one()
    assert row["status"] == local_status and row["razorpayRefundId"] == "rfnd_test"
    assert row["attempts"] == 1 and row["lastAttemptAt"] is not None
    assert row["leaseOwner"] is row["leaseExpiresAt"] is None
    assert bool(row["nextAttemptAt"]) is (provider_status != "processed")
    method, path, kwargs = calls[0]
    assert (method, path) == ("POST", "payments/pay_refund/refund")
    assert kwargs["payload"]["amount"] == 73400
    assert kwargs["headers"]["X-Refund-Idempotency"] == claim["idempotencyKey"]
    pay_status = (await db.execute(select(tables["Payment"].c.status))).scalar_one()
    assert pay_status == ("REFUNDED" if provider_status == "processed" else "REFUND_PENDING")


async def test_refund_with_provider_identity_is_reconciled_by_get_and_never_reposted(
    db, payment, monkeypatch
):
    claim = await refunds.enqueue_refund(db, payment, "Retry")
    await db.execute(update(tables["Refund"]).values(razorpayRefundId="rfnd_existing"))
    calls = []

    async def provider(method, path, **kwargs):
        calls.append((method, path))
        return {"id": "rfnd_existing", "status": "processed"}

    monkeypatch.setattr(refunds, "provider", provider)
    assert await refunds.execute_refund(db, claim["id"]) == "REFUNDED"
    assert calls == [("GET", "payments/pay_refund/refunds/rfnd_existing")]


async def test_refund_active_lease_prevents_duplicate_provider_execution(db, payment, monkeypatch):
    claim = await refunds.enqueue_refund(db, payment, "Cancellation")
    await db.execute(
        update(tables["Refund"]).values(
            status="PROCESSING", leaseOwner="another-worker", leaseExpiresAt=utcnow() + timedelta(minutes=1)
        )
    )

    async def forbidden(*args, **kwargs):
        raise AssertionError("An active refund lease must not be stolen")

    monkeypatch.setattr(refunds, "provider", forbidden)
    assert await refunds.execute_refund(db, claim["id"]) == "REFUND_PENDING"
    row = (await db.execute(select(tables["Refund"]))).mappings().one()
    assert row["leaseOwner"] == "another-worker" and row["attempts"] == 0


async def test_refund_expired_lease_can_be_reclaimed(db, payment, monkeypatch):
    claim = await refunds.enqueue_refund(db, payment, "Cancellation")
    await db.execute(
        update(tables["Refund"]).values(
            status="PROCESSING", leaseOwner="dead-worker", leaseExpiresAt=utcnow() - timedelta(seconds=1)
        )
    )

    async def provider(*args, **kwargs):
        return {"id": "rfnd_reclaimed", "status": "processed"}

    monkeypatch.setattr(refunds, "provider", provider)
    assert await refunds.execute_refund(db, claim["id"]) == "REFUNDED"
    assert (await db.execute(select(tables["Refund"].c.attempts))).scalar_one() == 1


async def test_ambiguous_refund_timeout_retains_retryable_claim_and_original_idempotency_key(
    db, payment, monkeypatch
):
    claim = await refunds.enqueue_refund(db, payment, "Cancellation")
    keys = []

    async def provider(method, path, **kwargs):
        keys.append(kwargs["headers"]["X-Refund-Idempotency"])
        raise httpx.ReadTimeout("Isolated ambiguous refund outcome")

    monkeypatch.setattr(refunds, "provider", provider)
    for _ in range(2):
        assert await refunds.execute_refund(db, claim["id"]) == "REFUND_PENDING"
    row = (await db.execute(select(tables["Refund"]))).mappings().one()
    assert row["status"] == "PENDING" and row["attempts"] == 2
    assert row["nextAttemptAt"] > utcnow()
    assert row["failureReason"] == "Provider refund outcome unresolved"
    assert keys == [claim["idempotencyKey"]] * 2
    assert len((await db.execute(select(tables["Refund"]))).all()) == 1


async def test_missing_provider_payment_identity_remains_pending_without_network(db, payment, monkeypatch):
    await db.execute(update(tables["Payment"]).values(razorpayPaymentId=None))
    claim = await refunds.enqueue_refund(db, payment, "Recovery")

    async def forbidden(*args, **kwargs):
        raise AssertionError("No provider payment identity exists")

    monkeypatch.setattr(refunds, "provider", forbidden)
    assert await refunds.execute_refund(db, claim["id"]) == "REFUND_PENDING"
    row = (await db.execute(select(tables["Refund"]))).mappings().one()
    assert row["status"] == "PENDING" and row["nextAttemptAt"] is not None


async def test_unknown_refund_id_has_no_side_effect(db):
    assert await refunds.execute_refund(db, "missing") == "FAILED"
    assert not (await db.execute(select(tables["Refund"]))).all()


@pytest.mark.parametrize(
    "status,public_status",
    [
        ("PENDING", "REFUND_PENDING"),
        ("PROCESSING", "REFUND_PENDING"),
        ("FAILED", "FAILED"),
        ("PROCESSED", "REFUNDED"),
    ],
)
async def test_owner_scoped_legacy_payment_snapshot_reports_refund_status(db, payment, status, public_status):
    await db.execute(
        insert(tables["Refund"]).values(
            id="snapshot-refund",
            paymentId=payment["id"],
            amount=payment["amount"],
            currency="INR",
            reason="Cancellation",
            status=status,
            idempotencyKey="snapshot-idempotency",
        )
    )
    result = await authoritative_status(db, user_id=payment["userId"], order_id=payment["razorpayOrderId"])
    assert result["refundStatus"] == public_status
    assert result["refund"]["id"] == "snapshot-refund"
    assert result["paymentId"] == payment["razorpayPaymentId"]
    assert result["amount"] == payment["amount"]
