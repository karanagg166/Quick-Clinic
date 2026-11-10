"""Cleanup requires positive synthetic evidence and preserves medical provenance."""

import pytest

from scripts.migration.audit import classify_user, plan_cleanup, seed_identities
from scripts.migration.verification import identifier, fingerprint_query, checksum, write_private_json


@pytest.mark.parametrize(
    "email", ["person@gmail.com", "test.person@gmail.com", "patient@clinic.com", "person@notexample.com"]
)
def test_name_or_email_words_alone_are_not_sufficient_evidence(email):
    assert not classify_user({"id": "a", "email": email, "name": "Test User", "role": "PATIENT"})["delete"]


@pytest.mark.parametrize(
    "email",
    [
        "patient@quickclinic.test",
        "user@example.com",
        "a@team.quickclinic.test",
        "qa.patient@quickclinic.internal",
    ],
)
def test_explicit_test_identity_is_classified_with_evidence(email):
    result = classify_user({"id": "a", "email": email, "role": "PATIENT"})
    assert result["delete"] and result["evidence"]


def test_document_owner_is_preserved_even_if_explicit_fixture():
    result = classify_user(
        {"id": "a", "email": "patient@example.test", "role": "PATIENT"}, fixture=True, document_count=1
    )
    assert not result["delete"] and "existing_medical_document_owner" in result["protected"]


def test_seeded_operator_is_retained_and_known_demo_login_can_be_removed():
    assert not classify_user({"id": "a", "email": "operator@gmail.com", "role": "ADMIN"}, seed_identity=True)[
        "delete"
    ]
    assert classify_user({"id": "a", "email": "admin@gmail.com", "role": "ADMIN"}, seed_identity=True)[
        "delete"
    ]


def test_seed_manifest_requires_email_and_name_literal_pair():
    source = 'email: "seed@clinic.test", phone: "123", name: "Synthetic Name"'
    assert seed_identities(source) == {("seed@clinic.test", "Synthetic Name")}


def test_cleanup_preserves_clinical_owner_and_connected_doctor_history():
    snapshot = {
        "User": [
            {"id": "admin", "email": "operator@clinic.com", "name": "Operator", "role": "ADMIN"},
            {"id": "patient", "email": "patient@example.test", "name": "Synthetic", "role": "PATIENT"},
            {"id": "doctor", "email": "doctor@example.test", "name": "Synthetic", "role": "DOCTOR"},
            {"id": "fixture", "email": "fixture@example.test", "name": "Synthetic", "role": "PATIENT"},
        ],
        "Patient": [{"id": "p", "userId": "patient"}],
        "Doctor": [{"id": "d", "userId": "doctor"}],
        "MedicalDocument": [{"id": "record", "patientId": "p"}],
        "Appointment": [{"id": "visit", "patientId": "p", "doctorId": "d"}],
    }
    plan = plan_cleanup(snapshot)
    assert plan["delete_user_ids"] == ["fixture"]
    assert plan["summary"]["document_owners_preserved"] == 1


def test_cleanup_cannot_remove_last_operator():
    with pytest.raises(ValueError, match="administrator"):
        plan_cleanup(
            {"User": [{"id": "a", "email": "admin@example.test", "name": "Fixture", "role": "ADMIN"}]}
        )


def test_sql_identifiers_are_quoted_including_embedded_quotes():
    assert identifier('odd"name') == '"odd""name"'
    query = fingerprint_query(["User", "MedicalDocument"])
    assert 'public."User"' in query and "ORDER BY md5(to_jsonb(r)::text)" in query
    with pytest.raises(ValueError):
        identifier("bad\x00name")


def test_private_audit_artifact_has_checksum_and_restrictive_permissions(tmp_path):
    path = tmp_path / "audit.json"
    write_private_json(path, {"synthetic": True})
    assert path.stat().st_mode & 0o777 == 0o600
    before = checksum(path)
    write_private_json(path, {"synthetic": False})
    assert checksum(path) != before


