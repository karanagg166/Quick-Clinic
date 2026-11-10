"""Reviewable row-level cleanup plans with foreign-key and provenance evidence."""

import json
import re

from .verification import identifier


def contains_reference(value, identifiers):
    if isinstance(value, str):
        if value in identifiers:
            return True
        if value.lstrip().startswith(("{", "[")):
            try:
                return contains_reference(json.loads(value), identifiers)
            except (ValueError, RecursionError):
                return False
        return False
    if isinstance(value, dict):
        return any(contains_reference(item, identifiers) for item in value.values())
    if isinstance(value, list):
        return any(contains_reference(item, identifiers) for item in value)
    return False


def affected_rows(snapshot, foreign_keys, user_ids):
    """Expand only actual cascade edges and exact references to removed records."""
    removed = {name: set() for name in snapshot}
    removed["User"] = set(user_ids)
    changed = True
    while changed:
        changed = False
        for relation in foreign_keys:
            if relation["delete_rule"] != "CASCADE":
                continue
            parent, child = relation["foreign_table"], relation["table_name"]
            parent_values = {
                row[relation["foreign_column"]]
                for row in snapshot.get(parent, [])
                if row.get("id") in removed[parent]
            }
            for row in snapshot.get(child, []):
                if row.get(relation["column_name"]) in parent_values and row.get("id") not in removed[child]:
                    removed[child].add(row["id"])
                    changed = True
    references = set().union(*removed.values())
    for row in snapshot.get("Payment", []):
        if row["id"] in removed["Payment"]:
            references.update(row[key] for key in ("razorpayOrderId", "razorpayPaymentId") if row.get(key))
    for table in ("AuditLog", "AccessLog", "NotificationOutbox", "WebhookEvent"):
        for row in snapshot.get(table, []):
            direct = any(
                row.get(key) in references for key in ("userId", "targetUserId", "targetId", "paymentId")
            )
            payload = row.get("payload") or row.get("metadata")
            seeded = (
                isinstance(payload, dict) and payload.get("env") == "development" and "seededAt" in payload
            )
            synthetic_event = table == "WebhookEvent" and re.match(
                r"^(?:(?:evt|event)[_:-])?(?:qa|test|demo|seed|fixture|release|smoke|e2e|load)[_:-]",
                str(row.get("providerEventId", "")),
                re.IGNORECASE,
            )
            if direct or contains_reference(payload, references) or seeded or synthetic_event:
                removed[table].add(row["id"])
    if removed.get("MedicalDocument"):
        raise ValueError("Cleanup cannot remove existing medical documents")
    return {table: sorted(values) for table, values in removed.items() if values}


def sql_literal(value):
    return "'" + str(value).replace("'", "''") + "'"


def cleanup_sql(row_ids, fingerprints, *, release_slots=(), planned_at=None):
    """Reject changed targets; execute exact row IDs as one atomic transaction.

    This is intentionally generated outside Git because IDs and provenance are
    private migration artifacts. A count and content fingerprint guard prevents
    applying a stale cleanup plan to a database that has received new writes.
    """
    statements = ["BEGIN;", "SET LOCAL standard_conforming_strings = on;", "DO $qc_guard$ BEGIN"]
    for record in fingerprints:
        table = "public." + identifier(record["table_name"])
        expression = (
            "md5(coalesce(string_agg(md5(to_jsonb(r)::text), '' ORDER BY md5(to_jsonb(r)::text)),''))"
        )
        statements.append(
            f"IF (SELECT {expression} FROM {table} r) IS DISTINCT FROM {sql_literal(record['fingerprint'])} THEN RAISE EXCEPTION 'Migration target changed; regenerate the audit'; END IF;"
        )
    statements.append("END $qc_guard$;")
    # Remove standalone delivery/audit records first; remaining rows follow the
    # existing PostgreSQL cascades when the explicitly listed users are removed.
    for table in ("WebhookEvent", "NotificationOutbox", "AccessLog", "AuditLog", "User"):
        values = row_ids.get(table, [])
        if values:
            statements.append(
                f"DELETE FROM public.{identifier(table)} WHERE id IN ({','.join(sql_literal(value) for value in values)});"
            )
    if release_slots:
        if not planned_at:
            raise ValueError("Slot repair requires an explicit audit timestamp")
        statements.append(
            "UPDATE public.\"Slot\" SET status = CASE WHEN status IN ('HELD','BOOKED') THEN 'AVAILABLE'::public.\"SlotStatus\" ELSE status END, "
            '"heldByPatientId"=NULL,"heldAt"=NULL,"holdToken"=NULL,"holdExpiresAt"=NULL, '
            f'"updatedAt"={sql_literal(planned_at)}::timestamp WHERE id IN ({",".join(sql_literal(value) for value in release_slots)});'
        )
    statements.append("COMMIT;")
    return "\n".join(statements)


def slots_to_release(snapshot, row_ids):
    deleted_visits = set(row_ids.get("Appointment", []))
    deleted_patients = set(row_ids.get("Patient", []))
    deleted_slots = set(row_ids.get("Slot", []))
    visit_slots = {row["slotId"] for row in snapshot.get("Appointment", []) if row["id"] in deleted_visits}
    return sorted(
        row["id"]
        for row in snapshot.get("Slot", [])
        if row["id"] not in deleted_slots
        and (row["id"] in visit_slots or row.get("heldByPatientId") in deleted_patients)
    )
