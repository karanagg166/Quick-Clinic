"""Human conversation REST contracts use real authorization and persistence."""

from datetime import datetime
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import insert, select

from app.core.security import SOCKET_AUDIENCE, decode_token, issue_token
from app.infrastructure.database import new_id, tables


def auth(user):
    return {"Authorization": f"Bearer {issue_token(user)}"}


async def relation(db, seed_user):
    doctor, patient = await seed_user("DOCTOR"), await seed_user()
    identifier = new_id()
    await db.execute(
        insert(tables["DoctorPatientRelation"]).values(
            id=identifier, doctorsUserId=doctor["id"], patientsUserId=patient["id"]
        )
    )
    return doctor, patient, identifier


async def test_relation_creation_is_idempotent_and_returns_only_requested_users_conversations(
    client, db, seed_user
):
    doctor, patient, outsider = await seed_user("DOCTOR"), await seed_user(), await seed_user()
    body = {"doctorsUserId": doctor["id"], "patientsUserId": patient["id"]}
    first = await client.post("/api/doctorpatientrelations", headers=auth(patient), json=body)
    retry = await client.post("/api/doctorpatientrelations", headers=auth(doctor), json=body)
    assert first.status_code == 201 and retry.status_code == 200
    assert first.json()["relation"]["id"] == retry.json()["relation"]["id"]
    listing = await client.get(
        "/api/doctorpatientrelations",
        headers=auth(patient),
        params={"userId": patient["id"], "role": "PATIENT"},
    )
    assert len(listing.json()["relations"]) == 1
    empty = await client.get(
        "/api/doctorpatientrelations",
        headers=auth(outsider),
        params={"userId": outsider["id"], "role": "PATIENT"},
    )
    assert empty.json()["relations"] == []
    assert len((await db.execute(select(tables["DoctorPatientRelation"]))).all()) == 1


async def test_relation_creation_and_listing_cannot_spoof_another_patient(client, seed_user):
    doctor, patient, stranger = await seed_user("DOCTOR"), await seed_user(), await seed_user()
    result = await client.post(
        "/api/doctorpatientrelations",
        headers=auth(stranger),
        json={"doctorsUserId": doctor["id"], "patientsUserId": patient["id"]},
    )
    assert result.status_code == 403
    result = await client.get(
        "/api/doctorpatientrelations",
        headers=auth(stranger),
        params={"userId": patient["id"], "role": "PATIENT"},
    )
    assert result.status_code == 403


@pytest.mark.parametrize(
    "payload",
    [{}, {"doctorsUserId": 1, "patientsUserId": "id"}, {"doctorsUserId": "id", "patientsUserId": None}],
)
async def test_relation_creation_validates_identifiers(client, seed_user, payload):
    assert (
        await client.post("/api/doctorpatientrelations", headers=auth(await seed_user()), json=payload)
    ).status_code == 400


async def test_relation_creation_requires_existing_doctor_profile(client, seed_user):
    patient = await seed_user()
    result = await client.post(
        "/api/doctorpatientrelations",
        headers=auth(patient),
        json={"doctorsUserId": "missing-doctor", "patientsUserId": patient["id"]},
    )
    assert result.status_code == 404


async def test_rest_send_replay_broadcasts_once_and_ignores_spoofed_sender(
    client, db, seed_user, monkeypatch
):
    doctor, patient, identifier = await relation(db, seed_user)
    from app.infrastructure.realtime import sio

    emit = AsyncMock()
    monkeypatch.setattr(sio, "emit", emit)
    root = f"/api/doctorpatientrelations/{identifier}/chats"
    body = {
        "text": "  Synthetic follow up  ",
        "clientMessageId": "synthetic-client-message",
        "senderId": doctor["id"],
    }
    first = await client.post(root, headers=auth(patient), json=body)
    retry = await client.post(root, headers=auth(patient), json=body)
    assert first.status_code == 201 and retry.status_code == 200
    assert first.json()["chat"]["senderId"] == patient["id"]
    assert first.json()["chat"]["text"] == "Synthetic follow up"
    emit.assert_awaited_once()
    assert emit.await_args.kwargs["room"] == f"relation_{identifier}"
    listed = (await client.get(root, headers=auth(doctor))).json()
    assert listed["chats"][0]["sender"]["id"] == patient["id"]
    assert "password" not in listed["chats"][0]["sender"]
    relations = (
        await client.get(
            "/api/doctorpatientrelations",
            headers=auth(patient),
            params={"userId": patient["id"], "role": "PATIENT"},
        )
    ).json()
    assert relations["relations"][0]["lastMessage"] == "Synthetic follow up"


