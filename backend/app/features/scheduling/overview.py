"""Private schedule summaries and contiguous daily timeline blocks."""

import calendar
from datetime import date, timedelta, timezone
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncConnection
from app.infrastructure.database import tables, utcnow
from app.features.doctors.repository import owned_doctor
from .availability import daily_slots
from .validation import CLINIC_ZONE, aware, parse_date

(doctors_table, slots_table, schedules_table, leaves_table, appointments_table) = (
    tables[name] for name in ("Doctor", "Slot", "Schedule", "Leave", "Appointment")
)


def day_metrics(items):
    counts = {
        name: sum((item["status"] == name for item in items))
        for name in ("AVAILABLE", "BOOKED", "HELD", "UNAVAILABLE", "CANCELLED", "ON_LEAVE")
    }
    busy = counts["BOOKED"] + counts["HELD"]
    return {
        "totalSlots": len(items),
        "availableCount": counts["AVAILABLE"],
        "bookedCount": counts["BOOKED"],
        "heldCount": counts["HELD"],
        "unavailableCount": counts["UNAVAILABLE"] + counts["CANCELLED"],
        "onLeaveCount": counts["ON_LEAVE"],
        "totalWorkingMinutes": len(items) * 10,
        "freeMinutes": counts["AVAILABLE"] * 10,
        "busyMinutes": busy * 10,
        "occupancyPercentage": round(busy / len(items) * 100) if items else 0,
        "nextAppointmentTime": next(
            (
                item["startTime"]
                for item in items
                if item["status"] == "BOOKED" and item["startTime"] >= utcnow()
            ),
            None,
        ),
    }


def timeline_blocks(items):
    groups = []
    category = {"AVAILABLE": "FREE", "HELD": "BUSY", "BOOKED": "BUSY", "ON_LEAVE": "ON_LEAVE"}
    for item in items:
        kind = category.get(item["status"], "BLOCKED")
        if (
            groups
            and groups[-1][0] == kind
            and (abs((item["startTime"] - groups[-1][1][-1]["endTime"]).total_seconds()) <= 60)
        ):
            groups[-1][1].append(item)
        else:
            groups.append((kind, [item]))
    result = []
    for kind, group in groups:
        (start, end) = (group[0]["startTime"], group[-1]["endTime"])
        (start_local, end_local) = (
            value.replace(tzinfo=timezone.utc).astimezone(CLINIC_ZONE) for value in (start, end)
        )
        titles = {
            "FREE": f"Available ({len(group)} open slots)",
            "BUSY": f"Busy ({len(group)} Appointments)",
            "ON_LEAVE": "On Leave",
            "BLOCKED": "Break / Unavailable",
        }
        result.append(
            {
                "type": kind,
                "startTime": start,
                "endTime": end,
                "startMinutes": start_local.hour * 60 + start_local.minute,
                "endMinutes": end_local.hour * 60 + end_local.minute,
                "durationMinutes": int((end - start).total_seconds() / 60),
                "slotCount": len(group),
                "bookedCount": len(group) if kind == "BUSY" else 0,
                "title": titles[kind],
                "description": titles[kind],
                "status": group[0]["status"],
                "slots": group,
            }
        )
    return result


async def get_schedule_overview(doctor_id: str, filters, user, db: AsyncConnection):
    await owned_doctor(db, doctor_id, user)
    q = filters
    view = q.get("view", "day")
    if view == "day":
        day = parse_date(q.get("date", utcnow().date().isoformat()))
        (items, _) = await daily_slots(db, doctor_id, day)
        for item in items:
            appt = (
                (
                    await db.execute(
                        select(appointments_table)
                        .where(
                            appointments_table.c.slotId == item["id"],
                            appointments_table.c.status.in_(["PENDING", "CONFIRMED", "COMPLETED", "NO_SHOW"]),
                        )
                        .limit(1)
                    )
                )
                .mappings()
                .first()
            )
            item["appointment"] = None
            if appt:
                (patient, users) = (tables["Patient"], tables["User"])
                person = (
                    (
                        await db.execute(
                            select(users.c.name, users.c.email, users.c.phoneNo)
                            .join(patient, patient.c.userId == users.c.id)
                            .where(patient.c.id == appt["patientId"])
                        )
                    )
                    .mappings()
                    .first()
                )
                item["appointment"] = {
                    "id": appt["id"],
                    "status": appt["status"],
                    "patient": dict(person) if person else None,
                }
        return {
            "view": view,
            "date": day.isoformat(),
            "slots": items,
            "timelineBlocks": timeline_blocks(items),
            "metrics": day_metrics(items),
        }
    if view == "week":
        start = parse_date(q.get("startDate", utcnow().date().isoformat()))
        days = []
        for i in range(7):
            day = start + timedelta(days=i)
            (items, _) = await daily_slots(db, doctor_id, day, generate=False)
            metrics = day_metrics(items)
            days.append(
                {
                    "date": day.isoformat(),
                    "dayName": day.strftime("%A"),
                    "metrics": metrics,
                    "timelineBlocks": timeline_blocks(items),
                    "slotsCount": len(items),
                    "bookedCount": metrics["bookedCount"] + metrics["heldCount"],
                    "availableCount": metrics["availableCount"],
                }
            )
        total = sum((item["slotsCount"] for item in days))
        booked = sum((item["bookedCount"] for item in days))
        return {
            "view": view,
            "startDate": start.isoformat(),
            "days": days,
            "weekMetrics": {
                "totalSlots": total,
                "totalBooked": booked,
                "totalAvailable": sum((item["availableCount"] for item in days)),
                "occupancyRate": round(booked / total * 100) if total else 0,
            },
        }
    if view == "month":
        try:
            (year, month) = (int(q.get("year", utcnow().year)), int(q.get("month", utcnow().month)))
            first = date(year, month, 1)
            days_in_month = calendar.monthrange(year, month)[1]
        except (ValueError, TypeError):
            raise HTTPException(400, "Invalid month/year")
        list_leaves = (
            (await db.execute(select(leaves_table).where(leaves_table.c.doctorId == doctor_id)))
            .mappings()
            .all()
        )
        days = []
        for i in range(days_in_month):
            day = first + timedelta(days=i)
            (items, _) = await daily_slots(db, doctor_id, day, generate=False)
            metrics = day_metrics(items)
            on_leave = any(
                (
                    aware(leave["startDate"]).date() <= day <= aware(leave["endDate"]).date()
                    for leave in list_leaves
                )
            )
            busy = metrics["bookedCount"] + metrics["heldCount"]
            days.append(
                {
                    "date": day.isoformat(),
                    "dayNumber": i + 1,
                    "dayName": day.strftime("%A"),
                    "dayOfWeek": (day.weekday() + 1) % 7,
                    "totalSlots": len(items),
                    "bookedCount": busy,
                    "availableCount": metrics["availableCount"],
                    "unavailableCount": metrics["unavailableCount"],
                    "isLeave": on_leave,
                    "statusSummary": "ON_LEAVE" if on_leave else "BOOKED" if busy else "FREE_WHOLE_DAY",
                    "occupancyRate": metrics["occupancyPercentage"],
                }
            )
        return {
            "view": view,
            "year": year,
            "month": month,
            "daysInMonth": days_in_month,
            "firstDayOffset": (first.weekday() + 1) % 7,
            "days": days,
        }
    raise HTTPException(400, "Invalid view parameter (expected 'day', 'week', or 'month')")
