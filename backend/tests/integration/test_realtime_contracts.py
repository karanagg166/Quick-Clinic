"""Canonical socket handlers integrated with real isolated DB and auth services.

Only the Socket.IO network emitter is mocked here; the existing websocket smoke
test covers transport framing. These tests focus on persistence and room scope.
"""

from datetime import datetime, timedelta
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException
from sqlalchemy import delete, insert, select, update

from app.core.security import SOCKET_AUDIENCE, issue_token
from app.features.messaging.service import persist_message
from app.infrastructure.database import new_id, tables
from app.infrastructure.realtime import handlers, sessions


async def setup_chat(db, seed_user):
    doctor, patient = await seed_user("DOCTOR"), await seed_user()
    identifier = new_id()
    await db.execute(
        insert(tables["DoctorPatientRelation"]).values(
            id=identifier, doctorsUserId=doctor["id"], patientsUserId=patient["id"]
        )
    )
    return doctor, patient, identifier


def ticket(user, relation=None, expires=600):
    return issue_token({**user, "relationId": relation}, audience=SOCKET_AUDIENCE, expires_seconds=expires)


async def test_read_receipts_scope_conversation_ignore_self_and_never_regress_cursor(
    db, seed_user, monkeypatch
):
    doctor, patient, relation = await setup_chat(db, seed_user)
    _, _, foreign = await setup_chat(db, seed_user)
    base = datetime(2030, 1, 1)
    await db.execute(
        insert(tables["ChatMessages"]),
        [
            dict(
                id=identifier,
                doctorPatientRelationId=room,
                senderId=sender,
                text="Synthetic",
                createdAt=base + timedelta(minutes=offset),
            )
            for identifier, room, sender, offset in [
                ("incoming-old", relation, doctor["id"], 0),
                ("incoming-new", relation, doctor["id"], 1),
                ("outgoing", relation, patient["id"], 2),
                ("foreign", foreign, doctor["id"], 0),
            ]
        ],
    )
    emit = AsyncMock()
    monkeypatch.setattr(handlers.sio, "emit", emit)
    session = {"user": patient, "relationId": relation}
    read = handlers.mark_as_read.__wrapped__
    assert (await read("sid", {"messageId": "foreign"}, db, session))["success"] is False
    assert (await read("sid", {"messageId": "outgoing"}, db, session))["success"] is False
    assert (await read("sid", {"messageId": "incoming-new"}, db, session))["success"] is True
    assert (await read("sid", {"messageId": "incoming-old"}, db, session))["success"] is True
    rows = {row["id"]: row for row in (await db.execute(select(tables["ChatMessages"]))).mappings()}
    assert rows["incoming-new"]["isRead"] and rows["incoming-old"]["isRead"]
    assert not rows["outgoing"]["isRead"] and not rows["foreign"]["isRead"]
    cursor = (
        await db.execute(
            select(tables["DoctorPatientRelation"].c.patientLastReadAt).where(
                tables["DoctorPatientRelation"].c.id == relation
            )
        )
    ).scalar_one()
    assert cursor == base + timedelta(minutes=1)
    assert {call.kwargs["room"] for call in emit.await_args_list} == {
        f"relation_{relation}",
        f"user_{patient['id']}",
    }


async def test_read_receipt_rejects_missing_cursor_and_supports_timestamp_cursor(db, seed_user, monkeypatch):
    doctor, patient, relation = await setup_chat(db, seed_user)
    message, _ = await persist_message(
        db, relation, doctor, {"text": "Synthetic", "clientMessageId": "cursor-message"}
    )
    monkeypatch.setattr(handlers.sio, "emit", AsyncMock())
    session = {"user": patient, "relationId": relation}
    with pytest.raises(HTTPException) as error:
        await handlers.mark_as_read.__wrapped__("sid", {}, db, session)
    assert error.value.status_code == 400
    result = await handlers.mark_as_read.__wrapped__(
        "sid", {"lastReadAt": message["createdAt"].isoformat()}, db, session
    )
    assert result["success"] is True


async def test_sync_cursor_includes_later_ids_at_equal_timestamp_and_excludes_other_rooms(
    db, seed_user, monkeypatch
):
    doctor, patient, relation = await setup_chat(db, seed_user)
    _, _, other = await setup_chat(db, seed_user)
    created = datetime(2030, 1, 1)
    await db.execute(
        insert(tables["ChatMessages"]),
        [
            dict(
                id=identifier,
                doctorPatientRelationId=room,
                senderId=doctor["id"],
                text="Synthetic",
                createdAt=created,
            )
            for identifier, room in [("a", relation), ("b", relation), ("c", relation), ("z", other)]
        ],
    )
    monkeypatch.setattr(handlers.sio, "emit", AsyncMock())
    result = await handlers.sync_messages.__wrapped__(
        "sid",
        {"since": created.isoformat() + "Z", "lastMessageId": "a", "limit": 1},
        db,
        {"user": patient, "relationId": relation},
    )
    assert [row["id"] for row in result["messages"]] == ["b"]
    assert result["hasMore"] is True and result["messages"][0]["createdAt"].endswith("Z")


