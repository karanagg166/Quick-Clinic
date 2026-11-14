"""HITL-gated mutating tool schemas for the Quick-Clinic Patient AI Agent."""

from langchain_core.tools import BaseTool, tool
from pydantic import BaseModel, Field

PATIENT_MUTATING_TOOL_ACTION_MAP: dict[str, str] = {
    "update_my_profile": "UPDATE_PATIENT_ACCOUNT",
    "update_my_medical_profile": "UPDATE_MEDICAL_PROFILE",
    "cancel_my_appointment": "CANCEL_PATIENT_APPOINTMENT",
    "propose_appointment_booking": "PROPOSE_BOOKING",
    "rename_my_document": "RENAME_DOCUMENT",
    "delete_my_document": "DELETE_DOCUMENT",
    "send_doctor_message": "SEND_DOCTOR_MESSAGE",
    "mark_notification_read": "MARK_NOTIFICATION_READ",
    "submit_doctor_feedback": "SUBMIT_DOCTOR_FEEDBACK",
}


class UpdateProfileInput(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    phoneNo: str | None = Field(default=None, min_length=7, max_length=20)
    address: str | None = Field(default=None, min_length=1, max_length=250)


class UpdateMedicalProfileInput(BaseModel):
    medicalHistory: str | None = Field(default=None, max_length=2000)
    allergies: str | None = Field(default=None, max_length=1000)
    currentMedications: str | None = Field(default=None, max_length=1000)


class CancelAppointmentInput(BaseModel):
    appointment_id: str = Field(min_length=1, max_length=128)
    reason: str | None = Field(default=None, max_length=300)


class ProposeBookingInput(BaseModel):
    doctor_id: str = Field(min_length=1, max_length=128)
    slot_id: str = Field(min_length=1, max_length=128)
    reason: str | None = Field(default=None, max_length=300)


class RenameDocumentInput(BaseModel):
    document_id: str = Field(min_length=1, max_length=128)
    title: str = Field(min_length=1, max_length=120)


class DeleteDocumentInput(BaseModel):
    document_id: str = Field(min_length=1, max_length=128)
    reason: str | None = Field(default=None, max_length=300)


class SendDoctorMessageInput(BaseModel):
    relation_id: str = Field(min_length=1, max_length=128)
    content: str = Field(min_length=1, max_length=2000)


class MarkNotificationReadInput(BaseModel):
    notification_id: str = Field(min_length=1, max_length=128)


class SubmitDoctorFeedbackInput(BaseModel):
    doctor_id: str = Field(min_length=1, max_length=128)
    rating: int | None = Field(default=None, ge=1, le=5)
    comment: str | None = Field(default=None, min_length=1, max_length=1000)


def _blocked_direct_call(tool_name: str) -> str:
    return f"{tool_name} requires confirmed human approval before execution."


def build_patient_mutation_tools() -> list[BaseTool]:
    """Return HITL-gated patient mutating tools."""

    @tool(args_schema=UpdateProfileInput)
    async def update_my_profile(
        name: str | None = None,
        phoneNo: str | None = None,
        address: str | None = None,
    ) -> str:
        """Update your own account profile fields (name, phoneNo, address). Requires approval."""
        return _blocked_direct_call("update_my_profile")

    @tool(args_schema=UpdateMedicalProfileInput)
    async def update_my_medical_profile(
        medicalHistory: str | None = None,
        allergies: str | None = None,
        currentMedications: str | None = None,
    ) -> str:
        """Update your medical history, allergies, or current medications. Requires approval."""
        return _blocked_direct_call("update_my_medical_profile")

    @tool(args_schema=CancelAppointmentInput)
    async def cancel_my_appointment(appointment_id: str, reason: str | None = None) -> str:
        """Cancel one of your eligible appointments. Requires approval."""
        return _blocked_direct_call("cancel_my_appointment")

    @tool(args_schema=ProposeBookingInput)
    async def propose_appointment_booking(
        doctor_id: str, slot_id: str, reason: str | None = None
    ) -> str:
        """Hold an available doctor slot and prepare checkout handoff for payment/confirmation. Requires approval."""
        return _blocked_direct_call("propose_appointment_booking")

    @tool(args_schema=RenameDocumentInput)
    async def rename_my_document(document_id: str, title: str) -> str:
        """Rename one of your own uploaded medical documents. Requires approval."""
        return _blocked_direct_call("rename_my_document")

    @tool(args_schema=DeleteDocumentInput)
    async def delete_my_document(document_id: str, reason: str | None = None) -> str:
        """Permanently delete one of your own medical documents. Requires approval."""
        return _blocked_direct_call("delete_my_document")

    @tool(args_schema=SendDoctorMessageInput)
    async def send_doctor_message(relation_id: str, content: str) -> str:
        """Send a message in an authorized doctor-patient conversation. Requires approval."""
        return _blocked_direct_call("send_doctor_message")

    @tool(args_schema=MarkNotificationReadInput)
    async def mark_notification_read(notification_id: str) -> str:
        """Mark one of your notifications as read. Requires approval."""
        return _blocked_direct_call("mark_notification_read")

    @tool(args_schema=SubmitDoctorFeedbackInput)
    async def submit_doctor_feedback(
        doctor_id: str, rating: int | None = None, comment: str | None = None
    ) -> str:
        """Submit a rating (1-5) and/or review comment for an eligible doctor. Requires approval."""
        return _blocked_direct_call("submit_doctor_feedback")

    return [
        update_my_profile,
        update_my_medical_profile,
        cancel_my_appointment,
        propose_appointment_booking,
        rename_my_document,
        delete_my_document,
        send_doctor_message,
        mark_notification_read,
        submit_doctor_feedback,
    ]
