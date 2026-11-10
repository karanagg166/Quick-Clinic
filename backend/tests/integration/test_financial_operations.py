"""Recovery workers exercise real leases, persistence and retry scheduling."""

from datetime import timedelta
from types import SimpleNamespace

import httpx
import pytest
from sqlalchemy import insert, select, update

from app.features.operations import service as recovery, webhooks
from app.infrastructure.database import tables, utcnow


@pytest.fixture
async def financial_state(db, seed_user):
    doctor, patient = await seed_user("DOCTOR"), await seed_user()
    now = utcnow()
    await db.execute(
        insert(tables["Slot"]).values(
            id="recovery-slot",
            doctorId=doctor["doctorId"],
            date=(now + timedelta(days=1)).date(),
            startTime=now + timedelta(days=1),
            endTime=now + timedelta(days=1, minutes=30),
            status="HELD",
            heldByPatientId=patient["patientId"],
            heldAt=now,
            holdToken="recovery-token",
            holdExpiresAt=now + timedelta(minutes=10),
        )
    )
    return doctor, patient


async def add_checkout(db, state, **overrides):
    doctor, patient = state
    values = dict(
        id="recovery-checkout",
        idempotencyKey="recovery-key",
        userId=patient["id"],
        patientId=patient["patientId"],
        doctorId=doctor["doctorId"],
        slotId="recovery-slot",
        holdToken="recovery-token",
        paymentMethod="ONLINE",
        amount=50000,
        currency="INR",
        status="UNRESOLVED",
        providerReference="qc_recovery_receipt",
        expiresAt=utcnow() + timedelta(minutes=10),
    )
    values.update(overrides)
    await db.execute(insert(tables["Checkout"]).values(**values))
    return values


async def add_payment(db, state, **overrides):
    doctor, patient = state
    values = dict(
        id="recovery-payment",
        userId=patient["id"],
        doctorId=doctor["doctorId"],
        slotId="recovery-slot",
        holdToken="recovery-token",
        amount=50000,
        currency="INR",
        status="CREATED",
        razorpayOrderId="order_recovery",
    )
    values.update(overrides)
    await db.execute(insert(tables["Payment"]).values(**values))
    return values


async def add_event(db, *, event_type="unknown", payload=None, **overrides):
    values = dict(
        id="recovery-event",
        providerEventId="evt_recovery",
        eventType=event_type,
        payload=payload or {},
        status="RECEIVED",
    )
    values.update(overrides)
    await db.execute(insert(tables["WebhookEvent"]).values(**values))
    return values


@pytest.mark.parametrize(
    "matches,status", [(0, "UNRESOLVED"), (1, "READY_FOR_PAYMENT"), (2, "MANUAL_REVIEW")]
)
async def test_ambiguous_order_recovery_only_queries_receipt_and_never_creates_another_order(
    db, financial_state, monkeypatch, matches, status
):
    await add_checkout(db, financial_state)
    calls = []

    async def provider(method, path, **kwargs):
        calls.append((method, path, kwargs))
        assert method == "GET", "Recovery must never repeat an ambiguous order POST"
        if path == "orders":
            return {
                "items": [
                    dict(id=f"order_{n}", receipt="qc_recovery_receipt", amount=50000, currency="INR")
                    for n in range(matches)
                ]
            }
        return {"items": []}

    monkeypatch.setattr(recovery, "provider", provider)
    result = await recovery.reconcile(db)
    row = (await db.execute(select(tables["Checkout"]))).mappings().one()
    assert row["status"] == status
    assert result["results"]["reconciledUnresolved"] == int(matches == 1)
    assert calls[0][2]["params"] == {"receipt": "qc_recovery_receipt", "count": 100}
    if matches == 2:
        assert row["lastError"] == "Multiple provider orders for receipt"
    assert len((await db.execute(select(tables["Payment"]))).all()) == int(matches == 1)


