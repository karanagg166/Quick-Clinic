
"""Human approval handling for Quick-Clinic AI agents."""

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Awaitable, Callable

from langgraph.types import interrupt


class ApprovalError(Exception):
    """Raised when an action lacks valid human approval."""


@dataclass(frozen=True)
class ApprovalRequest:
    approval_id: str
    action: str
    summary: str
    payload_hash: str
    expires_at: datetime


ApprovalVerifier = Callable[
    [ApprovalRequest],
    Awaitable[bool],
]


class ApprovalManager:
    """Pause LangGraph until a sensitive action is approved."""

    @staticmethod
    async def require_approval(
        request: ApprovalRequest,
        verify: ApprovalVerifier,
    ) -> None:

        if not request.approval_id or not request.payload_hash:
            raise ApprovalError("Invalid approval request")

        if request.expires_at <= datetime.now(timezone.utc):
            raise ApprovalError("Approval request has expired")

        # LangGraph saves state and pauses execution.
        # Use a stable approval_id across graph resumes.
        interrupt({
            "type": "human_approval_required",
            "approval_id": request.approval_id,
            "action": request.action,
            "summary": request.summary,
            "expires_at": request.expires_at.isoformat(),
        })

        # Resuming the graph does not itself grant approval.
        # The verifier must check the authenticated approver,
        # approved action/payload, expiry and durable DB record.
        if request.expires_at <= datetime.now(timezone.utc):
            raise ApprovalError("Approval request has expired")

        if not await verify(request):
            raise ApprovalError(
                "Action was not approved by an authorized user"
            )