def test_cleanup_expands_fk_cascades_and_exact_delivery_references_without_text_guessing():
    from scripts.migration.cleanup import affected_rows

    snapshot = {
        "User": [{"id": "bad"}, {"id": "safe"}],
        "Patient": [{"id": "p", "userId": "bad"}],
        "Payment": [{"id": "pay", "userId": "bad", "razorpayOrderId": "order_fixture"}],
        "MedicalDocument": [],
        "AuditLog": [{"id": "audit", "userId": "bad"}],
        "AccessLog": [{"id": "access", "userId": "safe", "targetId": "p"}],
        "NotificationOutbox": [{"id": "outbox", "payload": {"payment": {"id": "pay"}}}],
        "WebhookEvent": [
            {"id": "event", "payload": {"order_id": "order_fixture"}},
            {"id": "safe_event", "payload": {"note": "text mentioning pay is preserved"}},
        ],
    }
    relations = [
        {
            "table_name": "Patient",
            "column_name": "userId",
            "foreign_table": "User",
            "foreign_column": "id",
            "delete_rule": "CASCADE",
        },
        {
            "table_name": "Payment",
            "column_name": "userId",
            "foreign_table": "User",
            "foreign_column": "id",
            "delete_rule": "CASCADE",
        },
    ]
    affected = affected_rows(snapshot, relations, ["bad"])
    assert affected["Patient"] == ["p"] and affected["Payment"] == ["pay"]
    assert affected["WebhookEvent"] == ["event"]
    assert affected["AccessLog"] == ["access"] and affected["NotificationOutbox"] == ["outbox"]


def test_cleanup_rejects_a_plan_that_would_cascade_into_a_medical_record():
    from scripts.migration.cleanup import affected_rows

    snapshot = {"User": [{"id": "bad"}], "MedicalDocument": [{"id": "record", "userId": "bad"}]}
    relations = [
        {
            "table_name": "MedicalDocument",
            "column_name": "userId",
            "foreign_table": "User",
            "foreign_column": "id",
            "delete_rule": "CASCADE",
        }
    ]
    with pytest.raises(ValueError, match="medical"):
        affected_rows(snapshot, relations, ["bad"])


def test_cleanup_sql_is_transactional_guarded_and_quotes_private_ids():
    from scripts.migration.cleanup import cleanup_sql

    sql = cleanup_sql(
        {"User": ["odd'id"], "AuditLog": ["audit"]}, [{"table_name": "User", "fingerprint": "abc"}]
    )
    assert sql.startswith("BEGIN;") and sql.endswith("COMMIT;")
    assert "RAISE EXCEPTION" in sql and "odd''id" in sql
    assert sql.index('DELETE FROM public."AuditLog"') < sql.index('DELETE FROM public."User"')


def test_cleanup_releases_only_slots_orphaned_by_removed_visits_or_holds():
    from scripts.migration.cleanup import slots_to_release, cleanup_sql

    snapshot = {
        "Appointment": [{"id": "fake", "slotId": "orphan"}, {"id": "real", "slotId": "occupied"}],
        "Slot": [
            {"id": "orphan"},
            {"id": "occupied"},
            {"id": "held", "heldByPatientId": "deleted"},
            {"id": "deleted_slot"},
        ],
    }
    affected = {"Appointment": ["fake"], "Patient": ["deleted"], "Slot": ["deleted_slot"]}
    assert slots_to_release(snapshot, affected) == ["held", "orphan"]
    with pytest.raises(ValueError, match="timestamp"):
        cleanup_sql({}, [], release_slots=["orphan"])
    sql = cleanup_sql({}, [], release_slots=["orphan"], planned_at="2026-11-10T00:00:00")
    assert 'UPDATE public."Slot"' in sql and '"holdToken"=NULL' in sql


def test_serialized_legacy_audit_metadata_is_matched_as_structured_data():
    from scripts.migration.cleanup import contains_reference

    assert contains_reference('{"userId":"removed"}', {"removed"})
    assert not contains_reference("text mentioning removed", {"removed"})
    assert not contains_reference("{invalid json", {"removed"})


def test_known_demo_identity_requires_matching_seed_password_before_deletion():
    demo = {"id": "demo", "email": "doctor@gmail.com", "name": "Renamed demo", "role": "DOCTOR"}
    assert not classify_user(demo)["delete"]
    assert classify_user(demo, known_demo_password=True)["delete"]
    assert not classify_user(demo, known_demo_password=True, document_count=1)["delete"]


def test_quarantine_disables_only_proven_demo_identities_preserved_for_clinical_history():
    from scripts.migration.audit import quarantine_user_ids

    snapshot = {
        "User": [
            {"id": "owner", "role": "ADMIN"},
            {"id": "demo", "role": "PATIENT"},
            {"id": "real", "role": "PATIENT"},
        ]
    }
    plan = {
        "accounts": [
            {"user_id": "owner", "delete": False, "evidence": ["seed"], "protected": ["operator"]},
            {"user_id": "demo", "delete": False, "evidence": ["seed"], "protected": ["documents"]},
            {"user_id": "real", "delete": False, "evidence": [], "protected": ["documents"]},
        ]
    }
    assert quarantine_user_ids(plan, snapshot) == ["demo"]