async def test_provider_errors_leave_reconciliation_retryable_and_report_only_safe_error(
    db, financial_state, monkeypatch
):
    await add_checkout(db, financial_state)
    # Recovery runs on durable rows from an earlier request/process. Its rollback
    # must not discard setup that has never been committed by this test.
    await db.commit()

    async def provider(*args, **kwargs):
        raise httpx.ConnectError("private-provider-diagnostic")

    monkeypatch.setattr(recovery, "provider", provider)
    result = await recovery.reconcile(db)
    assert result["ok"] is False
    assert result["results"]["errors"] == ["Checkout recovery-checkout requires retry"]
    assert "private-provider-diagnostic" not in str(result)
    assert result["backlog"]["pendingCheckouts"] == 1


@pytest.mark.parametrize("field", ["leaseExpiresAt", "nextAttemptAt"])
async def test_reconciliation_skips_checkout_with_an_active_lease_or_future_backoff(
    db, financial_state, monkeypatch, field
):
    await add_checkout(db, financial_state, **{field: utcnow() + timedelta(minutes=1)})

    async def forbidden(*args, **kwargs):
        raise AssertionError("Checkout is not eligible for recovery yet")

    monkeypatch.setattr(recovery, "provider", forbidden)
    result = await recovery.reconcile(db)
    assert result["ok"] is True and result["results"]["reconciledUnresolved"] == 0


async def test_reconciliation_recovers_legacy_payment_without_canonical_checkout(
    db, financial_state, monkeypatch
):
    payment = await add_payment(db, financial_state)
    verified = []

    async def provider(method, path, **kwargs):
        assert (method, path) == ("GET", "orders/order_recovery/payments")
        return {
            "items": [
                {"id": "pay_legacy", "status": "authorized"},
                {"id": "pay_capture", "status": "captured"},
            ]
        }

    async def verify(db, **kwargs):
        verified.append(kwargs)
        return {"ok": True}

    monkeypatch.setattr(recovery, "provider", provider)
    monkeypatch.setattr(recovery, "verify_payment", verify)
    result = await recovery.reconcile(db)
    assert result["results"]["reconciledPayments"] == 1
    assert verified == [
        {
            "user_id": payment["userId"],
            "order_id": "order_recovery",
            "payment_id": "pay_capture",
            "trusted": True,
        }
    ]
    assert (await db.execute(select(tables["Payment"].c.nextAttemptAt))).scalar_one() > utcnow()


async def test_stale_checkout_and_hold_are_expired_even_when_provider_work_is_budget_limited(
    db, financial_state, monkeypatch
):
    await add_checkout(
        db, financial_state, status="READY_FOR_PAYMENT", expiresAt=utcnow() - timedelta(seconds=1)
    )
    await db.execute(update(tables["Slot"]).values(holdExpiresAt=utcnow() - timedelta(seconds=1)))
    ticks = iter([100.0, 123.0, 123.0, 123.0])
    monkeypatch.setattr(recovery, "time", SimpleNamespace(monotonic=lambda: next(ticks, 123.0)))
    result = await recovery.reconcile(db)
    assert result["budgetExceeded"] is True and result["executionDurationMs"] == 23000
    assert result["results"]["reconciledCheckouts"] == 1
    assert (await db.execute(select(tables["Checkout"].c.status))).scalar_one() == "EXPIRED"
    slot = (await db.execute(select(tables["Slot"]))).mappings().one()
    assert slot["status"] == "AVAILABLE" and slot["holdToken"] is None


@pytest.mark.parametrize("state", ["SUCCESS", "REFUND_PENDING", "REFUNDED"])
async def test_failed_payment_webhook_never_downgrades_a_captured_or_refunded_payment(
    db, financial_state, state
):
    await add_payment(db, financial_state, status=state)
    event = await add_event(
        db,
        event_type="payment.failed",
        payload={"payload": {"payment": {"entity": {"order_id": "order_recovery"}}}},
    )
    result = await webhooks.process_webhook(db, event)
    assert result["processed"] is True
    assert (await db.execute(select(tables["Payment"].c.status))).scalar_one() == state


async def test_failed_payment_webhook_marks_uncaptured_order_failed(db, financial_state):
    await add_payment(db, financial_state)
    event = await add_event(
        db,
        event_type="payment.failed",
        payload={"payload": {"payment": {"entity": {"order_id": "order_recovery"}}}},
    )
    await webhooks.process_webhook(db, event)
    assert (await db.execute(select(tables["Payment"].c.status))).scalar_one() == "FAILED"


