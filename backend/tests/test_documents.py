"""Real HTTP document workflows against isolated storage and database."""

import io
from datetime import timedelta
import pytest
from PIL import Image
from pypdf import PdfWriter
from sqlalchemy import insert, select
from app.infrastructure.database import tables, utcnow
from app.core.security import issue_token


def headers(user):
    return {"Authorization": f"Bearer {issue_token(user)}"}


def pdf():
    stream = io.BytesIO()
    writer = PdfWriter()
    writer.add_blank_page(width=72, height=72)
    writer.write(stream)
    return stream.getvalue()


async def upload(client, user, **kwargs):
    return await client.post(
        "/api/patients/me/medical-documents",
        headers={**headers(user), **kwargs.pop("headers", {})},
        data={
            "title": "Lab report",
            "type": "LAB_REPORT",
            "reportDate": "2026-11-10",
            **kwargs.pop("data", {}),
        },
        files={"file": kwargs.pop("file", ("report.pdf", pdf(), "application/pdf"))},
        **kwargs,
    )


async def test_document_lifecycle_is_private_and_patient_owned(client, db, seed_user):
    owner = await seed_user()
    stranger = await seed_user()
    created = await upload(client, owner)
    assert created.status_code == 201, created.text
    document = created.json()["document"]
    assert "storagePath" not in document
    doc_id = document["id"]
    listing = await client.get("/api/patients/me/medical-documents", headers=headers(owner))
    assert [item["id"] for item in listing.json()["documents"]] == [doc_id]
    for method, suffix in [("GET", ""), ("GET", "/access"), ("GET", "/file"), ("DELETE", "")]:
        result = await client.request(
            method, f"/api/patients/me/medical-documents/{doc_id}{suffix}", headers=headers(stranger)
        )
        assert result.status_code == 404
    access = await client.get(f"/api/patients/me/medical-documents/{doc_id}/access", headers=headers(owner))
    file = await client.get(access.json()["url"], headers=headers(owner))
    assert file.status_code == 200 and file.content == pdf()
    assert "no-store" in file.headers["cache-control"]
    assert (await client.get(access.json()["url"])).status_code == 401
    rename = await client.patch(
        f"/api/patients/me/medical-documents/{doc_id}",
        headers=headers(owner),
        json={"title": "Follow-up report"},
    )
    assert rename.json()["document"]["title"] == "Follow-up report"
    assert (
        await client.delete(f"/api/patients/me/medical-documents/{doc_id}", headers=headers(owner))
    ).status_code == 200
    assert (await client.get(access.json()["url"], headers=headers(owner))).status_code == 404


async def test_upload_validates_actual_bytes_and_idempotency(client, db, seed_user):
    patient = await seed_user()
    for file in [
        ("evil.pdf", b"MZ executable", "application/pdf"),
        ("bad.pdf", b"%PDF-1.4\n corrupt", "application/pdf"),
        ("wrong.png", pdf(), "image/png"),
        ("empty.pdf", b"", "application/pdf"),
    ]:
        response = await upload(client, patient, file=file)
        assert response.status_code == 400, response.text
    key = {"Idempotency-Key": "upload-retry-123"}
    first = await upload(client, patient, headers=key)
    replay = await upload(client, patient, headers=key)
    assert first.status_code == 201 and replay.status_code == 200
    assert first.json()["document"]["id"] == replay.json()["document"]["id"]
    conflict = await upload(client, patient, headers=key, data={"title": "Changed"})
    assert conflict.status_code == 409
    rows = (await db.execute(select(tables["MedicalDocument"]))).all()
    assert len(rows) == 1


async def test_images_are_validated_and_filename_is_sanitized(client, seed_user):
    patient = await seed_user()
    image = io.BytesIO()
    Image.new("RGB", (2, 2)).save(image, format="PNG")
    response = await upload(client, patient, file=("../../private/scan.png", image.getvalue(), "image/png"))
    assert response.status_code == 201
    assert response.json()["document"]["fileName"] == "scan.png"


async def test_doctor_document_access_requires_eligible_appointment(client, db, seed_user):
    patient = await seed_user()
    doctor = await seed_user("DOCTOR")
    outsider = await seed_user("DOCTOR")
    response = await upload(client, patient)
    doc_id = response.json()["document"]["id"]
    path = f"/api/doctors/me/patients/{patient['patientId']}/medical-documents"
    await db.execute(
        insert(tables["DoctorPatientRelation"]).values(
            doctorsUserId=doctor["id"], patientsUserId=patient["id"]
        )
    )
    assert (await client.get(path, headers=headers(doctor))).status_code == 403
    start = utcnow() + timedelta(days=1)
    slot_id = (
        await db.execute(
            insert(tables["Slot"])
            .values(
                doctorId=doctor["doctorId"],
                date=start.date(),
                startTime=start,
                endTime=start + timedelta(minutes=30),
            )
            .returning(tables["Slot"].c.id)
        )
    ).scalar_one()
    await db.execute(
        insert(tables["Appointment"]).values(
            doctorId=doctor["doctorId"], patientId=patient["patientId"], slotId=slot_id, status="CONFIRMED"
        )
    )
    result = await client.get(path, headers=headers(doctor))
    assert result.status_code == 200
    assert result.json()["documents"][0]["id"] == doc_id
    assert "storagePath" not in result.json()["documents"][0]
    access = await client.get(f"{path}/{doc_id}/access", headers=headers(doctor))
    assert (await client.get(access.json()["url"], headers=headers(doctor))).status_code == 200
    assert (await client.get(access.json()["url"], headers=headers(outsider))).status_code == 403


async def test_legacy_file_metadata_is_preserved_without_upstream_calls(client, db, seed_user):
    patient = await seed_user()
    table = tables["MedicalDocument"]
    identifier = (
        await db.execute(
            insert(table)
            .values(
                patientId=patient["patientId"],
                title="Historical record",
                type="OTHER",
                fileName="old.pdf",
                mimeType="application/pdf",
                fileSize=100,
                storagePath="retired-bucket/old.pdf",
                reportDate=utcnow(),
            )
            .returning(table.c.id)
        )
    ).scalar_one()
    result = await client.get(
        f"/api/patients/me/medical-documents/{identifier}/access", headers=headers(patient)
    )
    assert result.status_code == 409 and result.json()["code"] == "LEGACY_DOCUMENT_REQUIRES_IMPORT"
    result = await client.delete(f"/api/patients/me/medical-documents/{identifier}", headers=headers(patient))
    assert result.status_code == 409
    assert (await db.execute(select(table).where(table.c.id == identifier))).first()


@pytest.mark.parametrize("role", ["DOCTOR", "ADMIN"])
async def test_non_patients_cannot_upload(client, seed_user, role):
    response = await upload(client, await seed_user(role))
    assert response.status_code == 403


async def test_patient_document_count_quota_is_enforced(client, db, seed_user):
    patient = await seed_user()
    await db.execute(
        insert(tables["MedicalDocument"]),
        [
            dict(
                patientId=patient["patientId"],
                title=f"Record {number}",
                type="OTHER",
                fileName="record.pdf",
                mimeType="application/pdf",
                fileSize=1,
                storagePath=f"local/quota/{number}",
                reportDate=utcnow(),
            )
            for number in range(100)
        ],
    )
    result = await upload(client, patient)
    assert result.status_code == 403
    assert "quota" in result.json()["error"].lower()
