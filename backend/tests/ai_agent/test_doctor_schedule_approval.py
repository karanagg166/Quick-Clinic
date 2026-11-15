"""Tests for doctor weekly schedule normalization and approval execution."""

import pytest
from sqlalchemy import select

from app.features.ai_agent.approval_resume import decide_and_resume_approval
from app.features.ai_agent.persistence.approvals import create_or_get_approval
from app.features.ai_agent.persistence.threads import create_or_get_thread
from app.features.ai_agent.tools.doctor_executor import (
    execute_approved_doctor_action,
    normalize_weekly_schedule_payload,
)
from app.features.scheduling.validation import validate_schedule
from app.infrastructure.database import tables, utcnow


@pytest.mark.unit
def test_normalize_weekly_schedule_from_dict_of_days() -> None:
    raw = {
        "Friday": [{"end": "13:00", "start": "09:00"}, {"end": "19:00", "start": "15:00"}],
        "Monday": [{"end": "13:00", "start": "09:00"}, {"end": "19:00", "start": "15:00"}],
        "Sunday": [],
        "Tuesday": [{"end": "13:00", "start": "09:00"}, {"end": "19:00", "start": "15:00"}],
        "Saturday": [{"end": "14:00", "start": "09:00"}],
        "Thursday": [
            {"end": "14:00", "start": "10:00"},
            {"end": "15:30", "start": "15:00"},
            {"end": "20:00", "start": "16:00"},
        ],
        "Wednesday": [{"end": "13:00", "start": "09:00"}, {"end": "18:00", "start": "15:00"}],
    }

    normalized = normalize_weekly_schedule_payload(raw)
    validated = validate_schedule(normalized)

    assert len(validated) == 7
    days = [d["day"] for d in validated]
    assert days == ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]

    thursday = next(d for d in validated if d["day"] == "Thursday")
    assert len(thursday["slots"]) == 3
    assert thursday["slots"][0] == {"slotNo": 1, "start": "10:00", "end": "14:00"}
    assert thursday["slots"][1] == {"slotNo": 2, "start": "15:00", "end": "15:30"}
    assert thursday["slots"][2] == {"slotNo": 3, "start": "16:00", "end": "20:00"}

    sunday = next(d for d in validated if d["day"] == "Sunday")
    assert sunday["slots"] == []


@pytest.mark.unit
def test_normalize_weekly_schedule_time_strings_and_12h() -> None:
    raw = {
        "weekly_schedule": {
            "monday": ["9am - 1pm", "3:00 PM to 7:00 PM"],
            "tuesday": [{"startTime": "9:00", "endTime": "17:00"}],
            "wednesday": [{"from": "10:00", "to": "2:00 PM"}],
        }
    }

    normalized = normalize_weekly_schedule_payload(raw)
    validated = validate_schedule(normalized)

    monday = next(d for d in validated if d["day"] == "Monday")
    assert monday["slots"] == [
        {"slotNo": 1, "start": "09:00", "end": "13:00"},
        {"slotNo": 2, "start": "15:00", "end": "19:00"},
    ]

    tuesday = next(d for d in validated if d["day"] == "Tuesday")
    assert tuesday["slots"] == [{"slotNo": 1, "start": "09:00", "end": "17:00"}]

    wednesday = next(d for d in validated if d["day"] == "Wednesday")
    assert wednesday["slots"] == [{"slotNo": 1, "start": "10:00", "end": "14:00"}]


@pytest.mark.unit
def test_normalize_partial_schedule_preserves_existing() -> None:
    existing = [
        {"day": "Monday", "slots": [{"slotNo": 1, "start": "09:00", "end": "17:00"}]},
        {"day": "Tuesday", "slots": [{"slotNo": 1, "start": "09:00", "end": "17:00"}]},
        {"day": "Wednesday", "slots": [{"slotNo": 1, "start": "09:00", "end": "17:00"}]},
        {"day": "Thursday", "slots": [{"slotNo": 1, "start": "09:00", "end": "17:00"}]},
        {"day": "Friday", "slots": [{"slotNo": 1, "start": "09:00", "end": "17:00"}]},
        {"day": "Saturday", "slots": []},
        {"day": "Sunday", "slots": []},
    ]

    partial_update = {
        "day": "Wednesday",
        "slots": [{"start": "10:00", "end": "14:00"}],
    }

    merged = normalize_weekly_schedule_payload(partial_update, existing)
    validated = validate_schedule(merged)

    monday = next(d for d in validated if d["day"] == "Monday")
    assert monday["slots"] == [{"slotNo": 1, "start": "09:00", "end": "17:00"}]

    wednesday = next(d for d in validated if d["day"] == "Wednesday")
    assert wednesday["slots"] == [{"slotNo": 1, "start": "10:00", "end": "14:00"}]


