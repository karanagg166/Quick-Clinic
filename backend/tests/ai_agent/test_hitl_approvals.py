"""Tests for durable HITL approvals, expiry, isolation, and LangGraph resume."""

from datetime import timedelta

import pytest
from fastapi import HTTPException
from langchain_core.messages import AIMessage
from langgraph.checkpoint.memory import MemorySaver
from langgraph.types import Command
from sqlalchemy import update

from app.features.ai_agent.graph.workflow import build_workflow
from app.features.ai_agent.hitl_bridge import build_hitl_callbacks
from app.features.ai_agent.persistence.approvals import (
    claim_execution,
    complete_execution,
    create_or_get_approval,
    decide_approval,
    verify_approved,
)
from app.features.ai_agent.persistence.threads import append_turn, create_or_get_thread
from app.features.ai_agent.tools.doctor_mutations import build_doctor_mutating_tools
from app.infrastructure.database import tables, utcnow


async def _seed_doctor(db, *, user_id="u_doc_1", doctor_id="doc_1", email="doc1@example.com"):
    now = utcnow()
    await db.execute(
        tables["Location"].insert().values(pincode=110001, city="Delhi", state="DL")
    )
    await db.execute(
        tables["User"].insert().values(
            id=user_id,
            email=email,
            phoneNo="9999999999",
            name="Dr. Tester",
            password="hashed",
            age=35,
            gender="MALE",
            role="DOCTOR",
            address="Clinic",
            pinCode=110001,
            isActive=True,
            createdAt=now,
            updatedAt=now,
        )
    )
    await db.execute(
        tables["Doctor"].insert().values(
            id=doctor_id,
            userId=user_id,
            specialty="GENERAL_PHYSICIAN",
            experience=5,
            fees=500,
            createdAt=now,
            updatedAt=now,
        )
    )
    return {"id": user_id, "role": "DOCTOR", "isActive": True}


@pytest.mark.integration
@pytest.mark.asyncio
async def test_approval_lifecycle_expiry_rejection_and_atomic_claim(db):
    actor = await _seed_doctor(db)
    thread = await create_or_get_thread(db, actor=actor, thread_id="thread_hitl_1")

    proposal = await create_or_get_approval(
        db,
        actor=actor,
        thread_id=thread["id"],
        tool_call_id="tc_1",
        action_type="APPLY_LEAVE",
        risk_level="MEDIUM_HUMAN_APPROVAL",
        parameters={"start_date": "2026-12-01", "end_date": "2026-12-02", "reason": "Conference"},
        title="Apply for Leave",
        summary="Apply leave for Dec 1-2",
        reason="Conference",
        idempotency_key="idem_hitl_approval_1",
    )
    assert proposal["status"] == "PENDING"
    assert proposal["executionStatus"] == "NOT_STARTED"

    # Cross-user rejection
    other_actor = {"id": "u_other_doc", "role": "DOCTOR", "isActive": True}
    with pytest.raises(HTTPException) as exc:
        await decide_approval(
            db, actor=other_actor, thread_id=thread["id"], approval_id=proposal["id"], decision="APPROVED"
        )
    assert exc.value.status_code == 404

    # Approve and verify
    decided = await decide_approval(
        db, actor=actor, thread_id=thread["id"], approval_id=proposal["id"], decision="APPROVED"
    )
    assert decided["status"] == "APPROVED"
    assert await verify_approved(
        db,
        actor=actor,
        thread_id=thread["id"],
        approval_id=proposal["id"],
        tool_call_id="tc_1",
        action_type="APPLY_LEAVE",
        payload_hash=proposal["payloadHash"],
        idempotency_key="idem_hitl_approval_1",
    )

    # Atomic claim succeeds once, second claim fails (double-click safety)
    claimed = await claim_execution(
        db,
        actor=actor,
        thread_id=thread["id"],
        approval_id=proposal["id"],
        tool_call_id="tc_1",
        action_type="APPLY_LEAVE",
        payload_hash=proposal["payloadHash"],
        idempotency_key="idem_hitl_approval_1",
    )
    assert claimed["executionStatus"] == "EXECUTING"

    with pytest.raises(HTTPException) as conflict:
        await claim_execution(
            db,
            actor=actor,
            thread_id=thread["id"],
            approval_id=proposal["id"],
            tool_call_id="tc_1",
            action_type="APPLY_LEAVE",
            payload_hash=proposal["payloadHash"],
            idempotency_key="idem_hitl_approval_1",
        )
    assert conflict.value.status_code == 409

    completed = await complete_execution(
        db, actor=actor, thread_id=thread["id"], approval_id=proposal["id"], success=True, result_code="APPLY_LEAVE_OK"
    )
    assert completed["executionStatus"] == "COMPLETED"


