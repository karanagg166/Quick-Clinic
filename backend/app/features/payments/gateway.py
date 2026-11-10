"""Signed Razorpay requests and bounded provider I/O."""

import hashlib
import hmac

import httpx
from fastapi import HTTPException

from app.core.config import get_settings


def verify_signature(message: bytes, signature: str, secret: str) -> bool:
    if not secret or not isinstance(signature, str) or len(signature) != 64:
        return False
    expected = hmac.new(secret.encode(), message, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature.lower())


async def provider(method, path, *, payload=None, headers=None, params=None):
    settings = get_settings()
    if not settings.razorpay_key_id or not settings.razorpay_key_secret:
        raise HTTPException(503, "Payment provider is not configured")
    async with httpx.AsyncClient(
        timeout=15.0, auth=(settings.razorpay_key_id, settings.razorpay_key_secret)
    ) as client:
        response = await client.request(
            method, f"https://api.razorpay.com/v1/{path}", json=payload, headers=headers, params=params
        )
        response.raise_for_status()
        return response.json()
