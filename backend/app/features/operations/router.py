"""Authenticated scheduled recovery and signed, durable provider events."""

import hashlib
import hmac
import json

from fastapi import APIRouter, Depends, HTTPException, Request

from app.core.config import get_settings
from app.infrastructure.database import get_db, new_id, tables, utcnow
from app.features.booking.service import insert_unique
from app.features.payments.gateway import verify_signature
from app.features.operations.service import expire_appointments, reconcile
from app.features.operations.webhooks import process_webhook

router = APIRouter(prefix="/api", tags=["operations"])


def authorize_cron(request):
    settings = get_settings()
    secret = settings.cron_secret or settings.internal_api_secret
    if not secret:
        raise HTTPException(503, "Cron secret is not configured")
    header = request.headers.get("authorization", "")
    provided = header[7:] if header.startswith("Bearer ") else request.headers.get("x-cron-secret", "")
    if not hmac.compare_digest(provided, secret):
        raise HTTPException(401, "Unauthorized")


@router.get("/cron/expire-appointments")
async def expire_past_appointments(request: Request, db=Depends(get_db)):
    authorize_cron(request)
    result = await expire_appointments(db)
    return dict(message=f"Processed {result['expired']} expired appointments", **result)


@router.get("/cron/reconcile-payments")
@router.post("/cron/reconcile-payments")
async def reconcile_payment_state(request: Request, db=Depends(get_db)):
    authorize_cron(request)
    return await reconcile(db)


@router.post("/webhooks/razorpay")
async def receive_razorpay_webhook(request: Request, db=Depends(get_db)):
    # Verification always precedes JSON parsing or database writes.
    raw = await request.body()
    if len(raw) > 1_048_576:
        raise HTTPException(413, "Webhook body too large")
    signature = request.headers.get("x-razorpay-signature", "")
    if not signature:
        raise HTTPException(400, "Missing x-razorpay-signature header")
    settings = get_settings()
    if not verify_signature(raw, signature, settings.razorpay_webhook_secret or settings.razorpay_key_secret):
        raise HTTPException(401, "Invalid webhook signature")
    try:
        payload = json.loads(raw)
    except (json.JSONDecodeError, UnicodeDecodeError):
        raise HTTPException(400, "Invalid JSON payload") from None
    if not isinstance(payload, dict):
        raise HTTPException(400, "Invalid event payload")
    provider_id = (
        request.headers.get("x-razorpay-event-id")
        or payload.get("id")
        or payload.get("event_id")
        or hashlib.sha256(raw).hexdigest()
    )
    if not isinstance(provider_id, str) or len(provider_id) > 256:
        raise HTTPException(400, "Invalid provider event identity")
    event = tables["WebhookEvent"]
    stored = await insert_unique(
        db,
        event,
        dict(
            id=new_id(),
            providerEventId=provider_id,
            eventType=payload.get("event", "unknown"),
            payload=payload,
            status="RECEIVED",
            receivedAt=utcnow(),
        ),
        event.c.providerEventId == provider_id,
    )
    await db.commit()
    if stored["status"] in ("PROCESSED", "IGNORED"):
        return {"received": True, "duplicate": True, "status": stored["status"]}
    return await process_webhook(db, stored)