@pytest.mark.parametrize(
    "verification,pending", [({"ok": True}, False), ({"ok": False, "status": "PENDING_CAPTURE"}, True)]
)
async def test_authorized_webhook_uses_authoritative_verification_and_retains_pending_capture(
    db, financial_state, monkeypatch, verification, pending
):
    payment = await add_payment(db, financial_state)
    event = await add_event(
        db,
        event_type="payment.authorized",
        payload={"payload": {"payment": {"entity": {"order_id": "order_recovery", "id": "pay_recovery"}}}},
    )
    calls = []

    async def verify(db, **kwargs):
        calls.append(kwargs)
        return verification

    monkeypatch.setattr(webhooks, "verify_payment", verify)
    result = await webhooks.process_webhook(db, event)
    assert result["pendingLinkage"] is pending
    assert calls == [
        {
            "user_id": payment["userId"],
            "payment_id": "pay_recovery",
            "order_id": "order_recovery",
            "trusted": True,
        }
    ]
    row = (await db.execute(select(tables["WebhookEvent"]))).mappings().one()
    assert row["status"] == ("RECEIVED" if pending else "PROCESSED")


async def test_order_paid_webhook_looks_up_captured_payment_when_event_only_contains_order(
    db, financial_state, monkeypatch
):
    await add_payment(db, financial_state)
    event = await add_event(
        db, event_type="order.paid", payload={"payload": {"order": {"entity": {"id": "order_recovery"}}}}
    )
    calls = []

    async def provider(method, path, **kwargs):
        calls.append((method, path))
        return {"items": [{"id": "pay_recovery", "order_id": "order_recovery", "status": "captured"}]}

    async def verify(*args, **kwargs):
        assert kwargs["payment_id"] == "pay_recovery"
        return {"ok": True}

    monkeypatch.setattr(webhooks, "provider", provider)
    monkeypatch.setattr(webhooks, "verify_payment", verify)
    assert (await webhooks.process_webhook(db, event))["processed"] is True
    assert calls == [("GET", "orders/order_recovery/payments")]


async def test_webhook_provider_failure_is_durably_replayable_after_rollback(
    db, financial_state, monkeypatch
):
    await add_payment(db, financial_state)
    event = await add_event(
        db,
        event_type="payment.captured",
        payload={"payload": {"payment": {"entity": {"order_id": "order_recovery", "id": "pay_recovery"}}}},
    )

    async def unavailable(*args, **kwargs):
        raise httpx.ReadTimeout("private-provider-error")

    monkeypatch.setattr(webhooks, "verify_payment", unavailable)
    result = await webhooks.process_webhook(db, event)
    assert result == {"received": True, "retryScheduled": True}
    row = (await db.execute(select(tables["WebhookEvent"]))).mappings().one()
    assert row["status"] == "FAILED" and row["nextAttemptAt"] > utcnow()
    assert row["processingError"] == "Webhook processing failed"
    assert row["leaseOwner"] is row["leaseExpiresAt"] is None


@pytest.mark.parametrize("status", ["PROCESSED", "IGNORED", "PROCESSING"])
async def test_terminal_or_actively_leased_webhook_is_not_executed_twice(db, monkeypatch, status):
    event = await add_event(
        db, status=status, leaseOwner="another-worker", leaseExpiresAt=utcnow() + timedelta(minutes=1)
    )
    assert await webhooks.process_webhook(db, event) == {"received": True, "duplicate": True}
    assert (await db.execute(select(tables["WebhookEvent"].c.attempts))).scalar_one() == 0


