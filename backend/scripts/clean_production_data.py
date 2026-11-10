"""Clean synthetic / AI test dummy data from production database and populate testing schema."""

import asyncio
import sys
from sqlalchemy import text
from app.infrastructure.database import engine, new_id, utcnow


async def clean_production_and_setup_testing():
    async with engine.connect() as conn:
        trans = await conn.begin()
        try:
            print("==================================================")
            print("1. AUDITING SYNTHETIC DATA IN PUBLIC SCHEMA")
            print("==================================================")
            users = (await conn.execute(text('SELECT id, email, name, role FROM public."User"'))).fetchall()

            synthetic_user_ids = []
            genuine_user_ids = []

            for u in users:
                uid, email, name, role = u
                is_synthetic = (
                    "@quickclinic.test" in email.lower()
                    or "@quickclinic.internal" in email.lower()
                    or email.lower().startswith("ss-release-")
                    or "synthetic" in name.lower()
                    or "(p2_" in name
                )
                if is_synthetic:
                    synthetic_user_ids.append(uid)
                else:
                    genuine_user_ids.append(uid)

            print(f"Total Users: {len(users)}")
            print(f"Genuine Users to keep ({len(genuine_user_ids)}):")
            for u in users:
                if u[0] in genuine_user_ids:
                    print(f"  ✓ {u[1]:<35} | {u[2]:<25} | {u[3]}")

            print(f"\nSynthetic Users to delete ({len(synthetic_user_ids)}):")
            for u in users:
                if u[0] in synthetic_user_ids:
                    print(f"  ✗ {u[1]:<55} | {u[2]}")

            if not synthetic_user_ids:
                print("No synthetic users found to clean.")
                return

            # Check counts before
            tables_to_check = [
                "User", "Doctor", "Patient", "Admin", "MedicalDocument",
                "Appointment", "Slot", "Schedule", "DoctorQualification", "Leave",
                "DoctorPatientRelation", "ChatMessages", "Payment", "Checkout", "Refund",
                "Notification", "NotificationOutbox", "AccessLog", "AuditLog", "WebhookEvent"
            ]
            print("\n--- Counts BEFORE cleanup ---")
            for t in tables_to_check:
                cnt = await conn.scalar(text(f'SELECT count(*) FROM public."{t}"'))
                print(f"  {t:<25}: {cnt}")

            print("\n==================================================")
            print("2. DELETING SYNTHETIC DATA FROM PUBLIC SCHEMA")
            print("==================================================")

            # a) MedicalDocument: delete synthetic test documents
            res = await conn.execute(text("""
                DELETE FROM public."MedicalDocument"
                WHERE LOWER(title) LIKE '%synthetic%'
                   OR "patientId" IN (SELECT id FROM public."Patient" WHERE "userId" = ANY(:uids))
            """), {"uids": synthetic_user_ids})
            print(f"Deleted synthetic MedicalDocuments: {res.rowcount}")

            # b) Refunds for mock payments
            res = await conn.execute(text("""
                DELETE FROM public."Refund"
                WHERE "paymentId" IN (
                    SELECT id FROM public."Payment" WHERE "userId" = ANY(:uids)
                )
            """), {"uids": synthetic_user_ids})
            print(f"Deleted synthetic Refunds: {res.rowcount}")

            # c) Checkouts for synthetic users
            res = await conn.execute(text("""
                DELETE FROM public."Checkout"
                WHERE "userId" = ANY(:uids)
            """), {"uids": synthetic_user_ids})
            print(f"Deleted synthetic Checkouts: {res.rowcount}")

            # d) WebhookEvents for mock payments
            res = await conn.execute(text("""
                DELETE FROM public."WebhookEvent"
                WHERE "paymentId" IN (
                    SELECT id FROM public."Payment" WHERE "userId" = ANY(:uids)
                )
            """), {"uids": synthetic_user_ids})
            print(f"Deleted synthetic WebhookEvents: {res.rowcount}")

            # e) Appointments for synthetic users
            res = await conn.execute(text("""
                DELETE FROM public."Appointment"
                WHERE "patientId" IN (SELECT id FROM public."Patient" WHERE "userId" = ANY(:uids))
                   OR "doctorId" IN (SELECT id FROM public."Doctor" WHERE "userId" = ANY(:uids))
            """), {"uids": synthetic_user_ids})
            print(f"Deleted synthetic Appointments: {res.rowcount}")

            # f) Payments for synthetic users
            res = await conn.execute(text("""
                DELETE FROM public."Payment"
                WHERE "userId" = ANY(:uids)
            """), {"uids": synthetic_user_ids})
            print(f"Deleted synthetic Payments: {res.rowcount}")

            # g) Slots for synthetic doctors
            res = await conn.execute(text("""
                DELETE FROM public."Slot"
                WHERE "doctorId" IN (SELECT id FROM public."Doctor" WHERE "userId" = ANY(:uids))
            """), {"uids": synthetic_user_ids})
            print(f"Deleted synthetic Slots: {res.rowcount}")

            # h) ChatMessages for synthetic relations
            res = await conn.execute(text("""
                DELETE FROM public."ChatMessages"
                WHERE "senderId" = ANY(:uids)
                   OR "doctorPatientRelationId" IN (
                       SELECT id FROM public."DoctorPatientRelation"
                       WHERE "doctorsUserId" = ANY(:uids) OR "patientsUserId" = ANY(:uids)
                   )
            """), {"uids": synthetic_user_ids})
            print(f"Deleted synthetic ChatMessages: {res.rowcount}")

            # i) DoctorPatientRelation for synthetic users
            res = await conn.execute(text("""
                DELETE FROM public."DoctorPatientRelation"
                WHERE "doctorsUserId" = ANY(:uids) OR "patientsUserId" = ANY(:uids)
            """), {"uids": synthetic_user_ids})
            print(f"Deleted synthetic DoctorPatientRelations: {res.rowcount}")

            # j) Notifications & Outbox
            res = await conn.execute(text("""
                DELETE FROM public."Notification" WHERE "userId" = ANY(:uids)
            """), {"uids": synthetic_user_ids})
            print(f"Deleted synthetic Notifications: {res.rowcount}")

            res = await conn.execute(text("""
                DELETE FROM public."NotificationOutbox" WHERE "targetUserId" = ANY(:uids)
            """), {"uids": synthetic_user_ids})
            print(f"Deleted synthetic NotificationOutbox: {res.rowcount}")

            # k) AccessLog & AuditLog
            res = await conn.execute(text("""
                DELETE FROM public."AccessLog" WHERE "userId" = ANY(:uids) OR "targetId" = ANY(:uids)
            """), {"uids": synthetic_user_ids})
            print(f"Deleted synthetic AccessLogs: {res.rowcount}")

            res = await conn.execute(text("""
                DELETE FROM public."AuditLog" WHERE "userId" = ANY(:uids)
            """), {"uids": synthetic_user_ids})
            print(f"Deleted synthetic AuditLogs: {res.rowcount}")

            # l) Doctor sub-tables: Leave, Schedule, Qualification
            res = await conn.execute(text("""
                DELETE FROM public."Leave" WHERE "doctorId" IN (SELECT id FROM public."Doctor" WHERE "userId" = ANY(:uids))
            """), {"uids": synthetic_user_ids})
            print(f"Deleted synthetic Leaves: {res.rowcount}")

            res = await conn.execute(text("""
                DELETE FROM public."Schedule" WHERE "doctorId" IN (SELECT id FROM public."Doctor" WHERE "userId" = ANY(:uids))
            """), {"uids": synthetic_user_ids})
            print(f"Deleted synthetic Schedules: {res.rowcount}")

            res = await conn.execute(text("""
                DELETE FROM public."DoctorQualification" WHERE "doctorId" IN (SELECT id FROM public."Doctor" WHERE "userId" = ANY(:uids))
            """), {"uids": synthetic_user_ids})
            print(f"Deleted synthetic DoctorQualifications: {res.rowcount}")

            # m) Doctor, Patient, Admin
            res = await conn.execute(text("""
                DELETE FROM public."Doctor" WHERE "userId" = ANY(:uids)
            """), {"uids": synthetic_user_ids})
            print(f"Deleted synthetic Doctors: {res.rowcount}")

            res = await conn.execute(text("""
                DELETE FROM public."Patient" WHERE "userId" = ANY(:uids)
            """), {"uids": synthetic_user_ids})
            print(f"Deleted synthetic Patients: {res.rowcount}")

            res = await conn.execute(text("""
                DELETE FROM public."Admin" WHERE "userId" = ANY(:uids)
            """), {"uids": synthetic_user_ids})
            print(f"Deleted synthetic Admins: {res.rowcount}")

            # n) User
            res = await conn.execute(text("""
                DELETE FROM public."User" WHERE id = ANY(:uids)
            """), {"uids": synthetic_user_ids})
            print(f"Deleted synthetic Users: {res.rowcount}")

            # Ensure all genuine PATIENT users have Patient profile rows
            patient_users = (await conn.execute(text("""
                SELECT u.id, u.email, u.name
                FROM public."User" u
                LEFT JOIN public."Patient" p ON u.id = p."userId"
                WHERE u.role = 'PATIENT' AND p.id IS NULL
            """))).fetchall()

            for pu in patient_users:
                pid = new_id()
                now = utcnow()
                await conn.execute(text("""
                    INSERT INTO public."Patient" (id, "userId", "createdAt", "updatedAt")
                    VALUES (:id, :userId, :now, :now)
                """), {"id": pid, "userId": pu[0], "now": now})
                print(f"Created natural Patient profile for {pu[1]} ({pu[2]})")

            print("\n==================================================")
            print("3. SYNCHRONIZING TESTING SCHEMA")
            print("==================================================")
            # Ensure Location reference data is populated in testing schema
            loc_cnt = await conn.scalar(text('SELECT count(*) FROM testing."Location"'))
            if loc_cnt == 0:
                await conn.execute(text("""
                    INSERT INTO testing."Location" (pincode, city, state)
                    SELECT pincode, city, state FROM public."Location"
                    ON CONFLICT DO NOTHING
                """))
                print("Seeded 12 reference locations into testing.Location")
            else:
                print(f"testing.Location already contains {loc_cnt} rows")

            # Check counts after
            print("\n--- Counts AFTER cleanup (PUBLIC SCHEMA) ---")
            for t in tables_to_check:
                cnt = await conn.scalar(text(f'SELECT count(*) FROM public."{t}"'))
                print(f"  {t:<25}: {cnt}")

            await trans.commit()
            print("\n==================================================")
            print("SUCCESS: Transaction committed cleanly!")
            print("==================================================")

        except Exception as exc:
            await trans.rollback()
            print(f"ERROR during cleanup: {exc}", file=sys.stderr)
            raise


if __name__ == "__main__":
    asyncio.run(clean_production_and_setup_testing())
