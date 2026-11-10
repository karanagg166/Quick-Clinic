"""Database-authoritative reservations and immutable appointment history."""

from datetime import timedelta, timezone
from uuid import uuid4

from fastapi import HTTPException
from fastapi.encoders import jsonable_encoder
from sqlalchemy import and_, insert, or_, select, update
from sqlalchemy.exc import IntegrityError

from app.infrastructure.database import new_id, tables, utcnow

HOLD_TTL = timedelta(minutes=10)
ACTIVE_STATUSES = ("PENDING", "CONFIRMED", "COMPLETED", "NO_SHOW")
TRANSITIONS = {
    "PENDING": {"CONFIRMED", "CANCELLED", "EXPIRED"},
    "CONFIRMED": {"COMPLETED", "CANCELLED", "NO_SHOW", "RESCHEDULED", "EXPIRED"},
    "RESCHEDULED": {"CONFIRMED", "CANCELLED"},
    "COMPLETED": set(),
    "CANCELLED": set(),
    "NO_SHOW": set(),
    "EXPIRED": set(),
}
CLEAR_HOLD = dict(heldByPatientId=None, heldAt=None, holdToken=None, holdExpiresAt=None)


def as_utc_datetime(value):
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value


async def fetch_record(db, table, *conditions, lock=False):
    query = select(table).where(*conditions)
    if lock:
        query = query.with_for_update()
    row = (await db.execute(query)).mappings().first()
    return dict(row) if row else None


async def insert_unique(db, table, values, *conditions):
    """Deduplicate safely without poisoning the surrounding transaction."""
    try:
        async with db.begin_nested():
            await db.execute(insert(table).values(**values))
        return values
    except IntegrityError:
        existing = await fetch_record(db, table, *conditions)
        if existing is None:
            raise
        return existing


async def require_patient_profile(db, user):
    if user["role"] != "PATIENT":
        raise HTTPException(403, "Patient account required")
    table = tables["Patient"]
    patient = await fetch_record(db, table, table.c.userId == user["id"])
    if patient is None:
        raise HTTPException(403, "Patient account required")
    return patient


async def expire_holds(db, slot_id=None):
    slot = tables["Slot"]
    now = utcnow()
    query = update(slot).where(
        slot.c.status == "HELD",
        or_(
            slot.c.holdExpiresAt <= now,
            and_(slot.c.holdExpiresAt.is_(None), slot.c.heldAt <= now - HOLD_TTL),
        ),
    )
    if slot_id:
        query = query.where(slot.c.id == slot_id)
    result = await db.execute(query.values(status="AVAILABLE", updatedAt=now, **CLEAR_HOLD))
    return result.rowcount


async def acquire_hold(db, slot_id, doctor_id, patient_id):
    slot_table, doctor_table, appointment_table = (tables[name] for name in ("Slot", "Doctor", "Appointment"))
    await expire_holds(db, slot_id)
    now = utcnow()
    slot_record = await fetch_record(
        db, slot_table, slot_table.c.id == slot_id, slot_table.c.doctorId == doctor_id, lock=True
    )
    user_table = tables["User"]
    doctor_record = await fetch_record(
        db, doctor_table, doctor_table.c.id == doctor_id, doctor_table.c.isReleaseFixture.is_(False)
    )
    doctor_user = (
        await fetch_record(db, user_table, user_table.c.id == doctor_record["userId"], user_table.c.isActive.is_(True))
        if doctor_record
        else None
    )
    if (
        not doctor_record
        or not doctor_user
        or not slot_record
        or as_utc_datetime(slot_record["startTime"]) <= as_utc_datetime(now)
    ):
        raise HTTPException(409, "This slot is no longer available")
    if await fetch_record(
        db,
        appointment_table,
        appointment_table.c.slotId == slot_id,
        appointment_table.c.status.in_(ACTIVE_STATUSES),
    ):
        raise HTTPException(409, "This slot is already booked")
    token, expires_at = str(uuid4()), now + HOLD_TTL
    result = await db.execute(
        update(slot_table)
        .where(slot_table.c.id == slot_id, slot_table.c.status == "AVAILABLE")
        .values(
            status="HELD",
            heldByPatientId=patient_id,
            heldAt=now,
            holdToken=token,
            holdExpiresAt=expires_at,
            updatedAt=now,
        )
    )
    if result.rowcount != 1:
        raise HTTPException(409, "This slot is no longer available")
    return {"holdToken": token, "expiresAt": expires_at}