async def test_refund_webhook_links_unknown_provider_refund_by_payment_before_reconciliation(
    db, financial_state, monkeypatch
):
    await add_payment(db, financial_state, status="REFUND_PENDING", razorpayPaymentId="pay_recovery")
    await db.execute(
        insert(tables["Refund"]).values(
            id="recovery-refund",
            paymentId="recovery-payment",
            amount=50000,
            currency="INR",
            reason="Cancellation",
            status="PENDING",
            idempotencyKey="recovery-refund-key",
        )
    )
    event = await add_event(
        db,
        event_type="refund.processed",
        payload={"payload": {"refund": {"entity": {"id": "rfnd_linked", "payment_id": "pay_recovery"}}}},
    )
    calls = []

    async def execute(db, refund_id):
        calls.append(refund_id)
        assert (await db.execute(select(tables["Refund"].c.razorpayRefundId))).scalar_one() == "rfnd_linked"
        return "REFUNDED"

    monkeypatch.setattr(webhooks, "execute_refund", execute)
    assert (await webhooks.process_webhook(db, event))["processed"] is True
    assert calls == ["recovery-refund"]


async def test_refund_webhook_without_local_payment_is_deferred_for_linkage(db):
    event = await add_event(
        db,
        event_type="refund.processed",
        payload={"payload": {"refund": {"entity": {"id": "rfnd_unknown", "payment_id": "pay_unknown"}}}},
    )
    result = await webhooks.process_webhook(db, event)
    assert result["pendingLinkage"] is True
    assert (await db.execute(select(tables["WebhookEvent"].c.status))).scalar_one() == "RECEIVED"


async def test_reconciliation_verifies_first_captured_payment_of_linked_checkout(
    db, financial_state, monkeypatch
):
    payment = await add_payment(db, financial_state)
    await add_checkout(
        db,
        financial_state,
        status="READY_FOR_PAYMENT",
        paymentId=payment["id"],
        razorpayOrderId=payment["razorpayOrderId"],
    )
    verified = []

    async def provider(method, path, **kwargs):
        assert (method, path) == ("GET", "orders/order_recovery/payments")
        return {
            "items": [
                {"id": "pay_authorized", "status": "authorized"},
                {"id": "pay_captured", "status": "captured"},
                {"id": "pay_extra", "status": "captured"},
            ]
        }

    async def verify(connection, **kwargs):
        verified.append(kwargs)
        return {"ok": True}

    monkeypatch.setattr(recovery, "provider", provider)
    monkeypatch.setattr(recovery, "verify_payment", verify)
    result = await recovery.reconcile(db)
    assert result["results"]["reconciledPayments"] == 1
    assert verified == [
        {
            "user_id": payment["userId"],
            "order_id": "order_recovery",
            "payment_id": "pay_captured",
            "trusted": True,
        }
    ]
    assert (await db.execute(select(tables["Checkout"].c.nextAttemptAt))).scalar_one() > utcnow()


async def test_legacy_payment_provider_error_preserves_committed_payment_and_reports_retry(
    db, financial_state, monkeypatch
):
    await add_payment(db, financial_state)
    await db.commit()

    async def unavailable(*args, **kwargs):
        raise httpx.ReadTimeout("private-legacy-provider-details")

    monkeypatch.setattr(recovery, "provider", unavailable)
    result = await recovery.reconcile(db)
    assert result["ok"] is False
    assert result["results"]["errors"] == ["Payment recovery-payment requires retry"]
    assert "private-legacy-provider-details" not in str(result)
    row = (await db.execute(select(tables["Payment"]))).mappings().one()
    assert row["status"] == "CREATED" and row["nextAttemptAt"] is None


@pytest.mark.parametrize("outcome,completed", [("REFUNDED", 1), ("REFUND_PENDING", 0)])
async def test_reconciliation_runs_eligible_refund_worker_and_counts_only_completed_refunds(
    db, financial_state, monkeypatch, outcome, completed
):
    await add_payment(db, financial_state, status="REFUND_PENDING")
    await db.execute(
        insert(tables["Refund"]).values(
            id="eligible-refund",
            paymentId="recovery-payment",
            amount=50000,
            reason="Cancellation",
            status="PENDING",
            idempotencyKey="eligible-refund-key",
        )
    )
    calls = []

    async def execute(connection, refund_id):
        calls.append(refund_id)
        return outcome

    monkeypatch.setattr(recovery, "execute_refund", execute)
    result = await recovery.reconcile(db)
    assert result["ok"] is True
    assert result["results"]["reconciledRefunds"] == completed
    assert calls == ["eligible-refund"]


