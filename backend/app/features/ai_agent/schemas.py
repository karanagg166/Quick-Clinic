
"""Pydantic contracts for Quick-Clinic AI tools and approvals."""

from datetime import datetime, timedelta
from enum import Enum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

from app.core.clock import now_utc


# Short duration for initial HITL testing.
APPROVAL_TTL_SECONDS = 60


class AgentActionType(str, Enum):
    # Existing actions
    CHECK_AVAILABILITY = "CHECK_AVAILABILITY"
    PROPOSE_APPOINTMENT = "PROPOSE_APPOINTMENT"
    CANCEL_APPOINTMENT = "CANCEL_APPOINTMENT"
    RESCHEDULE_APPOINTMENT = "RESCHEDULE_APPOINTMENT"
    ACCESS_MEDICAL_DOCUMENTS = "ACCESS_MEDICAL_DOCUMENTS"
    SUMMARIZE_VISIT_HISTORY = "SUMMARIZE_VISIT_HISTORY"

    # Doctor scheduling
    APPLY_LEAVE = "APPLY_LEAVE"
    UPDATE_LEAVE = "UPDATE_LEAVE"
    CANCEL_LEAVE = "CANCEL_LEAVE"
    UPDATE_SCHEDULE = "UPDATE_SCHEDULE"
    CREATE_SLOT = "CREATE_SLOT"
    UPDATE_SLOT = "UPDATE_SLOT"
    REMOVE_SLOT = "REMOVE_SLOT"

    # Doctor appointments
    UPDATE_APPOINTMENT = "UPDATE_APPOINTMENT"

    # Other doctor actions
    UPDATE_DOCTOR_PROFILE = "UPDATE_DOCTOR_PROFILE"
    SEND_PATIENT_MESSAGE = "SEND_PATIENT_MESSAGE"


class ActionRiskLevel(str, Enum):
    LOW_AUTONOMOUS = "LOW_AUTONOMOUS"
    MEDIUM_HUMAN_APPROVAL = "MEDIUM_HUMAN_APPROVAL"
    HIGH_CLINICAL_RESTRICTED = "HIGH_CLINICAL_RESTRICTED"


class ApprovalStatus(str, Enum):
    PENDING = "PENDING"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"
    EXPIRED = "EXPIRED"


class ExecutionStatus(str, Enum):
    NOT_STARTED = "NOT_STARTED"
    EXECUTING = "EXECUTING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"


class ApprovalDecision(str, Enum):
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"


def approval_expiry() -> datetime:
    """Generate a server-authoritative UTC expiry."""

    return now_utc() + timedelta(
        seconds=APPROVAL_TTL_SECONDS
    )


class AgentToolResult(BaseModel):
    success: bool
    data: dict[str, Any] | None = None
    error: str | None = None

    requires_human_approval: bool = False
    approval_id: str | None = None


class ProposedActionRequest(BaseModel):
    """Validated proposal, not authorization to execute."""

    model_config = ConfigDict(extra="forbid")

    action_type: AgentActionType
    parameters: dict[str, Any]

    reason: str = Field(
        min_length=1,
        max_length=500,
    )

    idempotency_key: str = Field(
        min_length=16,
        max_length=128,
    )


class AgentApprovalRecord(BaseModel):
    """Internal contract for a future database record."""

    model_config = ConfigDict(extra="forbid")

    id: str
    thread_id: str
    tool_call_id: str

    requested_by_user_id: str
    approved_by_user_id: str | None = None

    action_type: AgentActionType
    risk_level: ActionRiskLevel

    parameters: dict[str, Any]

    payload_hash: str = Field(
        pattern=r"^[0-9a-f]{64}$"
    )

    idempotency_key: str

    status: ApprovalStatus = ApprovalStatus.PENDING

    execution_status: ExecutionStatus = (
        ExecutionStatus.NOT_STARTED
    )

    created_at: datetime = Field(
        default_factory=now_utc
    )

    expires_at: datetime = Field(
        default_factory=approval_expiry
    )

    decided_at: datetime | None = None
    executed_at: datetime | None = None
    completed_at: datetime | None = None

    decision_reason: str | None = None

    execution_result: dict[str, Any] | None = None

    def is_expired(self) -> bool:
        """Check expiry using the server clock."""

        return now_utc() >= self.expires_at


class HumanApprovalDecision(BaseModel):
    """Approval decision received from the frontend.

    The authenticated approver is resolved server-side.
    Never accept user identity from the request body.
    """

    model_config = ConfigDict(extra="forbid")

    thread_id: str = Field(min_length=1)
    approval_id: str = Field(min_length=1)

    decision: ApprovalDecision

    decision_reason: str | None = Field(
        default=None,
        max_length=300,
    )

    idempotency_key: str = Field(
        min_length=16,
        max_length=128,
    )


class AgentApprovalResponse(BaseModel):
    """Public approval contract for the existing frontend."""

    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
    )

    approval_id: str

    action_type: AgentActionType
    risk_level: ActionRiskLevel
    status: ApprovalStatus

    title: str
    summary: str
    reason: str

    doctor_id: str | None = None
    patient_id: str | None = None

    parameters: dict[str, Any]

    idempotency_key: str
    expires_at: datetime

    decided_at: datetime | None = None
    decision_reason: str | None = None
    decided_by_user_id: str | None = None