async def _seed_test_doctor(db, *, user_id="u_doc_sched", doctor_id="doc_sched"):
    now = utcnow()
    await db.execute(
        tables["Location"].insert().values(pincode=110002, city="Delhi", state="DL")
    )
    await db.execute(
        tables["User"].insert().values(
            id=user_id,
            email=f"{user_id}@example.com",
            phoneNo="9888888888",
            name="Dr. Scheduler",
            password="hashed",
            age=40,
            gender="FEMALE",
            role="DOCTOR",
            address="Clinic",
            pinCode=110002,
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
            experience=10,
            fees=700,
            createdAt=now,
            updatedAt=now,
        )
    )
    return {"id": user_id, "role": "DOCTOR", "isActive": True}


@pytest.mark.integration
@pytest.mark.asyncio
async def test_execute_approved_doctor_action_updates_weekly_schedule(db) -> None:
    actor = await _seed_test_doctor(db, user_id="u_doc_exec", doctor_id="doc_exec")

    params = {
        "weekly_schedule": {
            "Monday": [{"start": "09:00", "end": "13:00"}],
            "Tuesday": [{"start": "10:00", "end": "14:00"}],
        }
    }

    code, res = await execute_approved_doctor_action(
        db,
        actor=actor,
        action_type="UPDATE_SCHEDULE",
        parameters=params,
        approval_id="appr_sched_1",
    )

    assert code == "UPDATE_SCHEDULE_OK"
    assert res["doctorId"] == "doc_exec"

    sched_row = (
        await db.execute(
            select(tables["Schedule"]).where(tables["Schedule"].c.doctorId == "doc_exec")
        )
    ).mappings().first()
    assert sched_row is not None
    weekly = sched_row["weeklySchedule"]
    assert isinstance(weekly, list)
    monday = next(d for d in weekly if d["day"] == "Monday")
    assert monday["slots"] == [{"slotNo": 1, "start": "09:00", "end": "13:00"}]


@pytest.mark.integration
@pytest.mark.asyncio
async def test_decide_and_resume_approval_for_weekly_schedule(db) -> None:
    actor = await _seed_test_doctor(db, user_id="u_doc_res", doctor_id="doc_res")
    thread = await create_or_get_thread(db, actor=actor, thread_id="thread_sched_res")

    proposal = await create_or_get_approval(
        db,
        actor=actor,
        thread_id=thread["id"],
        tool_call_id="call_sched_res_1",
        action_type="UPDATE_SCHEDULE",
        risk_level="MEDIUM_HUMAN_APPROVAL",
        parameters={
            "weekly_schedule": {
                "Friday": [{"end": "13:00", "start": "09:00"}],
                "Monday": [{"end": "13:00", "start": "09:00"}],
            }
        },
        title="Update Weekly Schedule",
        summary="Update doctor schedule",
        reason="Updated clinic hours",
        idempotency_key="idem_sched_res_1",
    )

    result = await decide_and_resume_approval(
        model=None,
        db=db,
        actor=actor,
        thread_id=thread["id"],
        approval_id=proposal["id"],
        decision="APPROVED",
    )

    assert result["approval"]["status"] == "APPROVED"
    assert result["approval"]["executionStatus"] == "COMPLETED"

    sched_row = (
        await db.execute(
            select(tables["Schedule"]).where(tables["Schedule"].c.doctorId == "doc_res")
        )
    ).mappings().first()
    assert sched_row is not None
    assert isinstance(sched_row["weeklySchedule"], list)
