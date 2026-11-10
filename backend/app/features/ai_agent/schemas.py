"""Pydantic schemas and contracts for future LangGraph AI Agent tools and approvals."""

from datetime import datetime
from enum import Enum
from typing import Any, Optional
from pydantic import BaseModel, Field


class AgentActionType(str, Enum):
    CHECK_AVAILABILITY = "CHECK_AVAILABILITY"
    PROPOSE_APPOINTMENT = "PROPOSE_APPOINTMENT"
    CANCEL_APPOINTMENT = "CANCEL_APPOINTMENT"
    RESCHEDULE_APPOINTMENT = "RESCHEDULE_APPOINTMENT"
    ACCESS_MEDICAL_DOCUMENTS = "ACCESS_MEDICAL_DOCUMENTS"
    SUMMARIZE_VISIT_HISTORY = "SUMMARIZE_VISIT_HISTORY"


class ApprovalStatus(str, Enum):
    PENDING = "PENDING"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"


class AgentToolResult(BaseModel):
    success: bool
    data: Optional[dict[str, Any]] = None
    error: Optional[str] = None
    requires_human_approval: bool = False
    approval_id: Optional[str] = None


class ProposedActionRequest(BaseModel):
    action_type: AgentActionType
    doctor_id: str
    patient_id: str
    parameters: dict[str, Any]
    reason: str
    idempotency_key: str = Field(..., min_length=16, max_length=128)


class HumanApprovalDecision(BaseModel):
    approval_id: str
    decision: ApprovalStatus
    decided_by_user_id: str
    decision_reason: Optional[str] = None
    decided_at: datetime = Field(default_factory=datetime.utcnow)
