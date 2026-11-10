"""Checkout API contracts with deterministic provider responses and real persistence."""

import hashlib
import hmac
from datetime import timedelta
from uuid import uuid4

import httpx
import pytest
from sqlalchemy import insert, select, update

from app.core.config import get_settings
from app.core.security import issue_token
from app.features.payments import service as payments
from app.infrastructure.database import tables, utcnow


def auth(user):
    return {"authorization": f"Bearer {issue_token(user)}"}


def signature(order="order_http", payment="pay_http"):
    return hmac.new(b"isolated-payment-secret", f"{order}|{payment}".encode(), hashlib.sha256).hexdigest()


@pytest.fixture
async def checkout_scenario(db, seed_user, monkeypatch):
    doctor, patient, outsider = await seed_user("DOCTOR"), await seed_user(), await seed_user()
    start = utcnow() + timedelta(days=1)
    await db.execute(
        insert(tables["Slot"]).values(
            id="payment-http-slot",
            doctorId=doctor["doctorId"],
            date=start.date(),
            startTime=start,
            endTime=start + timedelta(minutes=30),
            status="AVAILABLE",
        )
    )
    monkeypatch.setattr(get_settings(), "razorpay_key_id", "isolated-payment-key")
    monkeypatch.setattr(get_settings(), "razorpay_key_secret", "isolated-payment-secret")
    calls = []
    details = dict(
        id="pay_http", order_id="order_http", amount=50000, currency="INR", status="captured", captured=True
    )

    async def provider(method, path, **kwargs):
        calls.append((method, path, kwargs))
        if path == "orders":
            return {"id": "order_http", "amount": 50000, "currency": "INR"}
        return details.copy()

    monkeypatch.setattr(payments, "provider", provider)
    return doctor, patient, outsider, details, calls


async def initiate(client, scenario, method="ONLINE", key="payment-http-idempotency"):
    doctor, patient, *_ = scenario
    return await client.post(
        "/api/checkout",
        headers=auth(patient),
        json={
            "action": "INITIATE",
            "doctorId": doctor["doctorId"],
            "slotId": "payment-http-slot",
            "paymentMethod": method,
            "idempotencyKey": key,
        },
    )


async def verify(client, patient, checkout_id, **overrides):
    body = dict(action="VERIFY", checkoutId=checkout_id, paymentId="pay_http", signature=signature())
    body.update(overrides)
    return await client.post("/api/checkout", headers=auth(patient), json=body)


async def test_online_checkout_persists_server_fee_snapshot_and_provider_metadata(
    client, db, checkout_scenario
):
    doctor, patient, _, _, calls = checkout_scenario
    response = await initiate(client, checkout_scenario)
    assert response.status_code == 201
    data = response.json()
    assert data["status"] == "READY_FOR_PAYMENT" and data["amount"] == 50000
    assert data["currency"] == "INR" and data["keyId"] == "isolated-payment-key"
    method, path, kwargs = calls[0]
    assert (method, path) == ("POST", "orders")
    assert kwargs["payload"]["notes"]["userId"] == patient["id"]
    assert kwargs["payload"]["receipt"].startswith("qc_")
    await db.execute(update(tables["Doctor"]).values(fees=2000))
    repeated = await initiate(client, checkout_scenario)
    assert repeated.status_code == 200 and repeated.json()["amount"] == 50000
    assert len(calls) == 1
    assert (await db.execute(select(tables["Payment"].c.amount))).scalar_one() == 50000


async def test_captured_payment_returns_same_appointment_on_repeated_verification(
    client, db, checkout_scenario
):
    _, patient, *_ = checkout_scenario
    checkout = (await initiate(client, checkout_scenario)).json()
    first = await verify(client, patient, checkout["checkoutId"])
    second = await verify(client, patient, checkout["checkoutId"])
    assert first.status_code == second.status_code == 200
    assert first.json()["appointment"]["id"] == second.json()["appointment"]["id"]
    assert len((await db.execute(select(tables["Appointment"]))).all()) == 1
    assert (await db.execute(select(tables["Payment"].c.status))).scalar_one() == "SUCCESS"
    assert (await db.execute(select(tables["Checkout"].c.status))).scalar_one() == "CONFIRMED"


