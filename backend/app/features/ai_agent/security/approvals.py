
"""Human approval security for Quick-Clinic AI agents."""

import re

from dataclasses import dataclass
from datetime import datetime
from typing import Awaitable, Callable

from langgraph.types import interrupt

from app.core.clock import now_utc


class ApprovalError(Exception):
    """Base error for invalid approval operations."""


class ApprovalExpired(ApprovalError):
    """The approval request has expired."""


class ApprovalRejected(ApprovalError):
    """The approval was rejected by the user."""


class ApprovalNotAuthorized(ApprovalError):
    """The approval was not verified by the backend."""


@dataclass(frozen=True, slots=True)
class ApprovalRequest:
    """Immutable reference to a proposed backend action."""

    approval_id: str
    action: str
    summary: str
    payload_hash: str
    expires_at: datetime


# This callback must use the authenticated request context
# and check the authoritative database approval record.
ApprovalVerifier = Callable[
    [ApprovalRequest],
    Awaitable[bool],
]


class ApprovalManager:
    """Pause and verify sensitive LangGraph operations."""

    @staticmethod
    def validate_request(
        request: ApprovalRequest,
    ) -> None:
        """Validate the approval reference and expiration."""

        if not isinstance(request, ApprovalRequest):
            raise ApprovalError(
                "Invalid approval request"
            )

        if not all([
            request.approval_id,
            request.action,
            request.summary,
        ]):
            raise ApprovalError(
                "Incomplete approval request"
            )

        if not re.fullmatch(
            r"[0-9a-f]{64}",
            request.payload_hash,
        ):
            raise ApprovalError(
                "Invalid approval payload hash"
            )

        if (
            not isinstance(request.expires_at, datetime)
            or request.expires_at.tzinfo is None
            or request.expires_at.utcoffset() is None
        ):
            raise ApprovalError(
                "Approval expiry must be timezone-aware"
            )

        if now_utc() >= request.expires_at:
            raise ApprovalExpired(
                "Approval request has expired"
            )

    @staticmethod
    async def require_approval(
        request: ApprovalRequest,
        verify: ApprovalVerifier,
    ) -> None:
        """Pause until an authenticated approval is verified.

        Call this BEFORE executing a sensitive domain action.

        The caller must provide a verifier backed by the
        authoritative approval database. A client-supplied
        decision alone never authorizes execution.
        """

        ApprovalManager.validate_request(request)

        # LangGraph pauses here and checkpoints its state.
        #
        # No business operation or database mutation
        # should occur before this interrupt.
        #
        # On resume, this node runs again from its start.
        resume = interrupt({
            "type": "human_approval_required",
            "approval_id": request.approval_id,
            "action": request.action,
            "summary": request.summary,
            "expires_at": request.expires_at.isoformat(),
        })

        # Do not trust the resume payload as authorization.
        if not isinstance(resume, dict):
            raise ApprovalNotAuthorized(
                "Invalid approval response"
            )

        if resume.get("approval_id") != request.approval_id:
            raise ApprovalNotAuthorized(
                "Approval ID mismatch"
            )

        decision = resume.get("decision")

        if decision == "REJECTED":
            raise ApprovalRejected(
                "Doctor rejected the proposed action"
            )

        if decision != "APPROVED":
            raise ApprovalNotAuthorized(
                "Invalid approval decision"
            )

        # Check expiration again after resume.
        ApprovalManager.validate_request(request)

        if not callable(verify):
            raise ApprovalNotAuthorized(
                "Approval verifier is unavailable"
            )

        # The verifier must check:
        # - persisted approval exists and is APPROVED
        # - authenticated approver is authorized
        # - thread, action and payload hash match
        # - approval has not expired or been revoked
        verified = await verify(request)

        if verified is not True:
            raise ApprovalNotAuthorized(
                "Approval verification failed"
            )

        # Guard against expiration during verification.
        ApprovalManager.validate_request(request)

        # Caller may now proceed to its separate,
        # idempotent, transaction-safe execution gate.
        return None
