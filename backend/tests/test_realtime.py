"""Human chat authorization, idempotency, expiry and socket audience boundaries."""

import pytest
from fastapi import HTTPException
from sqlalchemy import insert, select, update
from app.infrastructure.database import tables, new_id
from app.core.security import issue_token, SOCKET_AUDIENCE
from app.features.messaging.service import persist_message, checked_relation
from app.infrastructure.realtime.sessions import authenticate
from app.infrastructure.realtime.server import encode, _limits
from app.infrastructure.realtime.handlers import check_limit


async def relation(db, seed_user):
    doctor = await seed_user("DOCTOR")
    patient = await seed_user("PATIENT")
    relation_id = new_id()
    await db.execute(
        insert(tables["DoctorPatientRelation"]).values(
            id=relation_id, doctorsUserId=doctor["id"], patientsUserId=patient["id"]
        )
    )
    return doctor, patient, relation_id


async def test_chat_retry_persists_once_and_content_conflict_fails(db, seed_user):
    doctor, patient, relation_id = await relation(db, seed_user)
    payload = {"text": "Clinical follow up", "clientMessageId": "message-123"}
    first, duplicate = await persist_message(db, relation_id, patient, payload)
    assert not duplicate
    second, duplicate = await persist_message(db, relation_id, patient, payload)
    assert duplicate and first["id"] == second["id"]
    with pytest.raises(HTTPException) as exc:
        await persist_message(db, relation_id, patient, {**payload, "text": "Changed"})
    assert exc.value.status_code == 409
    with pytest.raises(HTTPException) as exc:
        await persist_message(db, relation_id, doctor, payload)
    assert exc.value.status_code == 409
    rows = list((await db.execute(select(tables["ChatMessages"]))).mappings())
    assert len(rows) == 1


async def test_chat_stranger_and_cross_relation_idempotency_are_denied(db, seed_user):
    _, patient, relation_id = await relation(db, seed_user)
    stranger = await seed_user()
    with pytest.raises(HTTPException) as exc:
        await checked_relation(db, relation_id, stranger)
    assert exc.value.status_code == 403
    await persist_message(db, relation_id, patient, {"text": "Private", "clientMessageId": "private-message"})
    _, second_patient, second_relation = await relation(db, seed_user)
    with pytest.raises(HTTPException) as exc:
        await persist_message(
            db, second_relation, second_patient, {"text": "Private", "clientMessageId": "private-message"}
        )
    assert exc.value.status_code == 403


async def test_socket_rejects_session_ticket_wrong_scope_and_deactivated_user(db, seed_user):
    doctor, patient, relation_id = await relation(db, seed_user)
    with pytest.raises(HTTPException):
        await authenticate(db, issue_token(patient), relation_id)
    token = issue_token({**patient, "relationId": relation_id}, audience=SOCKET_AUDIENCE, expires_seconds=600)
    session = await authenticate(db, token, relation_id)
    assert session["user"]["id"] == patient["id"]
    with pytest.raises(HTTPException):
        await authenticate(db, token, "different-relation")
    with pytest.raises(HTTPException):
        await authenticate(db, token, relation_id, claimed_id=doctor["id"])
    await db.execute(
        update(tables["User"]).where(tables["User"].c.id == patient["id"]).values(isActive=False)
    )
    with pytest.raises(HTTPException):
        await authenticate(db, token, relation_id)


async def test_chat_validation_rejects_oversize_or_empty_message(db, seed_user):
    _, patient, relation_id = await relation(db, seed_user)
    for payload in ({"text": " "}, {"text": "x" * 5001}, {"text": 7}, {"text": "ok", "clientMessageId": 5}):
        with pytest.raises(HTTPException) as exc:
            await persist_message(db, relation_id, patient, payload)
        assert exc.value.status_code == 400


def test_message_limit_and_utc_serialization():
    from datetime import datetime

    _limits.clear()
    for _ in range(30):
        check_limit("test-socket", "message", 30, 60)
    with pytest.raises(HTTPException) as exc:
        check_limit("test-socket", "message", 30, 60)
    assert exc.value.status_code == 429
    assert encode({"createdAt": datetime(2030, 1, 1)})["createdAt"] == "2030-01-01T00:00:00Z"
    _limits.clear()


async def test_socketio_wire_protocol_persists_and_retries_once(db, seed_user, monkeypatch):
    """A real JS-compatible Socket.IO connection crosses the actual ASGI boundary."""
    import asyncio
    import socket
    import socketio
    import uvicorn
    from fastapi import FastAPI
    from app.infrastructure import realtime
    from app.infrastructure import database

    doctor, patient, relation_id = await relation(db, seed_user)
    await db.commit()
    monkeypatch.setattr(database, "engine", db.engine)
    listener = socket.socket()
    listener.bind(("127.0.0.1", 0))
    port = listener.getsockname()[1]
    server = uvicorn.Server(
        uvicorn.Config(realtime.make_socket_app(FastAPI()), log_level="error", lifespan="off")
    )
    server_task = asyncio.create_task(server.serve(sockets=[listener]))

    async def started():
        while not server.started:
            await asyncio.sleep(0.01)

    await asyncio.wait_for(started(), timeout=5)
    client = socketio.AsyncClient(reconnection=False)
    received = []
    client.on("new_message", lambda data: received.append(data))
    token = issue_token({**patient, "relationId": relation_id}, audience=SOCKET_AUDIENCE, expires_seconds=600)
    try:
        await client.connect(
            f"http://127.0.0.1:{port}",
            auth={"token": token, "relationId": relation_id},
            transports=["websocket"],
        )
        first = await client.call(
            "send_message", {"text": "Wire message", "clientMessageId": "wire-once"}, timeout=5
        )
        replay = await client.call(
            "send_message", {"text": "Wire message", "clientMessageId": "wire-once"}, timeout=5
        )
        assert first["success"] and replay["success"]
        assert first["message"]["id"] == replay["message"]["id"]
        assert len(received) == 1
        initial = await client.call("get_initial_messages", {"limit": 10}, timeout=5)
        assert initial["success"] and len(initial["messages"]) == 1
        assert initial["messages"][0]["createdAt"].endswith("Z")
        await db.execute(
            update(tables["User"]).where(tables["User"].c.id == patient["id"]).values(isActive=False)
        )
        await db.commit()
        revoked = asyncio.Event()

        async def disconnected(reason=None):
            revoked.set()

        client.on("disconnect", disconnected)
        await client.emit("sync_messages", {})
        await asyncio.wait_for(revoked.wait(), timeout=5)
        assert not client.connected
    finally:
        if client.connected:
            await client.disconnect()
        server.should_exit = True
        await asyncio.wait_for(server_task, timeout=5)
        listener.close()