async def test_reconciliation_replays_due_webhook_but_preserves_future_retry_and_active_lease(db):
    now = utcnow()
    await add_event(db)
    await add_event(
        db, id="future-event", providerEventId="evt_future", nextAttemptAt=now + timedelta(minutes=1)
    )
    await add_event(
        db,
        id="leased-event",
        providerEventId="evt_leased",
        status="PROCESSING",
        leaseOwner="live-worker",
        leaseExpiresAt=now + timedelta(minutes=1),
    )
    result = await recovery.reconcile(db)
    assert result["results"]["replayedWebhooks"] == 1
    rows = {r["id"]: r for r in (await db.execute(select(tables["WebhookEvent"]))).mappings()}
    assert rows["recovery-event"]["status"] == "IGNORED"
    assert rows["future-event"]["attempts"] == 0
    assert rows["leased-event"]["leaseOwner"] == "live-worker"
    assert result["backlog"]["pendingWebhooks"] == 2


@pytest.mark.parametrize("work", ["legacy", "refund", "webhook"])
async def test_recovery_time_budget_stops_each_provider_or_replay_worker(
    db, financial_state, monkeypatch, work
):
    if work == "legacy":
        await add_payment(db, financial_state)
    elif work == "refund":
        await add_payment(db, financial_state, status="REFUND_PENDING")
        await db.execute(
            insert(tables["Refund"]).values(
                id="budget-refund",
                paymentId="recovery-payment",
                amount=50000,
                reason="Cancellation",
                status="PENDING",
                idempotencyKey="budget-refund-key",
            )
        )
    else:
        await add_event(db)
    ticks = iter([100.0, 123.0])
    monkeypatch.setattr(recovery, "time", SimpleNamespace(monotonic=lambda: next(ticks, 123.0)))
    calls = []

    async def unexpected(*args, **kwargs):
        calls.append((args, kwargs))
        raise AssertionError("Expired execution budget must stop recovery work")

    monkeypatch.setattr(recovery, "provider", unexpected)
    monkeypatch.setattr(recovery, "execute_refund", unexpected)
    monkeypatch.setattr(recovery, "process_webhook", unexpected)
    result = await recovery.reconcile(db)
    assert result["budgetExceeded"] is True and result["executionDurationMs"] == 23000
    assert calls == []
    assert (
        result["results"]["reconciledPayments"]
        == result["results"]["reconciledRefunds"]
        == result["results"]["replayedWebhooks"]
        == 0
    )


@pytest.mark.parametrize("field", ["nextAttemptAt", "leaseExpiresAt"])
async def test_refund_recovery_does_not_steal_an_active_claim_or_ignore_backoff(
    db, financial_state, monkeypatch, field
):
    await add_payment(db, financial_state, status="REFUND_PENDING")
    await db.execute(
        insert(tables["Refund"]).values(
            id="deferred-refund",
            paymentId="recovery-payment",
            amount=50000,
            reason="Cancellation",
            status="PENDING",
            idempotencyKey="deferred-refund-key",
            **{field: utcnow() + timedelta(minutes=1)},
        )
    )
    calls = []

    async def execute(*args, **kwargs):
        calls.append(True)
        return "REFUNDED"

    monkeypatch.setattr(recovery, "execute_refund", execute)
    result = await recovery.reconcile(db)
    assert calls == [] and result["backlog"]["pendingRefunds"] == 1


async def test_captured_webhook_without_payment_identity_is_ignored_without_verification(
    db, financial_state, monkeypatch
):
    await add_payment(db, financial_state)
    event = await add_event(
        db,
        event_type="payment.captured",
        payload={
            "payload": {"payment": {"entity": {"order_id": "order_recovery"}}},
        },
    )
    calls = []

    async def verify(*args, **kwargs):
        calls.append(True)

    monkeypatch.setattr(webhooks, "verify_payment", verify)
    result = await webhooks.process_webhook(db, event)
    assert result["processed"] is False and result["pendingLinkage"] is False
    assert calls == []
    assert (await db.execute(select(tables["WebhookEvent"].c.status))).scalar_one() == "IGNORED"
