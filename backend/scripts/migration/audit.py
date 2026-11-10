"""Conservative classification of synthetic clinic accounts with recorded evidence."""

import re
from collections import Counter

RESERVED_TEST_DOMAINS = {"quickclinic.test", "example.test", "example.invalid", "example.com"}
DEMO_LOGINS = {"admin@gmail.com", "doctor@gmail.com", "patient@gmail.com"}


def classify_user(user, *, fixture=False, document_count=0, seed_identity=False, known_demo_password=False):
    """Return evidence, never infer fake identity from a person's name alone.

    Explicit fixtures/reserved test domains are strong evidence. Seed identities
    must match the checked-in email AND name. Existing document owners and
    non-demo administrators are retained regardless of seed membership.
    """
    email = str(user.get("email", "")).strip().lower()
    local, _, domain = email.partition("@")
    evidence = []
    if fixture:
        evidence.append("explicit_release_fixture")
    if domain in RESERVED_TEST_DOMAINS or domain.endswith(".quickclinic.test"):
        evidence.append("reserved_test_domain")
    if domain == "quickclinic.internal" and re.match(r"^(qa|test|smoke|e2e|fixture|release)[+._-]", local):
        evidence.append("explicit_internal_test_identity")
    if seed_identity:
        evidence.append("exact_checked_in_seed_identity")
    if email in DEMO_LOGINS and known_demo_password:
        evidence.append("known_demo_login_and_seed_password")
    protected = []
    if document_count:
        protected.append("existing_medical_document_owner")
    if (
        user.get("role") == "ADMIN"
        and email not in DEMO_LOGINS
        and not any(reason != "exact_checked_in_seed_identity" for reason in evidence)
    ):
        protected.append("operator_administrator")
    return {
        "user_id": user["id"],
        "evidence": evidence,
        "protected": protected,
        "delete": bool(evidence) and not protected,
    }


def seed_identities(source):
    """Extract only literal identity pairs from the checked-in seed definition."""
    result = set()
    pattern = re.compile(
        r'email:\s*"([^"\n]+)"[^{}]*?name:\s*"([^"\n]+)"'
        r'|name:\s*"([^"\n]+)"[^{}]*?email:\s*"([^"\n]+)"',
        re.DOTALL,
    )
    for match in pattern.finditer(source):
        email, name, reversed_name, reversed_email = match.groups()
        result.add(((email or reversed_email).lower(), name or reversed_name))
    return result


def plan_cleanup(snapshot, seed_source=""):
    from app.features.auth.passwords import verify_password

    users = snapshot["User"]
    patients = {row["id"]: row["userId"] for row in snapshot.get("Patient", [])}
    doctors = {row["id"]: row["userId"] for row in snapshot.get("Doctor", [])}
    document_counts = Counter(patients[row["patientId"]] for row in snapshot.get("MedicalDocument", []))
    fixtures = {row["userId"] for row in snapshot.get("Doctor", []) if row.get("isReleaseFixture")}
    identities = seed_identities(seed_source)
    audit = [
        classify_user(
            user,
            fixture=user["id"] in fixtures,
            document_count=document_counts[user["id"]],
            seed_identity=(user["email"].lower(), user["name"]) in identities,
            known_demo_password=(
                user["email"].lower() in DEMO_LOGINS and verify_password("karan166", user.get("password", ""))
            ),
        )
        for user in users
    ]
    # A retained participant's appointment/history also protects the other endpoint.
    # This prevents deleting a seeded doctor from cascading into a genuine visit.
    while True:
        deleted = {row["user_id"] for row in audit if row["delete"]}
        protected = set()
        for appointment in snapshot.get("Appointment", []):
            participants = {patients[appointment["patientId"]], doctors[appointment["doctorId"]]}
            if participants - deleted:
                protected.update(participants & deleted)
        if not protected:
            break
        for row in audit:
            if row["user_id"] in protected:
                row["delete"] = False
                row["protected"].append("retained_participant_appointment")
    if not any(
        user["role"] == "ADMIN" and user["id"] not in {r["user_id"] for r in audit if r["delete"]}
        for user in users
    ):
        raise ValueError("Cleanup must retain an operator administrator")
    return {
        "version": 1,
        "accounts": audit,
        "delete_user_ids": sorted(row["user_id"] for row in audit if row["delete"]),
        "summary": {
            "users": len(users),
            "delete": sum(row["delete"] for row in audit),
            "preserve": sum(not row["delete"] for row in audit),
            "document_owners_preserved": len(document_counts),
        },
    }


def quarantine_user_ids(plan, snapshot):
    """Retain clinical provenance without leaving proven demo logins usable."""
    roles = {row["id"]: row["role"] for row in snapshot["User"]}
    return sorted(
        row["user_id"]
        for row in plan["accounts"]
        if not row["delete"] and row["evidence"] and row["protected"] and roles[row["user_id"]] != "ADMIN"
    )
