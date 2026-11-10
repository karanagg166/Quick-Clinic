"""Authorized appointment queries and transactional lifecycle changes."""

from collections.abc import Mapping
from datetime import date, datetime

from fastapi import HTTPException
from sqlalchemy import select, update

from app.infrastructure.database import tables, utcnow
from app.features.payments.refunds import enqueue_refund
from .service import CLEAR_HOLD, TRANSITIONS, fetch_record, appointment_detail, persist_side_effects


async def require_profile_owner(db, user, model, owner_id):
    table = tables[model]
    row = await fetch_record(db, table, table.c.id == owner_id)
    if not row:
        raise HTTPException(404, f"{model} not found")
    if user["role"] != "ADMIN" and (user["role"] != model.upper() or row["userId"] != user["id"]):
        raise HTTPException(403, "Forbidden")
    return row


async def list_appointments(db, filters: Mapping[str, str], model, owner_id):
    appointment_table, slot_table, doctor_table, patient_table, user_table, location_table = (
        tables[n] for n in ("Appointment", "Slot", "Doctor", "Patient", "User", "Location")
    )
    doctor_view = model == "Doctor"
    participant_table = patient_table if doctor_view else doctor_table
    query = (
        select(appointment_table)
        .join(slot_table, slot_table.c.id == appointment_table.c.slotId)
        .join(
            participant_table,
            participant_table.c.id
            == (appointment_table.c.patientId if doctor_view else appointment_table.c.doctorId),
        )
        .join(user_table, user_table.c.id == participant_table.c.userId)
        .outerjoin(location_table, location_table.c.pincode == user_table.c.pinCode)
        .where((appointment_table.c.doctorId if doctor_view else appointment_table.c.patientId) == owner_id)
    )
    query_filters = filters
    for key in ("status", "paymentMethod"):
        if query_filters.get(key):
            query = query.where(appointment_table.c[key] == query_filters[key])
    for key, column in (
        ("patientName" if doctor_view else "doctorName", user_table.c.name),
        ("patientEmail", user_table.c.email),
        ("city", location_table.c.city),
    ):
        if query_filters.get(key):
            query = query.where(column.ilike(f"%{query_filters[key]}%"))
    if doctor_view:
        if query_filters.get("gender"):
            query = query.where(user_table.c.gender == query_filters["gender"])
        if query_filters.get("age"):
            try:
                query = query.where(user_table.c.age == int(query_filters["age"]))
            except ValueError:
                raise HTTPException(400, "Invalid age") from None
    else:
        if query_filters.get("specialty"):
            query = query.where(doctor_table.c.specialty == query_filters["specialty"])
        if query_filters.get("fees"):
            try:
                query = query.where(doctor_table.c.fees == int(query_filters["fees"]))
            except ValueError:
                raise HTTPException(400, "Invalid fees") from None
    try:
        if query_filters.get("date"):
            query = query.where(slot_table.c.date == date.fromisoformat(query_filters["date"][:10]))
        if query_filters.get("startDate"):
            query = query.where(
                slot_table.c.startTime
                >= datetime.fromisoformat(
                    f"{query_filters['startDate']}T{query_filters.get('startTime', '00:00:00')}"
                )
            )
        if query_filters.get("endDate"):
            query = query.where(
                slot_table.c.endTime
                <= datetime.fromisoformat(
                    f"{query_filters['endDate']}T{query_filters.get('endTime', '23:59:59')}"
                )
            )
    except ValueError:
        raise HTTPException(400, "Invalid appointment date filter") from None
    rows = (
        await db.execute(
            query.order_by(slot_table.c.startTime.asc() if doctor_view else slot_table.c.startTime.desc())
        )
    ).mappings()
    result = []
    for appointment in rows:
        detail = await appointment_detail(db, appointment)
        participant_profile = detail["patient" if doctor_view else "doctor"]
        participant_user = participant_profile["user"]
        item = dict(
            id=appointment["id"],
            status=appointment["status"],
            appointmentDate=detail["slot"]["date"],
            appointmentTime=detail["slot"]["startTime"],
            city=participant_user["city"],
        )
        if doctor_view:
            item.update(
                patientName=participant_user["name"],
                patientString=participant_user["email"],
                gender=participant_user["gender"],
                age=participant_user["age"],
                paymentMethod=appointment["paymentMethod"],
            )
        else:
            item.update(
                doctorName=participant_user["name"],
                doctorEmail=participant_user["email"],
                state=participant_user["state"],
                fees=participant_profile["fees"],
                specialty=participant_profile["specialty"],
            )
        result.append(item)
    return result


