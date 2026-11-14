"""Extended read-only tools for appointments, authorized patients, and medical RAG."""

from typing import Any

from langchain_core.tools import BaseTool, tool
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncConnection

from app.core.clock import resolve_clinic_date
from app.features.ai_agent.persistence.threads import list_thread_messages
from app.features.ai_agent.rag.pipeline import answer_medical_question
from app.features.booking.doctor_agent_queries import (
    get_appointment_details as fetch_appointment_details,
    get_my_appointments as fetch_my_appointments,
)
from app.features.doctors.agent_patient_queries import (
    get_patient_appointment_history as fetch_patient_history,
    get_patient_info as fetch_patient_info,
    list_my_patients as fetch_my_patients,
    list_patient_medical_documents as fetch_patient_documents,
)


class AppointmentsFilterInput(BaseModel):
    status: str | None = Field(default=None, description="Optional status filter (CONFIRMED, PENDING, COMPLETED, CANCELLED).")
    start_day: str | None = Field(default=None, description="Optional start date YYYY-MM-DD or relative date.")
    end_day: str | None = Field(default=None, description="Optional end date YYYY-MM-DD or relative date.")


class AppointmentIdInput(BaseModel):
    appointment_id: str = Field(min_length=1, description="Appointment ID.")


class PatientSearchInput(BaseModel):
    search: str | None = Field(default=None, description="Optional patient name filter.")


class PatientIdInput(BaseModel):
    patient_id: str = Field(min_length=1, description="Authorized patient ID.")


class PatientDocumentsInput(BaseModel):
    patient_id: str = Field(min_length=1, description="Authorized patient ID.")
    doc_type: str = Field(default="", description="Optional document type filter.")
    search: str = Field(default="", description="Optional search text.")


class MedicalQuestionInput(BaseModel):
    patient_id: str = Field(min_length=1, description="Authorized patient ID.")
    question: str = Field(min_length=2, max_length=2000, description="Clinical question about the patient's documents.")


def build_doctor_extended_read_tools(
    db: AsyncConnection,
    actor: dict[str, Any],
    *,
    reference_date=None,
    thread_id: str | None = None,
    turn_id: str | None = None,
) -> list[BaseTool]:
    """Build read-only tools for appointments, authorized patients, RAG, and thread history."""

    @tool("get_my_appointments", args_schema=AppointmentsFilterInput)
    async def get_my_appointments(
        status: str | None = None,
        start_day: str | None = None,
        end_day: str | None = None,
    ) -> dict[str, Any]:
        """List my upcoming or filtered appointments with patient names and timings."""
        s_day = resolve_clinic_date(start_day, reference_date=reference_date) if start_day else None
        e_day = resolve_clinic_date(end_day, reference_date=reference_date) if end_day else None
        return await fetch_my_appointments(db, actor, status=status, start_day=s_day, end_day=e_day)

    @tool("get_appointment_details", args_schema=AppointmentIdInput)
    async def get_appointment_details(appointment_id: str) -> dict[str, Any]:
        """Get full details for a specific appointment owned by me."""
        return await fetch_appointment_details(db, actor, appointment_id)

    @tool("list_my_patients", args_schema=PatientSearchInput)
    async def list_my_patients(search: str | None = None) -> dict[str, Any]:
        """List patients who have an authorized appointment relationship with me."""
        return await fetch_my_patients(db, actor, search=search)

    @tool("get_patient_info", args_schema=PatientIdInput)
    async def get_patient_info(patient_id: str) -> dict[str, Any]:
        """Get authorized patient clinical summary, allergies, and current medications."""
        return await fetch_patient_info(db, actor, patient_id)

    @tool("get_patient_appointment_history", args_schema=PatientIdInput)
    async def get_patient_appointment_history(patient_id: str) -> dict[str, Any]:
        """Get appointment history between me and an authorized patient."""
        return await fetch_patient_history(db, actor, patient_id)

    @tool("list_patient_medical_documents", args_schema=PatientDocumentsInput)
    async def list_patient_medical_documents(
        patient_id: str,
        doc_type: str = "",
        search: str = "",
    ) -> dict[str, Any]:
        """List uploaded medical documents for an authorized patient."""
        return await fetch_patient_documents(db, actor, patient_id, doc_type=doc_type, search=search)

    @tool("query_patient_medical_documents", args_schema=MedicalQuestionInput)
    async def query_patient_medical_documents(patient_id: str, question: str) -> dict[str, Any]:
        """Answer a question grounded in an authorized patient's medical documents with citations."""
        history = await list_thread_messages(db, thread_id=thread_id, limit=10) if thread_id else []
        return await answer_medical_question(
            db,
            actor=actor,
            patient_id=patient_id,
            question=question,
            turn_id=turn_id,
            history_messages=history,
        )

    @tool("get_conversation_history")
    async def get_conversation_history() -> dict[str, Any]:
        """Retrieve past questions and answers in the current conversation thread."""
        if not thread_id:
            return {"type": "CONVERSATION_HISTORY", "messages": []}
        msgs = await list_thread_messages(db, thread_id=thread_id, limit=30)
        return {
            "type": "CONVERSATION_HISTORY",
            "count": len(msgs),
            "messages": [
                {"role": m["role"], "content": m["content"], "createdAt": str(m["createdAt"])}
                for m in msgs
            ],
        }

    return [
        get_my_appointments,
        get_appointment_details,
        list_my_patients,
        get_patient_info,
        get_patient_appointment_history,
        list_patient_medical_documents,
        query_patient_medical_documents,
        get_conversation_history,
    ]