@pytest.mark.integration
@pytest.mark.asyncio
async def test_expired_approval_cannot_be_decided_or_executed(db):
    actor = await _seed_doctor(db, user_id="u_doc_exp", doctor_id="doc_exp", email="docexp@example.com")
    thread = await create_or_get_thread(db, actor=actor, thread_id="thread_exp_1")
    proposal = await create_or_get_approval(
        db,
        actor=actor,
        thread_id=thread["id"],
        tool_call_id="tc_exp",
        action_type="CANCEL_LEAVE",
        risk_level="MEDIUM_HUMAN_APPROVAL",
        parameters={"leave_id": "leave_1"},
        title="Cancel Leave",
        summary="Cancel leave",
        reason="Plans changed",
        idempotency_key="idem_exp_approval_1",
    )
    await db.execute(
        update(tables["AgentApproval"])
        .where(tables["AgentApproval"].c.id == proposal["id"])
        .values(expiresAt=utcnow() - timedelta(seconds=5))
    )

    with pytest.raises(HTTPException) as exc:
        await decide_approval(
            db, actor=actor, thread_id=thread["id"], approval_id=proposal["id"], decision="APPROVED"
        )
    assert exc.value.status_code == 410


class _FakeModel:
    def __init__(self, responses):
        self._responses = list(responses)

    def bind_tools(self, tools):
        return self

    async def ainvoke(self, messages):
        return self._responses.pop(0)


@pytest.mark.integration
@pytest.mark.asyncio
async def test_langgraph_interrupt_and_resume_executes_leave(db):
    actor = await _seed_doctor(db, user_id="u_doc_lg", doctor_id="doc_lg", email="doclg@example.com")
    thread = await create_or_get_thread(db, actor=actor, thread_id="thread_lg_1")
    turn = await append_turn(db, thread_id=thread["id"], original_query="Apply leave for Dec 10-11")

    model = _FakeModel(
        [
            AIMessage(
                content="",
                tool_calls=[
                    {
                        "id": "call_leave_1",
                        "name": "apply_leave",
                        "args": {"start_date": "2026-12-10", "end_date": "2026-12-11", "reason": "CME"},
                    }
                ],
            ),
            AIMessage(content="Your leave for Dec 10-11 has been applied."),
        ]
    )
    tools = build_doctor_mutating_tools()
    factory, verifier, executor = build_hitl_callbacks(
        db, actor=actor, thread_id=thread["id"], turn_id=turn["id"]
    )
    cp = MemorySaver()
    graph = build_workflow(
        model=model,
        tools=tools,
        checkpointer=cp,
        approval_request_factory=factory,
        approval_verifier=verifier,
        approved_tool_executor=executor,
    )
    cfg = {"configurable": {"thread_id": thread["id"]}, "recursion_limit": 16}

    paused = await graph.ainvoke({"messages": [], "next_agent": "doctor"}, config=cfg)
    assert "__interrupt__" in paused
    approval_id = paused["__interrupt__"][0].value["approval_id"]

    await decide_approval(db, actor=actor, thread_id=thread["id"], approval_id=approval_id, decision="APPROVED")
    resumed = await graph.ainvoke(
        Command(resume={"approval_id": approval_id, "decision": "APPROVED"}), config=cfg
    )
    assert "applied" in resumed["messages"][-1].content.lower()

    leaves = (await db.execute(tables["Leave"].select().where(tables["Leave"].c.doctorId == "doc_lg"))).all()
    assert len(leaves) == 1
