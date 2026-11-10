"""Patient and doctor HTTP journey across independently composed features."""

import io
from datetime import timedelta

from PIL import Image
from sqlalchemy import insert, select, func

from app.core.security import issue_token
from app.infrastructure.database import tables, utcnow


async def test_patient_books_uploads_messages_and_cancels_with_access_revocation(client, db, seed_user):
    patient = await seed_user()
    doctor = await seed_user("DOCTOR")
    stranger = await seed_user()
    start = utcnow() + timedelta(days=2)
    await db.execute(
        insert(tables["Slot"]).values(
            id="journey-slot",
            doctorId=doctor["doctorId"],
            date=start.date(),
            startTime=start,
            endTime=start + timedelta(minutes=30),
        )
    )
    client.cookies.set("token", issue_token(patient))
    hold = await client.post(
        "/api/appointments/hold", json={"slotId": "journey-slot", "doctorId": doctor["doctorId"]}
    )
    assert hold.status_code == 201
    confirmation = await client.post(
        "/api/appointments/confirm",
        json={
            "slotId": "journey-slot",
            "doctorId": doctor["doctorId"],
            "holdToken": hold.json()["holdToken"],
            "paymentMethod": "OFFLINE",
        },
    )
    assert confirmation.status_code == 201
    appointment_id = confirmation.json()["appointment"]["id"]
    client.cookies.set("token", issue_token(doctor))
    confirmed = await client.patch(
        f"/api/doctors/{doctor['doctorId']}/appointments/{appointment_id}", json={"status": "CONFIRMED"}
    )
    assert confirmed.status_code == 200
    client.cookies.set("token", issue_token(patient))
    picture = io.BytesIO()
    Image.new("RGB", (16, 16), "white").save(picture, format="PNG")
    upload = await client.post(
        "/api/patients/me/medical-documents",
        files={"file": ("synthetic.png", picture.getvalue(), "image/png")},
        data={"title": "Synthetic journey record", "type": "LAB_REPORT", "reportDate": "2026-01-01"},
    )
    assert upload.status_code == 201
    document = upload.json()["document"]
    assert "storagePath" not in document
    file_path = f"/api/doctors/me/patients/{patient['patientId']}/medical-documents/{document['id']}/file"
    client.cookies.set("token", issue_token(doctor))
    download = await client.get(file_path)
    assert download.status_code == 200
    assert download.content == picture.getvalue()
    client.cookies.set("token", issue_token(stranger))
    assert (await client.get(f"/api/patients/me/medical-documents/{document['id']}/file")).status_code == 404
    client.cookies.set("token", issue_token(patient))
    relation = await client.post(
        "/api/doctorpatientrelations", json={"doctorsUserId": doctor["id"], "patientsUserId": patient["id"]}
    )
    assert relation.status_code in (200, 201)
    relation_id = relation.json()["relation"]["id"]
    chat_path = f"/api/doctorpatientrelations/{relation_id}/chats"
    message = {"text": "Synthetic test message", "clientMessageId": "journey-message"}
    sent = await client.post(chat_path, json=message)
    assert sent.status_code == 201
    assert (await client.post(chat_path, json=message)).status_code == 200
    client.cookies.set("token", issue_token(doctor))
    assert (await client.get(chat_path)).status_code == 200
    client.cookies.set("token", issue_token(patient))
    cancelled = await client.patch(
        f"/api/patients/{patient['patientId']}/appointments/{appointment_id}", json={}
    )
    assert cancelled.status_code == 200
    client.cookies.set("token", issue_token(doctor))
    assert (await client.get(file_path)).status_code == 403
    assert (
        await db.execute(
            select(func.count())
            .select_from(tables["ChatMessages"])
            .where(tables["ChatMessages"].c.clientMessageId == "journey-message")
        )
    ).scalar_one() == 1
    assert (
        await db.execute(select(tables["Slot"].c.status).where(tables["Slot"].c.id == "journey-slot"))
    ).scalar_one() == "AVAILABLE"
    assert (await db.execute(select(func.count()).select_from(tables["Refund"]))).scalar_one() == 0
