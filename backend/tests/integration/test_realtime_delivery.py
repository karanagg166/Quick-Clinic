"""Socket notification outbox, revocation and watcher lifecycle contracts."""

import asyncio
import time
from datetime import datetime
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException

from app.infrastructure.realtime import notifications, sessions


@pytest.mark.parametrize(
    "channel,event",
    [
        ("SOCKET_NOTIFICATION", "new_notification"),
        ("SOCKET_APPOINTMENT_REQUEST", "new_appointment_request"),
        ("SOCKET_APPOINTMENT_STATUS", "appointment_status_update"),
    ],
)
async def test_outbox_publishes_only_target_user_room_with_encoded_payload(
    db, seed_user, monkeypatch, channel, event
):
    user = await seed_user()
    await db.commit()
    monkeypatch.setattr(notifications.database, "engine", db.engine)
    emit = AsyncMock()
    monkeypatch.setattr(notifications.sio, "emit", emit)
    payload = {
        "appointmentId": "synthetic-appointment",
        "status": "CONFIRMED",
        "createdAt": datetime(2030, 1, 1),
        "notification": {"id": "synthetic-note"},
        "patientUserId": user["id"],
    }
    await notifications.publish_outbox(channel, user["id"], payload)
    assert emit.await_args_list[0].args[0] == event
    assert all(call.kwargs["room"] == f"user_{user['id']}" for call in emit.await_args_list)
    if channel == "SOCKET_NOTIFICATION":
        assert emit.await_count == 1
    else:
        appointment = emit.await_args_list[0].args[1]["appointment"]
        assert appointment["id"] == "synthetic-appointment" and appointment["createdAt"].endswith("Z")
        assert "patientUserId" not in appointment
        assert emit.await_count == 2 and emit.await_args_list[1].args[0] == "new_notification"


async def test_explicit_appointment_payload_is_preserved_without_duplicate_notification(
    db, seed_user, monkeypatch
):
    user = await seed_user()
    await db.commit()
    monkeypatch.setattr(notifications.database, "engine", db.engine)
    emit = AsyncMock()
    monkeypatch.setattr(notifications.sio, "emit", emit)
    await notifications.publish_outbox(
        "SOCKET_APPOINTMENT_STATUS", user["id"], {"appointment": {"id": "synthetic"}}
    )
    emit.assert_awaited_once_with(
        "appointment_status_update", {"appointment": {"id": "synthetic"}}, room=f"user_{user['id']}"
    )


@pytest.mark.parametrize("existing", [True, False])
async def test_outbox_suppresses_delivery_for_inactive_or_missing_users(db, seed_user, monkeypatch, existing):
    user_id = (await seed_user(isActive=False))["id"] if existing else "missing-user"
    await db.commit()
    monkeypatch.setattr(notifications.database, "engine", db.engine)
    emit = AsyncMock()
    monkeypatch.setattr(notifications.sio, "emit", emit)
    await notifications.publish_outbox("SOCKET_NOTIFICATION", user_id, {"notification": {"id": "synthetic"}})
    emit.assert_not_awaited()


async def test_unknown_outbox_channel_is_rejected(db, seed_user, monkeypatch):
    user = await seed_user()
    await db.commit()
    monkeypatch.setattr(notifications.database, "engine", db.engine)
    with pytest.raises(ValueError, match="Unsupported outbox channel"):
        await notifications.publish_outbox("UNKNOWN", user["id"], {})


@pytest.mark.parametrize("scope", ["user", "relation"])
async def test_explicit_revocation_disconnects_only_matching_sessions(monkeypatch, scope):
    state = {
        "a": {"user": {"id": "target"}, "relationId": "room"},
        "b": {"user": {"id": "other"}, "relationId": "room"},
        "c": {"user": {"id": "target"}, "relationId": "different"},
    }
    monkeypatch.setattr(notifications, "_sessions", state)
    emit, disconnect = AsyncMock(), AsyncMock()
    monkeypatch.setattr(notifications.sio, "emit", emit)
    monkeypatch.setattr(notifications.sio, "disconnect", disconnect)
    if scope == "user":
        await notifications.revoke_user("target")
        assert {call.args[0] for call in disconnect.await_args_list} == {"a", "c"}
        assert emit.await_args.kwargs["room"] == "user_target"
    else:
        await notifications.revoke_relation("room")
        assert {call.args[0] for call in disconnect.await_args_list} == {"a", "b"}
        assert emit.await_args.kwargs["room"] == "relation_room"


async def test_session_watcher_disconnects_expired_tickets_immediately(monkeypatch):
    monkeypatch.setattr(sessions, "_sessions", {"expired": {"exp": time.time() - 1}})
    emit, disconnect = AsyncMock(), AsyncMock()
    monkeypatch.setattr(sessions.sio, "emit", emit)
    monkeypatch.setattr(sessions.sio, "disconnect", disconnect)
    await sessions.watch_session("expired")
    assert emit.await_args.args[0] == "auth_expired"
    disconnect.assert_awaited_once_with("expired")


@pytest.mark.parametrize("outcome", ["revoked", "disconnected", "cancelled", "unexpected", "valid"])
async def test_session_watcher_revalidates_access_and_handles_shutdown(db, monkeypatch, outcome):
    state = {"watched": {"exp": time.time() + 600}}
    monkeypatch.setattr(sessions, "_sessions", state)
    monkeypatch.setattr(sessions.database, "engine", db.engine)
    emit, disconnect = AsyncMock(), AsyncMock()
    monkeypatch.setattr(sessions.sio, "emit", emit)
    monkeypatch.setattr(sessions.sio, "disconnect", disconnect)

    async def sleep(seconds):
        assert 0 < seconds <= 30
        if outcome == "disconnected":
            state.clear()
        if outcome == "cancelled":
            raise asyncio.CancelledError()
        if outcome == "unexpected":
            raise RuntimeError("Synthetic lifecycle failure")

    async def check(sid, connection):
        if outcome == "revoked":
            raise HTTPException(401, "Revoked")
        state.clear()
        return {}

    monkeypatch.setattr(sessions.asyncio, "sleep", sleep)
    monkeypatch.setattr(sessions, "checked_session", check)
    await sessions.watch_session("watched")
    if outcome == "revoked":
        assert emit.await_args.args[0] == "account_revoked"
    if outcome in ("revoked", "unexpected"):
        disconnect.assert_awaited_once_with("watched")
    else:
        disconnect.assert_not_awaited()
