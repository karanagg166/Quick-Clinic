"""Audience-bound identities, room scope, revocation and connection lifecycle."""

import asyncio
import functools
import time
from urllib.parse import parse_qs
import socketio
from fastapi import HTTPException
from sqlalchemy import select
from app.infrastructure import database
from app.infrastructure.database import tables
from app.core.security import decode_token, SOCKET_AUDIENCE
from app.features.messaging.service import checked_relation
from .server import sio, logger, _sessions, _tasks, _limits


async def authenticate(db, token, relation_id=None, claimed_id=None):
    claims = decode_token(token, audience=SOCKET_AUDIENCE)
    if claimed_id is not None and claimed_id != claims["id"]:
        raise HTTPException(401, "Conflicting identity claims")
    if claims.get("relationId") and claims["relationId"] != relation_id:
        raise HTTPException(403, "Unauthorized relation scope")
    users = tables["User"]
    row = (await db.execute(select(users).where(users.c.id == claims["id"]))).mappings().first()
    if not row or not row["isActive"] or row["role"] != claims["role"]:
        raise HTTPException(401, "Account inactive or identity changed")
    user = {key: row[key] for key in ("id", "name", "role", "email")}
    if relation_id:
        await checked_relation(db, relation_id, user)
    return {"user": user, "relationId": relation_id, "token": token, "exp": claims["exp"]}


async def checked_session(sid, db, chat=False):
    session = _sessions.get(sid)
    if not session:
        raise HTTPException(401, "Unauthorized")
    refreshed = await authenticate(db, session["token"], session.get("relationId"))
    if chat and not refreshed.get("relationId"):
        raise HTTPException(403, "Unauthorized: not connected to a chat room")
    return refreshed


async def watch_session(sid):
    try:
        while sid in _sessions:
            session = _sessions[sid]
            remaining = session["exp"] - time.time()
            if remaining <= 0:
                await sio.emit("auth_expired", {"message": "Authentication ticket expired"}, to=sid)
                await sio.disconnect(sid)
                return
            await asyncio.sleep(min(30, remaining))
            if sid not in _sessions:
                return
            try:
                async with database.engine.connect() as db:
                    await checked_session(sid, db)
            except HTTPException:
                await sio.emit(
                    "account_revoked", {"reason": "Account or conversation access revoked"}, to=sid
                )
                await sio.disconnect(sid)
                return
    except asyncio.CancelledError:
        return
    except Exception:
        logger.exception("Socket access validation failed")
        await sio.disconnect(sid)


@sio.event
async def connect(sid, environ, auth):
    auth = auth if isinstance(auth, dict) else {}
    query = parse_qs(environ.get("QUERY_STRING", ""))
    header = environ.get("HTTP_AUTHORIZATION", "")
    token = (
        auth.get("token")
        or (header[7:] if header.startswith("Bearer ") else None)
        or query.get("token", [None])[0]
    )
    relation_id = auth.get("relationId") or query.get("relationId", [None])[0]
    if not isinstance(token, str) or (relation_id is not None and not isinstance(relation_id, str)):
        raise socketio.exceptions.ConnectionRefusedError("Missing token or invalid relation")
    try:
        async with database.engine.connect() as db:
            session = await authenticate(db, token, relation_id, auth.get("userId"))
    except HTTPException as exc:
        raise socketio.exceptions.ConnectionRefusedError(exc.detail) from exc
    _sessions[sid] = session
    await sio.save_session(sid, session)
    user = session["user"]
    await sio.enter_room(sid, f"user_{user['id']}")
    if relation_id:
        await sio.enter_room(sid, f"relation_{relation_id}")
    event = "connected" if relation_id else "notification_connected"
    await sio.emit(
        event,
        {
            "message": "Connected successfully",
            "userId": user["id"],
            "userName": user["name"],
            "userRole": user["role"],
        },
        to=sid,
    )
    _tasks[sid] = asyncio.create_task(watch_session(sid))


@sio.event
async def disconnect(sid, reason=None):
    session = _sessions.pop(sid, None)
    task = _tasks.pop(sid, None)
    if task and task != asyncio.current_task():
        task.cancel()
    for key in list(_limits):
        if key[0] == sid:
            _limits.pop(key, None)
    if session and session.get("relationId"):
        await sio.emit(
            "user_stop_typing",
            {"userId": session["user"]["id"]},
            room=f"relation_{session['relationId']}",
            skip_sid=sid,
        )


def checked_event(chat=True):
    def decorator(handler):
        @functools.wraps(handler)
        async def wrapper(sid, data=None):
            try:
                async with database.engine.begin() as db:
                    session = await checked_session(sid, db, chat=chat)
                    return await handler(sid, data or {}, db, session)
            except HTTPException as exc:
                await sio.emit("error", {"message": exc.detail}, to=sid)
                if exc.status_code == 401:
                    await sio.disconnect(sid)
                return {"success": False, "error": exc.detail}
            except (ValueError, TypeError, KeyError):
                return {"success": False, "error": "Invalid payload"}
            except Exception:
                logger.exception("Socket event failed")
                await sio.emit("error", {"message": "Unable to process event"}, to=sid)
                return {"success": False, "error": "Unable to process event"}

        return wrapper

    return decorator


@sio.event
async def reauthenticate(sid, data):
    try:
        old = _sessions.get(sid)
        if not old or not isinstance(data, dict) or not isinstance(data.get("token"), str):
            raise HTTPException(401, "Unauthorized")
        async with database.engine.connect() as db:
            new = await authenticate(db, data["token"], old.get("relationId"), old["user"]["id"])
        _sessions[sid] = new
        await sio.save_session(sid, new)
        result = {"success": True, "userId": new["user"]["id"], "expiresAt": new["exp"]}
        await sio.emit("reauthenticated", result, to=sid)
        return result
    except HTTPException as exc:
        return {"success": False, "error": exc.detail}