@pytest.mark.parametrize(
    "field,value", [("id", "pay_other"), ("order_id", "order_other"), ("amount", 1), ("currency", "USD")]
)
async def test_verified_signature_cannot_bypass_provider_payment_binding(
    client, db, checkout_scenario, field, value
):
    _, patient, _, details, _ = checkout_scenario
    checkout = (await initiate(client, checkout_scenario)).json()
    details[field] = value
    response = await verify(client, patient, checkout["checkoutId"])
    assert response.status_code == 400
    assert not (await db.execute(select(tables["Appointment"]))).all()
    assert (await db.execute(select(tables["Payment"].c.status))).scalar_one() == "CREATED"


@pytest.mark.parametrize(
    "status,captured,expected",
    [
        ("authorized", False, 202),
        ("created", False, 202),
        ("failed", False, 400),
        ("captured", False, 400),
    ],
)
async def test_only_authoritatively_captured_payments_can_confirm(
    client, db, checkout_scenario, status, captured, expected
):
    _, patient, _, details, _ = checkout_scenario
    checkout = (await initiate(client, checkout_scenario)).json()
    details.update(status=status, captured=captured)
    response = await verify(client, patient, checkout["checkoutId"])
    assert response.status_code == expected
    if expected == 202:
        assert response.json()["status"] == "PENDING_CAPTURE"
    assert not (await db.execute(select(tables["Appointment"]))).all()


async def test_invalid_signature_is_rejected_without_provider_call(client, checkout_scenario):
    _, patient, _, _, calls = checkout_scenario
    checkout = (await initiate(client, checkout_scenario)).json()
    response = await verify(client, patient, checkout["checkoutId"], signature="0" * 64)
    assert response.status_code == 400 and len(calls) == 1


async def test_conflicting_checkout_and_order_ids_are_rejected_before_provider_lookup(
    client, checkout_scenario
):
    _, patient, _, _, calls = checkout_scenario
    checkout = (await initiate(client, checkout_scenario)).json()
    response = await verify(client, patient, checkout["checkoutId"], orderId="order_other")
    assert response.status_code == 400 and len(calls) == 1


async def test_payment_provider_outage_returns_502_without_local_capture(
    client, db, checkout_scenario, monkeypatch
):
    _, patient, *_ = checkout_scenario
    checkout = (await initiate(client, checkout_scenario)).json()

    async def unavailable(*args, **kwargs):
        raise httpx.ReadTimeout("isolated provider timeout")

    monkeypatch.setattr(payments, "provider", unavailable)
    response = await verify(client, patient, checkout["checkoutId"])
    assert response.status_code == 502
    assert (await db.execute(select(tables["Payment"].c.status))).scalar_one() == "CREATED"


async def test_checkout_status_and_verification_do_not_leak_other_patients_orders(client, checkout_scenario):
    _, patient, outsider, _, calls = checkout_scenario
    checkout = (await initiate(client, checkout_scenario)).json()
    path = f"/api/checkout/{checkout['checkoutId']}/status"
    assert (await client.get(path, headers=auth(outsider))).status_code == 404
    assert (await verify(client, outsider, checkout["checkoutId"])).status_code == 404
    assert len(calls) == 1
    own = await client.get(path, headers=auth(patient))
    assert own.status_code == 200
    assert own.json()["status"] == "READY_FOR_PAYMENT" and own.json()["isConfirmed"] is False


async def test_offline_checkout_status_contains_confirmed_appointment_without_provider_order(
    client, checkout_scenario
):
    _, patient, _, _, calls = checkout_scenario
    checkout = (await initiate(client, checkout_scenario, "OFFLINE")).json()
    response = await client.get(f"/api/checkout/{checkout['checkoutId']}/status", headers=auth(patient))
    assert response.status_code == 200 and response.json()["isConfirmed"] is True
    assert response.json()["appointmentId"] == checkout["appointment"]["id"]
    assert response.json()["orderId"] is None and calls == []


