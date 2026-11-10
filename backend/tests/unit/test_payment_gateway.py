"""Provider I/O is exercised through an in-memory HTTP transport only."""

import hashlib
import hmac
import json

import httpx
import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from app.core.config import get_settings
from app.features.payments import gateway
from app.features.payments.queries import checkout_result
from app.features.payments.schemas import CheckoutInitiationRequest, CheckoutVerificationRequest


def test_signature_accepts_uppercase_hex_and_binds_the_exact_bytes():
    signature = hmac.new(b"secret", b"original", hashlib.sha256).hexdigest()
    assert gateway.verify_signature(b"original", signature.upper(), "secret")
    assert not gateway.verify_signature(b"original\n", signature, "secret")


@pytest.mark.parametrize("signature", [None, 42, {}, [], "g" * 64, "a" * 65])
def test_malformed_signatures_are_rejected(signature):
    assert not gateway.verify_signature(b"message", signature, "secret")


@pytest.mark.parametrize("missing", ["razorpay_key_id", "razorpay_key_secret"])
async def test_provider_requires_both_credentials_before_opening_a_connection(db, monkeypatch, missing):
    settings = get_settings()
    monkeypatch.setattr(settings, "razorpay_key_id", "test-key")
    monkeypatch.setattr(settings, "razorpay_key_secret", "test-secret")
    monkeypatch.setattr(settings, missing, "")
    with pytest.raises(HTTPException) as exc:
        await gateway.provider("GET", "orders")
    assert exc.value.status_code == 503


async def test_provider_sends_basic_auth_json_headers_and_query_with_bounded_timeout(db, monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "razorpay_key_id", "test-key")
    monkeypatch.setattr(settings, "razorpay_key_secret", "test-secret")
    captured = []

    def handler(request):
        captured.append(request)
        return httpx.Response(200, json={"id": "order_test"})

    real_client = httpx.AsyncClient

    def client_factory(**kwargs):
        assert kwargs["timeout"] == 15.0
        assert kwargs["auth"] == ("test-key", "test-secret")
        return real_client(**kwargs, transport=httpx.MockTransport(handler))

    monkeypatch.setattr(gateway.httpx, "AsyncClient", client_factory)
    result = await gateway.provider(
        "POST",
        "orders",
        payload={"amount": 12300},
        headers={"X-Request-ID": "request-test"},
        params={"receipt": "r_test"},
    )
    assert result == {"id": "order_test"}
    request = captured[0]
    assert request.url.host == "api.razorpay.com"
    assert request.url.path == "/v1/orders"
    assert request.url.params["receipt"] == "r_test"
    assert request.headers["authorization"].startswith("Basic ")
    assert request.headers["x-request-id"] == "request-test"
    assert json.loads(request.content) == {"amount": 12300}


@pytest.mark.parametrize("status", [400, 401, 429, 500, 503])
async def test_provider_preserves_http_failures_for_saga_recovery(db, monkeypatch, status):
    monkeypatch.setattr(get_settings(), "razorpay_key_id", "test-key")
    monkeypatch.setattr(get_settings(), "razorpay_key_secret", "test-secret")
    real_client = httpx.AsyncClient
    transport = httpx.MockTransport(
        lambda request: httpx.Response(status, json={"error": "provider failure"})
    )
    monkeypatch.setattr(
        gateway.httpx, "AsyncClient", lambda **kwargs: real_client(**kwargs, transport=transport)
    )
    with pytest.raises(httpx.HTTPStatusError) as exc:
        await gateway.provider("GET", "orders")
    assert exc.value.response.status_code == status


@pytest.mark.parametrize(
    ("status", "ok", "can_retry", "can_restart"),
    [
        ("CONFIRMED", True, False, False),
        ("READY_FOR_PAYMENT", True, True, False),
        ("PENDING_ORDER", False, True, False),
        ("UNRESOLVED", False, True, False),
        ("EXPIRED", False, False, True),
        ("FAILED", False, False, True),
        ("MANUAL_REVIEW", False, False, False),
    ],
)
def test_checkout_result_exposes_actionable_status_flags(status, ok, can_retry, can_restart):
    record = dict(
        id="checkout",
        status=status,
        paymentMethod="ONLINE",
        amount=50000,
        currency="INR",
        expiresAt=None,
        holdToken="private",
        leaseOwner="private",
    )
    result = checkout_result(record, reused=True)
    assert (result["ok"], result["canRetry"], result["canRestart"]) == (ok, can_retry, can_restart)
    assert result["reused"] is True
    assert "holdToken" not in result and "leaseOwner" not in result


@pytest.mark.parametrize("key", ["short", "x" * 129])
def test_checkout_idempotency_key_has_bounded_length(key):
    with pytest.raises(ValidationError):
        CheckoutInitiationRequest(
            action="INITIATE", doctorId="doctor", slotId="slot", paymentMethod="ONLINE", idempotencyKey=key
        )


@pytest.mark.parametrize("signature", ["", "0" * 63, "z" * 64])
def test_checkout_verification_requires_a_sha256_hex_signature(signature):
    with pytest.raises(ValidationError):
        CheckoutVerificationRequest(action="VERIFY", paymentId="pay", signature=signature)