async def test_socket_message_replay_broadcasts_canonical_message_once(db, seed_user, monkeypatch):
    _, patient, relation = await setup_chat(db, seed_user)
    monkeypatch.setattr(handlers, "check_limit", lambda *args: None)
    emit = AsyncMock()
    monkeypatch.setattr(handlers.sio, "emit", emit)
    handler = handlers.send_message.__wrapped__
    session = {"user": patient, "relationId": relation}
    payload = {"message": "Synthetic message alias", "idempotencyKey": "socket-retry-message"}
    first = await handler("sid", payload, db, session)
    retry = await handler("sid", payload, db, session)
    assert first == retry and first["success"] is True
    emit.assert_awaited_once()
    assert len((await db.execute(select(tables["ChatMessages"]))).all()) == 1


async def test_socket_typing_identity_and_room_come_only_from_session(db, seed_user, monkeypatch):
    _, patient, relation = await setup_chat(db, seed_user)
    emit = AsyncMock()
    monkeypatch.setattr(handlers.sio, "emit", emit)
    monkeypatch.setattr(handlers, "check_limit", lambda *args: None)
    await handlers.user_typing.__wrapped__(
        "sid", {"userId": "spoof", "relationId": "foreign"}, db, {"user": patient, "relationId": relation}
    )
    assert emit.await_args.args[1]["userId"] == patient["id"]
    assert emit.await_args.kwargs == {"room": f"relation_{relation}", "skip_sid": "sid"}


@pytest.mark.parametrize("change", ["inactive", "role", "relation_deleted"])
async def test_established_socket_session_rechecks_revocation_on_every_event(
    db, seed_user, monkeypatch, change
):
    _, patient, relation = await setup_chat(db, seed_user)
    session = await sessions.authenticate(db, ticket(patient, relation), relation)
    monkeypatch.setitem(sessions._sessions, "revoked-sid", session)
    if change == "inactive":
        await db.execute(
            update(tables["User"]).where(tables["User"].c.id == patient["id"]).values(isActive=False)
        )
    elif change == "role":
        await db.execute(
            update(tables["User"]).where(tables["User"].c.id == patient["id"]).values(role="DOCTOR")
        )
    else:
        await db.execute(
            delete(tables["DoctorPatientRelation"]).where(tables["DoctorPatientRelation"].c.id == relation)
        )
    with pytest.raises(HTTPException) as error:
        await sessions.checked_session("revoked-sid", db, chat=True)
    assert error.value.status_code == (404 if change == "relation_deleted" else 401)


async def test_notification_only_session_cannot_access_chat_handlers(db, seed_user, monkeypatch):
    patient = await seed_user()
    session = await sessions.authenticate(db, ticket(patient))
    monkeypatch.setitem(sessions._sessions, "notification-sid", session)
    with pytest.raises(HTTPException) as error:
        await sessions.checked_session("notification-sid", db, chat=True)
    assert error.value.status_code == 403


async def test_expired_ticket_is_rejected_even_when_signature_is_valid(db, seed_user):
    patient = await seed_user()
    with pytest.raises(HTTPException) as error:
        await sessions.authenticate(db, ticket(patient, expires=-1))
    assert error.value.status_code == 401


async def test_reauthentication_refreshes_ticket_but_cannot_switch_user_or_room(db, seed_user, monkeypatch):
    _, patient, relation = await setup_chat(db, seed_user)
    _, other, other_relation = await setup_chat(db, seed_user)
    session = await sessions.authenticate(db, ticket(patient, relation, expires=300), relation)
    monkeypatch.setitem(sessions._sessions, "refresh-sid", session)
    monkeypatch.setattr(sessions.database, "engine", db.engine)
    monkeypatch.setattr(sessions.sio, "save_session", AsyncMock())
    monkeypatch.setattr(sessions.sio, "emit", AsyncMock())
    await db.commit()
    new_ticket = ticket(patient, relation)
    result = await sessions.reauthenticate("refresh-sid", {"token": new_ticket})
    assert result["success"] is True
    assert sessions._sessions["refresh-sid"]["token"] == new_ticket
    for invalid in [ticket(other, other_relation), ticket(patient, other_relation), issue_token(patient)]:
        result = await sessions.reauthenticate("refresh-sid", {"token": invalid})
        assert result["success"] is False
        assert sessions._sessions["refresh-sid"]["token"] == new_ticket


@pytest.mark.parametrize("payload", [None, [], {}, {"token": 4}])
async def test_reauthentication_invalid_payload_is_rejected(payload):
    result = await sessions.reauthenticate("nonexistent-sid", payload)
    assert result["success"] is False
