"""Patient AI Agent tool bundle combining read-only and HITL-gated tools."""

from datetime import date
from typing import Any

from langchain_core.tools import BaseTool
from sqlalchemy.ext.asyncio import AsyncConnection

from .patient_account_tools import build_patient_account_tools
from .patient_document_tools import build_patient_document_tools
from .patient_mutations import build_patient_mutation_tools


def build_patient_tools(
    *,
    db: AsyncConnection,
    actor: dict[str, Any],
    reference_date: date,
    thread_id: str | None = None,
    turn_id: str | None = None,
    include_mutations: bool = False,
) -> list[BaseTool]:
    """Build authenticated, patient-scoped tools for the Patient AI Agent."""

    tools: list[BaseTool] = [
        *build_patient_account_tools(
            db=db,
            actor=actor,
            reference_date=reference_date,
            thread_id=thread_id,
        ),
        *build_patient_document_tools(
            db=db,
            actor=actor,
            thread_id=thread_id,
            turn_id=turn_id,
        ),
    ]
    if include_mutations:
        tools.extend(build_patient_mutation_tools())
    return tools
