"""Audience-bound session authentication shared by HTTP and Socket.IO."""

from datetime import timedelta
from urllib.parse import unquote

import jwt
from fastapi import Depends, HTTPException, Request
from sqlalchemy import select

from app.infrastructure.database import get_db, tables, utcnow
from app.core.config import get_settings

SESSION_AUDIENCE = "quick-clinic-session"
SOCKET_AUDIENCE = "quick-clinic-socket"
ROLES = {"PATIENT", "DOCTOR", "ADMIN"}


def secret_key():
    secret = get_settings().jwt_secret
    if not secret:
        raise RuntimeError("JWT_SECRET is required")
    return secret


def issue_token(user, audience=SESSION_AUDIENCE, expires_seconds=604800):
    now = utcnow()
    claims = {
        key: user[key]
        for key in ("id", "userId", "role", "email", "name", "relationId")
        if user.get(key) is not None
    }
    claims.update(aud=audience, iat=now, exp=now + timedelta(seconds=expires_seconds))
    return jwt.encode(claims, secret_key(), algorithm="HS256")


def decode_token(token, audience=SESSION_AUDIENCE):
    try:
        claims = jwt.decode(
            token, secret_key(), algorithms=["HS256"], options={"verify_aud": False, "require": ["exp"]}
        )
        aud = claims.get("aud")
        if aud != audience and not (aud is None and audience == SESSION_AUDIENCE):
            raise ValueError("Invalid token audience")
        user_id = claims.get("id", claims.get("userId"))
        if not isinstance(user_id, str) or not user_id.strip():
            raise ValueError("Invalid identity")
        if claims.get("id") and claims.get("userId") and claims["id"] != claims["userId"]:
            raise ValueError("Conflicting identity")
        role = claims.get("role")
        if not isinstance(role, str) or role.upper() not in ROLES:
            raise ValueError("Invalid role")
        return {**claims, "id": user_id, "role": role.upper()}
    except (jwt.PyJWTError, ValueError, TypeError) as exc:
        raise HTTPException(401, "Unauthorized") from exc


async def current_user(request: Request, db=Depends(get_db)):
    token = request.cookies.get("token")
    if token:
        token = unquote(token)
    else:
        header = request.headers.get("authorization", "")
        token = header[7:].strip() if header.startswith("Bearer ") else None
    if not token:
        raise HTTPException(401, "Unauthorized")
    claims = decode_token(token)
    users = tables["User"]
    row = (await db.execute(select(users).where(users.c.id == claims["id"]))).mappings().first()
    if not row or not row["isActive"] or row["role"] != claims["role"]:
        raise HTTPException(401, "Unauthorized")
    return dict(row)


def require_roles(*roles):
    async def dependency(user=Depends(current_user)):
        if user["role"] not in roles:
            raise HTTPException(403, "Forbidden")
        return user

    return dependency


def ensure_owner(user, user_id, *, allow_admin=True):
    if user["id"] != user_id and not (allow_admin and user["role"] == "ADMIN"):
        raise HTTPException(403, "Forbidden")