async def release_hold(db, slot_id, patient_id, token):
    slot = tables["Slot"]
    await expire_holds(db, slot_id)
    result = await db.execute(
        update(slot)
        .where(
            slot.c.id == slot_id,
            slot.c.status == "HELD",
            slot.c.heldByPatientId == patient_id,
            slot.c.holdToken == token,
        )
        .values(status="AVAILABLE", updatedAt=utcnow(), **CLEAR_HOLD)
    )
    return result.rowcount == 1


async def persist_side_effects(db, appointment, status="CONFIRMED"):
    """Notification, outbox and system-chat writes share the booking transaction."""
    doctor_table, patient_table, user_table = (tables[name] for name in ("Doctor", "Patient", "User"))
    doctor_record = await fetch_record(db, doctor_table, doctor_table.c.id == appointment["doctorId"])
    patient_record = await fetch_record(db, patient_table, patient_table.c.id == appointment["patientId"])
    if not doctor_record or not patient_record:
        return
    doctor_user = await fetch_record(db, user_table, user_table.c.id == doctor_record["userId"])
    patient_user = await fetch_record(db, user_table, user_table.c.id == patient_record["userId"])
    slot = await fetch_record(db, tables["Slot"], tables["Slot"].c.id == appointment["slotId"])
    now = utcnow()
    relation = tables["DoctorPatientRelation"]
    relation_record = await insert_unique(
        db,
        relation,
        dict(
            id=new_id(),
            doctorsUserId=doctor_user["id"],
            patientsUserId=patient_user["id"],
            createdAt=now,
            updatedAt=now,
        ),
        relation.c.doctorsUserId == doctor_user["id"],
        relation.c.patientsUserId == patient_user["id"],
    )
    message_id = f"chat:appt:{appointment['id']}:{status}"
    chat = tables["ChatMessages"]
    await insert_unique(
        db,
        chat,
        dict(
            id=message_id,
            clientMessageId=message_id,
            doctorPatientRelationId=relation_record["id"],
            text=f"Appointment {status.lower()} with Dr. {doctor_user['name']}. "
            f"[View appointment](/patient/appointments/{appointment['id']})",
            senderId=patient_user["id"] if status == "CONFIRMED" else doctor_user["id"],
            createdAt=now,
            updatedAt=now,
        ),
        chat.c.clientMessageId == message_id,
    )
    notification, outbox = tables["Notification"], tables["NotificationOutbox"]
    for role, person in (("doctor", doctor_user), ("patient", patient_user)):
        event_id = f"apt:{appointment['id']}:{status}:{role}"
        notification_record = await insert_unique(
            db,
            notification,
            dict(
                id=new_id(),
                userId=person["id"],
                eventId=event_id,
                message=f"Appointment with {'Dr. ' + doctor_user['name'] if role == 'patient' else patient_user['name']} {status.lower()}.",
                actionHref=f"/{role}/appointments/{appointment['id']}",
                actionLabel="View appointment",
                createdAt=now,
                isRead=False,
                status="UNREAD",
            ),
            notification.c.userId == person["id"],
            notification.c.eventId == event_id,
        )
        payload = {"userId": person["id"], "notification": jsonable_encoder(notification_record)}
        channel = "SOCKET_NOTIFICATION"
        if role == "doctor" and status == "CONFIRMED":
            channel = "SOCKET_APPOINTMENT_REQUEST"
            payload.update(
                doctorUserId=doctor_user["id"],
                appointment=jsonable_encoder(
                    dict(
                        id=appointment["id"],
                        patientName=patient_user["name"],
                        patientString=patient_user["email"],
                        gender=patient_user["gender"],
                        age=patient_user["age"],
                        city="N/A",
                        appointmentDate=slot["date"],
                        appointmentTime=slot["startTime"],
                        status=status,
                        paymentMethod=appointment["paymentMethod"],
                    )
                ),
            )
        elif role == "patient" and status != "CONFIRMED":
            channel = "SOCKET_APPOINTMENT_STATUS"
            payload.update(patientUserId=patient_user["id"], appointmentId=appointment["id"], status=status)
        await insert_unique(
            db,
            outbox,
            dict(
                id=new_id(),
                eventId=event_id,
                channel=channel,
                targetUserId=person["id"],
                payload=payload,
                status="PENDING",
                createdAt=now,
            ),
            outbox.c.eventId == event_id,
        )


