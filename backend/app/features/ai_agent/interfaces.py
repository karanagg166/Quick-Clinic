"""Reusable domain-service interfaces and tool contracts for the LangGraph AI Agent.

These interfaces wrap underlying core domain services (scheduling, booking, documents)
so that future agent tools execute through existing business logic and security policies,
preserving all validation, row locks, active account checks, and audit logging.
"""

from datetime import date
from typing import Any
from sqlalchemy.ext.asyncio import AsyncConnection

from app.features.scheduling import service as scheduling_service
from app.features.booking import service as booking_service
from app.features.documents import service as documents_service
from .security import assert_agent_authorization, audit_agent_action


class DoctorSchedulingToolInterface:
    """Read-only availability and schedule inspection for agent tools."""

    @staticmethod
    async def get_available_slots(
        db: AsyncConnection,
        doctor_id: str,
        query_date: date,
        actor: dict[str, Any],
    ) -> list[dict[str, Any]]:
        assert_agent_authorization("CHECK_AVAILABILITY", actor, target_doctor_id=doctor_id)
        # Use read-only projected slots to avoid mutating database state on agent queries
        slots, _ = await scheduling_service.daily_slots(db, doctor_id, query_date, generate=False)
        available = [s for s in slots if s.get("status") == "AVAILABLE"]
        await audit_agent_action(
            db,
            actor["id"],
            "CHECK_AVAILABILITY",
            {"doctorId": doctor_id, "date": query_date.isoformat(), "count": len(available)},
        )
        return available

    @staticmethod
    async def get_doctor_schedule(
        db: AsyncConnection,
        doctor_id: str,
        actor: dict[str, Any],
    ) -> dict[str, Any]:
        assert_agent_authorization("GET_DOCTOR_INFO", actor, target_doctor_id=doctor_id)
        return await scheduling_service.get_schedule(doctor_id, db)


class AppointmentActionToolInterface:
    """Safe appointment workflows with idempotency and human approval safeguards."""

    @staticmethod
    async def reserve_slot(
        db: AsyncConnection,
        slot_id: str,
        doctor_id: str,
        patient_id: str,
        actor: dict[str, Any],
    ) -> dict[str, Any]:
        """Reserve a temporary hold on a slot via the canonical booking engine."""
        assert_agent_authorization("PROPOSE_APPOINTMENT", actor, target_patient_id=patient_id, target_doctor_id=doctor_id)
        hold_result = await booking_service.acquire_hold(db, slot_id, doctor_id, patient_id)
        await audit_agent_action(
            db,
            actor["id"],
            "ACQUIRE_HOLD",
            {"slotId": slot_id, "doctorId": doctor_id, "patientId": patient_id},
        )
        return hold_result

    @staticmethod
    async def cancel_appointment_with_reason(
        db: AsyncConnection,
        appointment_id: str,
        reason: str,
        actor: dict[str, Any],
    ) -> dict[str, Any]:
        """Execute appointment cancellation through canonical booking service with automatic refund."""
        assert_agent_authorization("CANCEL_APPOINTMENT", actor)
        from app.features.booking.cancellation import cancel_appointment
        result = await cancel_appointment(db, appointment_id, actor, reason)
        await audit_agent_action(
            db,
            actor["id"],
            "CANCEL_APPOINTMENT",
            {"appointmentId": appointment_id, "reason": reason},
        )
        return result


class ClinicalDocumentsToolInterface:
    """Guarded medical records access requiring established patient-doctor relationship."""

    @staticmethod
    async def list_patient_documents(
        db: AsyncConnection,
        patient_id: str,
        actor: dict[str, Any],
    ) -> list[dict[str, Any]]:
        """List documents only if the actor is the owner or an authorized doctor."""
        assert_agent_authorization("ACCESS_MEDICAL_DOCUMENTS", actor, target_patient_id=patient_id)
        if actor["role"] == "DOCTOR":
            await documents_service.require_doctor_record_access(db, actor, patient_id)
        from app.features.documents.service import document_metadata
        from app.infrastructure.database import tables

        docs_table = tables["MedicalDocument"]
        query = docs_table.select().where(docs_table.c.patientId == patient_id)
        rows = (await db.execute(query.order_by(docs_table.c.createdAt.desc()))).mappings().all()

        await audit_agent_action(
            db,
            actor["id"],
            "ACCESS_MEDICAL_DOCUMENTS",
            {"patientId": patient_id, "count": len(rows)},
        )
        return [document_metadata(r) for r in rows]
