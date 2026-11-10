"""Bcrypt compatibility for existing accounts and bounded new passwords."""

import bcrypt
from fastapi import HTTPException


def hash_password(password):
    if not isinstance(password, str) or len(password) < 6 or len(password.encode()) > 72:
        raise HTTPException(400, "Password must be 6 to 72 bytes long")
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt(rounds=10)).decode()


def verify_password(password, stored):
    try:
        return isinstance(password, str) and bcrypt.checkpw(password.encode()[:72], stored.encode())
    except (ValueError, TypeError):
        return False
