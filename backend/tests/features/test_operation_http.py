"""Signed webhooks and scheduled recovery endpoints reject invalid callers."""

import hashlib
import hmac
import json

import pytest
from sqlalchemy import select

from app.core.config import get_settings
from app.infrastructure.database import tables


def signed(raw, *, event_id=None):
    headers = {
        "x-razorpay-signature": hmac.new(b"isolated-webhook-secret", raw, hashlib.sha256).hexdigest(),
        "content-type": "application/json",
    }
    if event_id is not None:
        headers["x-razorpay-event-id"] = event_id
    return headers


@pytest.mark.parametrize(
    "method,path",
    [
        ("GET", "/api/cron/expire-appointments"),
        ("GET", "/api/cron/reconcile-payments"),
        ("POST", "/api/cron/reconcile-payments"),
    ],
)
@pytest.mark.parametrize("headers", [{}, {"authorization": "Bearer wrong"}, {"x-cron-secret": "wrong"}])
async def test_recovery_jobs_require_the_configured_secret(client, method, path, headers):
    response = await client.request(method, path, headers=headers)
    assert response.status_code == 401


@pytest.mark.parametrize(
    "method,path,headers",
    [
        ("GET", "/api/cron/expire-appointments", {"authorization": "Bearer isolated-test-cron-secret"}),
        ("GET", "/api/cron/reconcile-payments", {"x-cron-secret": "isolated-test-cron-secret"}),
        ("POST", "/api/cron/reconcile-payments", {"authorization": "Bearer isolated-test-cron-secret"}),
    ],
)
async def test_authenticated_recovery_jobs_return_structured_empty_results(client, method, path, headers):
    response = await client.request(method, path, headers=headers)
    assert response.status_code == 200
    data = response.json()
    if "expire" in path:
        assert data["expired"] == data["refunded"] == data["refundFailed"] == 0
    else:
        assert data["ok"] is True
        assert data["results"]["errors"] == []
        assert all(count == 0 for count in data["backlog"].values())


async def test_cron_can_use_internal_secret_when_dedicated_secret_is_unset(client, monkeypatch):
    monkeypatch.setattr(get_settings(), "cron_secret", "")
    response = await client.get(
        "/api/cron/expire-appointments", headers={"x-cron-secret": "isolated-test-internal-secret"}
    )
    assert response.status_code == 200


async def test_missing_webhook_signature_does_not_persist_an_event(client, db):
    response = await client.post("/api/webhooks/razorpay", json={"event": "payment.captured"})
    assert response.status_code == 400
    assert not (await db.execute(select(tables["WebhookEvent"]))).all()


async def test_webhook_size_limit_applies_before_signature_or_json_processing(client, db):
    response = await client.post("/api/webhooks/razorpay", content=b"x" * 1_048_577)
    assert response.status_code == 413
    assert not (await db.execute(select(tables["WebhookEvent"]))).all()


@pytest.mark.parametrize("raw", [b"{", b"\xff", b"null", b"[]", b'"event"', b"42"])
async def test_signed_invalid_webhook_payloads_return_400_without_event_writes(client, db, monkeypatch, raw):
    monkeypatch.setattr(get_settings(), "razorpay_webhook_secret", "isolated-webhook-secret")
    response = await client.post("/api/webhooks/razorpay", content=raw, headers=signed(raw))
    assert response.status_code == 400
    assert not (await db.execute(select(tables["WebhookEvent"]))).all()


@pytest.mark.parametrize("identity", [123, {"id": "bad"}, "x" * 257])
async def test_event_identity_has_a_bounded_string_contract(client, db, monkeypatch, identity):
    monkeypatch.setattr(get_settings(), "razorpay_webhook_secret", "isolated-webhook-secret")
    raw = json.dumps({"id": identity, "event": "unknown"}).encode()
    response = await client.post("/api/webhooks/razorpay", content=raw, headers=signed(raw))
    assert response.status_code == 400
    assert not (await db.execute(select(tables["WebhookEvent"]))).all()


async def test_unknown_webhook_is_durably_ignored_and_duplicate_is_not_reprocessed(client, db, monkeypatch):
    monkeypatch.setattr(get_settings(), "razorpay_webhook_secret", "isolated-webhook-secret")
    raw = b'{"event":"subscription.unknown"}'
    first = await client.post("/api/webhooks/razorpay", content=raw, headers=signed(raw, event_id="evt_test"))
    second = await client.post(
        "/api/webhooks/razorpay", content=raw, headers=signed(raw, event_id="evt_test")
    )
    assert first.status_code == second.status_code == 200
    assert second.json() == {"received": True, "duplicate": True, "status": "IGNORED"}
    stored = (await db.execute(select(tables["WebhookEvent"]))).mappings().one()
    assert stored["attempts"] == 1 and stored["processedAt"] is not None


async def test_identical_webhook_without_provider_id_uses_stable_content_hash(client, db, monkeypatch):
    monkeypatch.setattr(get_settings(), "razorpay_webhook_secret", "isolated-webhook-secret")
    raw = b'{"event":"unknown"}'
    for _ in range(2):
        response = await client.post("/api/webhooks/razorpay", content=raw, headers=signed(raw))
        assert response.status_code == 200
    stored = (await db.execute(select(tables["WebhookEvent"]))).mappings().one()
    assert stored["providerEventId"] == hashlib.sha256(raw).hexdigest()


async def test_captured_event_arriving_before_local_order_is_kept_for_replay(client, db, monkeypatch):
    monkeypatch.setattr(get_settings(), "razorpay_webhook_secret", "isolated-webhook-secret")
    raw = json.dumps(
        {
            "event": "payment.captured",
            "payload": {
                "payment": {
                    "entity": {
                        "id": "pay_not_linked_yet",
                        "order_id": "order_not_linked_yet",
                    }
                }
            },
        }
    ).encode()
    response = await client.post("/api/webhooks/razorpay", content=raw, headers=signed(raw))
    assert response.status_code == 200 and response.json()["pendingLinkage"] is True
    row = (await db.execute(select(tables["WebhookEvent"]))).mappings().one()
    assert row["status"] == "RECEIVED" and row["nextAttemptAt"] is not None
    assert row["leaseOwner"] is row["leaseExpiresAt"] is None


async def test_dedicated_webhook_secret_takes_precedence_over_payment_api_secret(client, db, monkeypatch):
    monkeypatch.setattr(get_settings(), "razorpay_webhook_secret", "dedicated-secret")
    monkeypatch.setattr(get_settings(), "razorpay_key_secret", "isolated-webhook-secret")
    raw = b'{"event":"unknown"}'
    response = await client.post("/api/webhooks/razorpay", content=raw, headers=signed(raw))
    assert response.status_code == 401
    assert not (await db.execute(select(tables["WebhookEvent"]))).all()