async def get_authorized_appointment(db, user, model, owner_id, appointment_id, *, write=False):
    appointment_table = tables["Appointment"]
    appointment = await fetch_record(
        db,
        appointment_table,
        appointment_table.c.id == appointment_id,
        appointment_table.c[f"{model.lower()}Id"] == owner_id,
        lock=write,
    )
    if not appointment:
        raise HTTPException(404, "Appointment not found")
    detail = await appointment_detail(db, appointment)
    permitted = user["role"] == "ADMIN" or any(
        user["role"] == role.upper() and detail[role]["userId"] == user["id"]
        for role in ("doctor", "patient")
    )
    if not permitted:
        raise HTTPException(403, "Forbidden")
    if write:
        await require_profile_owner(db, user, model, owner_id)
    return appointment, detail


async def change_status(db, appointment, status):
    appointment_table = tables["Appointment"]
    appointment = await fetch_record(
        db,
        appointment_table,
        appointment_table.c.id == appointment["id"],
        lock=True,
    )
    if appointment is None:
        raise HTTPException(404, "Appointment not found")
    current_status = appointment["status"]
    if status == current_status:
        return appointment
    if status not in TRANSITIONS.get(current_status, set()):
        raise HTTPException(400, f"Cannot transition appointment from {current_status} to {status}")
    appointment_table, slot_table, doctor_table, payment_table = (
        tables[n] for n in ("Appointment", "Slot", "Doctor", "Payment")
    )
    now = utcnow()
    await db.execute(
        update(appointment_table)
        .where(appointment_table.c.id == appointment["id"], appointment_table.c.status == current_status)
        .values(status=status, updatedAt=now)
    )
    slot_status = {
        "CANCELLED": "AVAILABLE",
        "EXPIRED": "AVAILABLE",
        "COMPLETED": "UNAVAILABLE",
        "NO_SHOW": "UNAVAILABLE",
        "CONFIRMED": "BOOKED",
    }.get(status)
    if slot_status:
        await db.execute(
            update(slot_table)
            .where(slot_table.c.id == appointment["slotId"])
            .values(status=slot_status, updatedAt=now, **CLEAR_HOLD)
        )
    payment = (
        await fetch_record(db, payment_table, payment_table.c.id == appointment.get("paymentId"), lock=True)
        if appointment.get("paymentId")
        else None
    )
    if not payment and appointment.get("transactionId"):
        payment = await fetch_record(
            db, payment_table, payment_table.c.razorpayPaymentId == appointment["transactionId"], lock=True
        )
    if appointment["paymentMethod"] == "ONLINE" and payment:
        if status == "CANCELLED":
            await enqueue_refund(db, payment, "Appointment cancelled")
        elif status == "COMPLETED" and payment["status"] == "SUCCESS":
            # Credit the immutable captured amount, once, inside the appointment lock.
            await db.execute(
                update(doctor_table)
                .where(doctor_table.c.id == appointment["doctorId"])
                .values(balance=doctor_table.c.balance + payment["amount"], updatedAt=now)
            )
    appointment = dict(appointment, status=status, updatedAt=now)
    await persist_side_effects(db, appointment, status)
    return appointment
