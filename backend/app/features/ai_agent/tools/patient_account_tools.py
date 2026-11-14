"""Read-only patient account, doctor discovery, appointment, payment, and messaging tools."""

import json
from datetime import date, datetime
from typing import Any

from langchain_core.tools import BaseTool, tool
from sqlalchemy.ext.asyncio import AsyncConnection

from app.features.accounts import notifications as notifications_svc
from app.features.accounts import service as accounts_svc
from app.features.ai_agent.persistence.threads import list_thread_messages
from app.features.booking import appointments as appointments_svc
from app.features.booking import service as booking_svc
from app.features.doctors import discovery as discovery_svc
from app.features.doctors import profiles as doctor_profiles_svc
from app.features.doctors import reviews as reviews_svc
from app.features.messaging import service as messaging_svc
from app.features.patients import service as patients_svc
from app.features.payments import queries as payment_queries_svc
from app.features.scheduling import availability as availability_svc
from app.features.scheduling import service as scheduling_svc
from app.infrastructure.database import tables


def build_patient_account_tools(
    *,
    db: AsyncConnection,
    actor: dict[str, Any],
    reference_date: date,
    thread_id: str | None = None,
) -> list[BaseTool]:
    """Build read-only patient account, discovery, booking, payment, and messaging tools."""

    async def _patient_id() -> str:
        pat = await booking_svc.require_patient_profile(db, actor)
        return str(pat["id"])

    @tool
    async def get_my_profile() -> str:
        """Get your own Quick-Clinic account profile."""
        res = await accounts_svc.get_profile(actor["id"], actor, db)
        return json.dumps(res, default=str)

    @tool
    async def get_my_medical_profile() -> str:
        """Get your own medical history, allergies, and current medications."""
        pid = await _patient_id()
        res = await patients_svc.get_patient_profile(pid, actor, db)
        return json.dumps(res, default=str)

    @tool
    async def get_my_health_summary() -> str:
        """Get your patient appointment and health summary statistics."""
        pid = await _patient_id()
        res = await patients_svc.get_patient_stats(pid, actor, db)
        return json.dumps(res, default=str)

    @tool
    async def get_my_notifications() -> str:
        """List your own account notifications."""
        res = await notifications_svc.list_notifications(actor["id"], actor, db)
        return json.dumps(res, default=str)

    @tool
    async def search_doctors(
        specialty: str = "",
        city: str = "",
        max_fees: int | None = None,
        min_experience: int | None = None,
        name: str = "",
    ) -> str:
        """Search verified doctors by specialty, city, fees, experience, or name."""
        filters: dict[str, str] = {}
        if specialty:
            filters["specialty"] = specialty
        if city:
            filters["city"] = city
        if max_fees is not None:
            filters["maxFees"] = str(max_fees)
        if min_experience is not None:
            filters["minExperience"] = str(min_experience)
        if name:
            filters["search"] = name
        res = await discovery_svc.search_doctors(filters, db)
        return json.dumps(res, default=str)

    @tool
    async def get_doctor_details(doctor_id: str) -> str:
        """Get detailed profile, clinic address, and fees for a specific doctor."""
        res = await doctor_profiles_svc.get_doctor_profile(doctor_id, actor, db)
        return json.dumps(res, default=str)

    @tool
    async def get_doctor_available_slots(doctor_id: str, date_str: str = "") -> str:
        """Get available consultation slots for a doctor on a given date (YYYY-MM-DD, defaults to today)."""
        target = date.fromisoformat(date_str) if date_str else reference_date
        slots = await availability_svc.daily_slots(db, doctor_id, target, generate=True)
        available = [s for s in slots if s.get("status") == "AVAILABLE"]
        return json.dumps({"doctorId": doctor_id, "date": target.isoformat(), "slots": available}, default=str)

    @tool
    async def get_doctor_schedule(doctor_id: str) -> str:
        """Get a doctor's weekly consultation schedule."""
        res = await scheduling_svc.get_schedule(doctor_id, db)
        return json.dumps(res, default=str)

    @tool
    async def get_doctor_ratings(doctor_id: str) -> str:
        """Get a doctor's rating summary and recent patient reviews."""
        summary = await reviews_svc.rating_summary(doctor_id, db)
        comments = await reviews_svc.list_comments(doctor_id, db)
        return json.dumps({"summary": summary, "comments": comments}, default=str)

    @tool
    async def get_my_appointments(status: str = "", limit: int = 20) -> str:
        """List your own appointments, optionally filtered by status."""
        pid = await _patient_id()
        filters: dict[str, str] = {"limit": str(max(1, min(limit, 50)))}
        if status:
            filters["status"] = status.upper()
        res = await appointments_svc.list_appointments(db, filters, tables["Patient"], pid)
        return json.dumps(res, default=str)

    @tool
    async def get_appointment_details(appointment_id: str) -> str:
        """Get full details for one of your own appointments."""
        pid = await _patient_id()
        appt = await appointments_svc.get_authorized_appointment(
            db, actor, tables["Patient"], pid, appointment_id
        )
        detail = await booking_svc.appointment_detail(db, appt)
        return json.dumps({"appointment": detail}, default=str)

    @tool
    async def get_upcoming_appointments(limit: int = 10) -> str:
        """List your upcoming confirmed or pending appointments."""
        pid = await _patient_id()
        res = await appointments_svc.list_appointments(
            db, {"timeframe": "upcoming", "limit": str(max(1, min(limit, 30)))}, tables["Patient"], pid
        )
        return json.dumps(res, default=str)

    @tool
    async def get_past_appointments(limit: int = 10) -> str:
        """List your past appointments."""
        pid = await _patient_id()
        res = await appointments_svc.list_appointments(
            db, {"timeframe": "past", "limit": str(max(1, min(limit, 30)))}, tables["Patient"], pid
        )
        return json.dumps(res, default=str)

    @tool
    async def get_my_checkout_status(checkout_id: str) -> str:
        """Check read-only status of one of your booking checkouts."""
        res = await payment_queries_svc.authoritative_status(
            db, user_id=actor["id"], checkout_id=checkout_id
        )
        return json.dumps(res, default=str)

    @tool
    async def get_my_payment_status(order_id: str) -> str:
        """Check read-only status of one of your payment orders."""
        res = await payment_queries_svc.authoritative_status(
            db, user_id=actor["id"], order_id=order_id
        )
        return json.dumps(res, default=str)

    @tool
    async def list_my_doctor_conversations() -> str:
        """List your authorized doctor-patient messaging conversations."""
        res = await messaging_svc.list_relations(actor["id"], "PATIENT", actor, db)
        return json.dumps(res, default=str)

    @tool
    async def get_my_messages(relation_id: str, limit: int = 25) -> str:
        """Read messages in one of your authorized doctor-patient conversations."""
        res = await messaging_svc.list_messages(
            relation_id, 1, max(1, min(limit, 50)), "desc", actor, db
        )
        return json.dumps(res, default=str)

    @tool
    async def get_conversation_history(limit: int = 20) -> str:
        """Read recent messages in this AI assistant conversation thread."""
        if not thread_id:
            return json.dumps({"messages": []})
        msgs = await list_thread_messages(db, thread_id=thread_id, limit=max(1, min(limit, 40)))
        return json.dumps(
            {
                "messages": [
                    {
                        "id": m["id"],
                        "role": m["role"],
                        "content": m["content"],
                        "createdAt": m["createdAt"].isoformat()
                        if isinstance(m["createdAt"], datetime)
                        else str(m["createdAt"]),
                    }
                    for m in msgs
                ]
            }
        )

    return [
        get_my_profile,
        get_my_medical_profile,
        get_my_health_summary,
        get_my_notifications,
        search_doctors,
        get_doctor_details,
        get_doctor_available_slots,
        get_doctor_schedule,
        get_doctor_ratings,
        get_my_appointments,
        get_appointment_details,
        get_upcoming_appointments,
        get_past_appointments,
        get_my_checkout_status,
        get_my_payment_status,
        list_my_doctor_conversations,
        get_my_messages,
        get_conversation_history,
    ]