@pytest.mark.parametrize("role", ["DOCTOR", "ADMIN"])
async def test_checkout_is_restricted_to_patients(client, seed_user, role):
    user = await seed_user(role)
    response = await client.post(
        "/api/checkout",
        headers=auth(user),
        json={
            "action": "INITIATE",
            "doctorId": "doctor",
            "slotId": "slot",
            "paymentMethod": "OFFLINE",
            "idempotencyKey": "role-bound-checkout",
        },
    )
    assert response.status_code == 403


@pytest.mark.parametrize(
    "body",
    [
        {"action": "DELETE"},
        {
            "action": "INITIATE",
            "doctorId": "doc",
            "slotId": "slot",
            "paymentMethod": "CASH",
            "idempotencyKey": "valid-key",
        },
        {"action": "VERIFY", "paymentId": "pay", "signature": "invalid"},
    ],
)
async def test_checkout_discriminated_contract_rejects_invalid_bodies(client, seed_user, body):
    patient = await seed_user()
    assert (await client.post("/api/checkout", headers=auth(patient), json=body)).status_code == 400


@pytest.mark.parametrize("fee", [0, -1])
async def test_checkout_rejects_invalid_doctor_fees_before_holding_slot(client, db, checkout_scenario, fee):
    await db.execute(update(tables["Doctor"]).values(fees=fee))
    response = await initiate(client, checkout_scenario)
    assert response.status_code == 400
    assert (await db.execute(select(tables["Slot"].c.status))).scalar_one() == "AVAILABLE"


async def test_unconfigured_online_provider_does_not_create_a_hold(
    client, db, checkout_scenario, monkeypatch
):
    monkeypatch.setattr(get_settings(), "razorpay_key_secret", "")
    response = await initiate(client, checkout_scenario)
    assert response.status_code == 503
    assert not (await db.execute(select(tables["Checkout"]))).all()
    assert (await db.execute(select(tables["Slot"].c.status))).scalar_one() == "AVAILABLE"


async def test_legacy_order_verification_and_status_use_the_same_canonical_checkout(
    client, checkout_scenario
):
    doctor, patient, _, _, calls = checkout_scenario
    held = await client.post(
        "/api/appointments/hold",
        headers=auth(patient),
        json={"doctorId": doctor["doctorId"], "slotId": "payment-http-slot"},
    )
    body = {
        "doctorId": doctor["doctorId"],
        "slotId": "payment-http-slot",
        "holdToken": held.json()["holdToken"],
    }
    path = f"/api/user/{patient['id']}/payments"
    created = await client.post(f"{path}/createOrder", headers=auth(patient), json=body)
    assert created.status_code == 201
    assert created.json()["order"]["amount"] == 50000
    repeated = await client.post(f"{path}/createOrder", headers=auth(patient), json=body)
    assert repeated.status_code == 200 and len(calls) == 1
    verified = await client.post(
        f"{path}/verifyOrder",
        headers=auth(patient),
        json={"orderId": "order_http", "paymentId": "pay_http", "signature": signature()},
    )
    assert verified.status_code == 200
    status = await client.get(f"{path}/order_http/status", headers=auth(patient))
    assert status.status_code == 200 and status.json()["isConfirmed"] is True


@pytest.mark.parametrize(
    "method,suffix,body",
    [
        ("POST", "createOrder", {"doctorId": "doc", "slotId": "slot", "holdToken": str(uuid4())}),
        ("POST", "verifyOrder", {"orderId": "order", "paymentId": "pay", "signature": "0" * 64}),
        ("GET", "order/status", None),
    ],
)
async def test_legacy_payment_routes_reject_mismatched_user_paths(client, seed_user, method, suffix, body):
    user = await seed_user()
    kwargs = {"headers": auth(user)}
    if body is not None:
        kwargs["json"] = body
    response = await client.request(method, f"/api/user/another-user/payments/{suffix}", **kwargs)
    assert response.status_code == 403


async def test_legacy_create_order_rejects_unowned_hold(client, checkout_scenario):
    doctor, patient, outsider, *_ = checkout_scenario
    held = await client.post(
        "/api/appointments/hold",
        headers=auth(patient),
        json={"doctorId": doctor["doctorId"], "slotId": "payment-http-slot"},
    )
    response = await client.post(
        f"/api/user/{outsider['id']}/payments/createOrder",
        headers=auth(outsider),
        json={
            "doctorId": doctor["doctorId"],
            "slotId": "payment-http-slot",
            "holdToken": held.json()["holdToken"],
        },
    )
    assert response.status_code == 409


