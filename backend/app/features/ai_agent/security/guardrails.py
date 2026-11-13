
"""Basic input and tool-output guardrails for Quick-Clinic AI agents."""

from typing import Any

from fastapi import HTTPException, status


MAX_MESSAGE_LENGTH = 6000
MAX_TOOL_RESULT_LENGTH = 16000


def validate_user_message(message: str) -> str:
    """Validate user input before passing it to the LLM."""

    if not isinstance(message, str):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Message must be a string",
        )

    message = message.strip()

    if not message:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Message cannot be empty",
        )

    if len(message) > MAX_MESSAGE_LENGTH:
        raise HTTPException(
            status_code=status.HTTP_413_CONTENT_TOO_LARGE,
            detail="Message exceeds the allowed length",
        )

    if any(
        ord(char) < 32 and char not in "\n\r\t"
        for char in message
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Message contains invalid control characters",
        )

    return message


def validate_tool_result(result: Any) -> Any:
    """Reject oversized tool responses before LLM processing."""

    if isinstance(result, str):
        size = len(result)
    else:
        import json

        try:
            size = len(json.dumps(result, default=str))
        except (TypeError, ValueError) as exc:
            raise ValueError(
                "Tool result cannot be serialized"
            ) from exc

    if size > MAX_TOOL_RESULT_LENGTH:
        raise ValueError(
            "Tool result exceeds the allowed size"
        )

    return result