@pytest.mark.parametrize(
    "payload",
    [
        None,
        [],
        {"text": " "},
        {"text": "x" * 5001},
        {"text": True},
        {"text": "hello", "clientMessageId": 5},
        {"text": "hello", "clientMessageId": "x" * 129},
    ],
)
async def test_rest_message_payload_validation_leaves_no_messages(client, db, seed_user, payload):
    _, patient, identifier = await relation(db, seed_user)
    # content forces a JSON null body for the None case instead of an absent body.
    import json

    result = await client.post(
        f"/api/doctorpatientrelations/{identifier}/chats", headers=auth(patient), content=json.dumps(payload)
    )
    assert result.status_code == 400
    assert not (await db.execute(select(tables["ChatMessages"]))).first()


@pytest.mark.parametrize("query", ["page=0", "page=-1", "limit=0", "limit=101"])
async def test_message_pagination_bounds(client, db, seed_user, query):
    _, patient, identifier = await relation(db, seed_user)
    assert (
        await client.get(f"/api/doctorpatientrelations/{identifier}/chats?{query}", headers=auth(patient))
    ).status_code == 400


async def test_message_pagination_is_deterministic_when_timestamps_tie(client, db, seed_user):
    _, patient, identifier = await relation(db, seed_user)
    await db.execute(
        insert(tables["ChatMessages"]),
        [
            dict(
                id=f"synthetic-{index}",
                doctorPatientRelationId=identifier,
                senderId=patient["id"],
                text=str(index),
                createdAt=datetime(2030, 1, 1),
            )
            for index in range(5)
        ],
    )
    root = f"/api/doctorpatientrelations/{identifier}/chats"
    first = (await client.get(root + "?limit=2", headers=auth(patient))).json()
    second = (await client.get(root + "?limit=2&page=2", headers=auth(patient))).json()
    oldest = (await client.get(root + "?limit=2&order=asc", headers=auth(patient))).json()
    assert [row["text"] for row in first["chats"]] == ["3", "4"]
    assert [row["text"] for row in second["chats"]] == ["1", "2"]
    assert [row["text"] for row in oldest["chats"]] == ["0", "1"]
    assert first["pagination"]["totalPages"] == 3
    assert second["pagination"]["hasNextPage"] and second["pagination"]["hasPreviousPage"]


async def test_stranger_cannot_read_send_or_issue_scoped_ticket(client, db, seed_user):
    _, _, identifier = await relation(db, seed_user)
    stranger = await seed_user()
    root = f"/api/doctorpatientrelations/{identifier}/chats"
    assert (await client.get(root, headers=auth(stranger))).status_code == 403
    assert (await client.post(root, headers=auth(stranger), json={"text": "Synthetic"})).status_code == 403
    assert (
        await client.get("/api/socket/token", headers=auth(stranger), params={"relationId": identifier})
    ).status_code == 403


async def test_socket_ticket_is_scoped_short_lived_and_uncacheable(client, db, seed_user):
    _, patient, identifier = await relation(db, seed_user)
    result = await client.post("/api/socket/token", headers=auth(patient), json={"relationId": identifier})
    assert result.status_code == 200
    assert "no-store" in result.headers["cache-control"]
    claims = decode_token(result.json()["token"], audience=SOCKET_AUDIENCE)
    assert claims["id"] == patient["id"] and claims["relationId"] == identifier
    assert claims["exp"] - claims["iat"] == 600
    assert set(result.json()["user"]) == {"id", "name", "role"}