async def test_compatibility_online_confirmation_verifies_the_matching_checkout_payment(
    client, db, checkout_scenario
):
    doctor, patient, *_ = checkout_scenario
    checkout = (await initiate(client, checkout_scenario)).json()
    token = (await db.execute(select(tables["Checkout"].c.holdToken))).scalar_one()
    response = await client.post(
        "/api/appointments/confirm",
        headers=auth(patient),
        json={
            "slotId": "payment-http-slot",
            "doctorId": doctor["doctorId"],
            "holdToken": token,
            "paymentMethod": "ONLINE",
            "transactionId": "pay_http",
        },
    )
    assert response.status_code == 201
    assert response.json()["appointment"]["paymentMethod"] == "ONLINE"
    status = await client.get(f"/api/checkout/{checkout['checkoutId']}/status", headers=auth(patient))
    assert status.json()["appointmentId"] == response.json()["appointment"]["id"]


async def test_compatibility_online_confirmation_cannot_use_an_unlinked_transaction(
    client, checkout_scenario
):
    doctor, patient, *_ = checkout_scenario
    response = await client.post(
        "/api/appointments/confirm",
        headers=auth(patient),
        json={
            "slotId": "payment-http-slot",
            "doctorId": doctor["doctorId"],
            "holdToken": str(uuid4()),
            "paymentMethod": "ONLINE",
            "transactionId": "pay_http",
        },
    )
    assert response.status_code == 400
    assert response.json()["error"] == "No matching payment order found for this reservation"


@pytest.mark.parametrize("payment_status", ["REFUND_PENDING", "REFUNDED"])
async def test_verification_rejects_payment_that_has_already_entered_refund_flow(
    client, db, checkout_scenario, payment_status
):
    _, patient, *_ = checkout_scenario
    checkout = (await initiate(client, checkout_scenario)).json()
    await db.execute(update(tables["Payment"]).values(status=payment_status, razorpayPaymentId="pay_http"))
    response = await verify(client, patient, checkout["checkoutId"])
    assert response.status_code == 409
    assert response.json()["refundStatus"] == payment_status
    assert not (await db.execute(select(tables["Appointment"]))).all()


async def test_an_order_cannot_be_rebound_to_a_second_captured_payment(client, db, checkout_scenario):
    _, patient, _, details, _ = checkout_scenario
    checkout = (await initiate(client, checkout_scenario)).json()
    await db.execute(update(tables["Payment"]).values(status="SUCCESS", razorpayPaymentId="pay_original"))
    response = await verify(client, patient, checkout["checkoutId"])
    assert response.status_code == 409
    assert (await db.execute(select(tables["Payment"].c.razorpayPaymentId))).scalar_one() == "pay_original"


async def test_legacy_verification_returns_pending_capture_without_booking(client, db, checkout_scenario):
    _, patient, _, details, _ = checkout_scenario
    await initiate(client, checkout_scenario)
    details.update(status="authorized", captured=False)
    response = await client.post(
        f"/api/user/{patient['id']}/payments/verifyOrder",
        headers=auth(patient),
        json={
            "orderId": "order_http",
            "paymentId": "pay_http",
            "signature": signature(),
        },
    )
    assert response.status_code == 202 and response.json()["status"] == "PENDING_CAPTURE"
    assert not (await db.execute(select(tables["Appointment"]))).all()


@pytest.mark.parametrize("field,value", [("amount", 49999), ("currency", "USD")])
async def test_provider_order_with_wrong_fee_or_currency_never_creates_local_payment(
    client, db, checkout_scenario, monkeypatch, field, value
):
    async def provider(*args, **kwargs):
        order = {"id": "order_wrong", "amount": 50000, "currency": "INR"}
        order[field] = value
        return order

    monkeypatch.setattr(payments, "provider", provider)
    response = await initiate(client, checkout_scenario)
    assert response.status_code == 502
    assert not (await db.execute(select(tables["Payment"]))).all()
    # The already-committed saga intent remains available for recovery.
    assert (await db.execute(select(tables["Checkout"].c.status))).scalar_one() == "PENDING_ORDER"