async def confirm_hold(db, *, slot_id, doctor_id, patient_id, token, payment_method, payment=None):
    slot_table, appointment_table = tables["Slot"], tables["Appointment"]
    now = utcnow()
    slot_record = await fetch_record(
        db, slot_table, slot_table.c.id == slot_id, slot_table.c.doctorId == doctor_id, lock=True
    )
    if not slot_record:
        return None
    leaves_table = tables["Leave"]
    doctor_on_leave = await fetch_record(
        db,
        leaves_table,
        leaves_table.c.doctorId == doctor_id,
        leaves_table.c.startDate < slot_record["endTime"],
        leaves_table.c.endDate > slot_record["startTime"],
    )
    if doctor_on_leave:
        return None
    existing = await fetch_record(
        db,
        appointment_table,
        appointment_table.c.slotId == slot_id,
        appointment_table.c.status.in_(ACTIVE_STATUSES),
    )
    if existing:
        if payment and existing.get("paymentId") == payment["id"] and existing["patientId"] == patient_id:
            return existing
        return None
    if payment_method == "ONLINE" and (
        not payment or payment["status"] != "SUCCESS" or payment["slotId"] != slot_id
    ):
        return None
    result = await db.execute(
        update(slot_table)
        .where(
            slot_table.c.id == slot_id,
            slot_table.c.doctorId == doctor_id,
            slot_table.c.startTime > now,
            slot_table.c.status == "HELD",
            slot_table.c.heldByPatientId == patient_id,
            slot_table.c.holdToken == token,
            or_(
                slot_table.c.holdExpiresAt > now,
                and_(slot_table.c.holdExpiresAt.is_(None), slot_table.c.heldAt > now - HOLD_TTL),
            ),
        )
        .values(status="BOOKED", updatedAt=now, **CLEAR_HOLD)
    )
    if result.rowcount != 1:
        return None
    result = dict(
        id=new_id(),
        doctorId=doctor_id,
        patientId=patient_id,
        slotId=slot_id,
        paymentId=payment["id"] if payment else None,
        status="CONFIRMED",
        paymentMethod=payment_method,
        transactionId=payment.get("razorpayPaymentId") if payment else None,
        isAppointmentOffline=payment_method == "OFFLINE",
        bookedAt=now,
        updatedAt=now,
    )
    await db.execute(insert(appointment_table).values(**result))
    await persist_side_effects(db, result)
    return result


async def appointment_detail(db, appointment):
    result = dict(appointment)
    for name, key in (("Doctor", "doctor"), ("Patient", "patient")):
        table = tables[name]
        person = await fetch_record(db, table, table.c.id == appointment[f"{key}Id"])
        user = await fetch_record(db, tables["User"], tables["User"].c.id == person["userId"])
        user.pop("password", None)
        location = await fetch_record(db, tables["Location"], tables["Location"].c.pincode == user["pinCode"])
        user.update(
            city=location["city"] if location else "N/A", state=location["state"] if location else "N/A"
        )
        person["user"] = user
        if name == "Doctor":
            qualification_table = tables["DoctorQualification"]
            person["qualifications"] = list(
                (
                    await db.execute(
                        select(qualification_table.c.qualification).where(
                            qualification_table.c.doctorId == person["id"]
                        )
                    )
                ).scalars()
            )
            person.pop("balance", None)
        result[key] = person
    result["slot"] = await fetch_record(db, tables["Slot"], tables["Slot"].c.id == appointment["slotId"])
    result["city"], result["state"] = None, None
    return result
