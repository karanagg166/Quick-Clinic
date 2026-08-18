# Quick-Clinic Part 1 Audit & System Architecture Report

## 1. Executive Summary

This document provides the exhaustive architectural, business logic, security, and database invariant audit conducted across the Quick-Clinic codebase as required by Part 1 (Phases 1 & 2) of the testing and hardening plan.

The system is a production-grade healthcare appointment booking and consultation platform featuring:
- Next.js 16 (App Router) frontend and API backend
- PostgreSQL (Neon serverless) managed via Prisma 7 ORM
- Upstash Redis distributed lock and slot hold caching
- Standalone Node.js Socket.IO server for real-time chat and multi-channel notifications
- Razorpay payments and refund workflow
- Multi-role RBAC (PATIENT, DOCTOR, ADMIN, SUPER_ADMIN)

---

## 2. Component & Architecture Map

### 2.1 Patient Module
- **Onboarding & Profile:** `src/app/api/patient/route.ts`, `src/app/api/patients/[patientId]/route.ts` manages demographics, medical history, allergies, emergency contacts.
- **Doctor Discovery:** `src/app/api/doctors/route.ts` provides multi-criteria filtering by specialty, max fee, min experience, gender, rating, and location/coordinates.
- **Booking Engine:** `src/lib/booking.ts` implements a multi-layer slot reservation system (Redis TTL hold -> Postgres slot locking -> Razorpay order creation -> signature verification -> appointment finalization).
- **Appointments Management:** `src/app/api/patients/[patientId]/appointments/` handles appointment history, cancellation, and refund processing.
- **Bank Details:** `src/app/api/user/[userId]/bank-details/route.ts` manages patient bank account details for refund processing.

### 2.2 Doctor Module
- **Onboarding & Profile:** `src/app/api/doctor/route.ts`, `src/app/api/doctors/[doctorId]/route.ts` manages specialties, qualifications, fee structure, experience, bio, and clinic coordinates.
- **Schedule Management:** `src/lib/scheduleUtils.ts`, `src/app/api/doctors/[doctorId]/schedule/` maintains weekly schedule templates and generates 30-minute date-specific slots.
- **Leave System:** `src/app/api/doctors/[doctorId]/leave/route.ts` supports date-range leaves, automatically transitioning overlapping slots to `ON_LEAVE` and auto-cancelling/refunding overlapping patient appointments.
- **Earnings & Balance Ledger:** `Doctor.balance` stores accumulated earnings in paise. Completed appointments credit `Doctor.fees * 100` paise atomically.
- **Withdrawals:** `src/app/api/doctors/[doctorId]/withdrawals/route.ts` allows doctors to request payouts against their available balance with atomic decrementing and double-spend protection.

### 2.3 Admin Module
- **Hierarchy & Moderation:** `src/app/api/admin/onboarding/route.ts`, `src/app/api/admin/users/route.ts`, `src/app/api/admin/doctors/route.ts` enables Super Admin and Sub-Admin creation, user/doctor account activation/deactivation.
- **Financial Oversight:** `src/app/api/admin/withdrawals/route.ts` allows processing withdrawal requests (`PENDING` -> `PROCESSING` -> `COMPLETED` / `FAILED`).
- **Audit & Access Observability:** `src/app/api/admin/logs/route.ts`, `src/lib/logger.ts` logs structured access events and sensitive domain state changes with role, action, and IP metadata.

### 2.4 Infrastructure & Real-Time
- **Database:** Neon PostgreSQL with Prisma ORM (`prisma/schema.prisma`).
- **Distributed Cache & Locking:** Upstash Redis with local Map fallback for slot holding and rate-limiting.
- **Socket Server:** Standalone Socket.IO service (`socket-server/`) handling real-time chat message broadcast, room access validation, and direct notification dispatching.

---

## 3. Database Invariants & Integrity Analysis

| Constraint / Invariant | Implementation Mechanism | Status | Notes |
| :--- | :--- | :--- | :--- |
| **Unique User Email** | `@unique` on `User.email` | Enforced | Case-insensitive normalized |
| **Unique Doctor Profile** | `@unique` on `Doctor.userId` | Enforced | 1-to-1 User <-> Doctor |
| **Unique Patient Profile** | `@unique` on `Patient.userId` | Enforced | 1-to-1 User <-> Patient |
| **Slot Uniqueness** | `@@unique([doctorId, date, startTime])` | Enforced | Prevents duplicate doctor slots |
| **Appointment Slot Uniqueness** | `@unique` on `Appointment.slotId` | Enforced | Exactly one appointment per slot |
| **Doctor-Patient Relation** | `@@unique([doctorsUserId, patientsUserId])` | Enforced | Single chat room per doctor-patient pair |
| **Doctor Leave Uniqueness** | `@@unique([doctorId, startDate, endDate])` | Enforced | Prevents identical overlapping leave entries |
| **Doctor Rating Uniqueness** | `@@unique([doctorId, patientId])` | Enforced | One rating per patient with idempotency |
| **Doctor Qualification** | `@@unique([doctorId, degree])` | Enforced | Prevents duplicate credentials |
| **Slot Hold Token** | `Slot.holdToken String?` | Hardened | Persisted in DB for hold ownership verification on Redis eviction |
| **Access & Audit Indexes** | Compound indexes on `createdAt`, `userId`, `tag` | Hardened | Sub-millisecond log querying and filtering |

---

## 4. Booking Concurrency Analysis (Scenarios A through K)

- **Scenario A (Happy Path Online):** Patient holds slot -> Redis lock acquired -> Order created -> Razorpay payment verified -> Slot `BOOKED` -> Appointment `CONFIRMED` -> Doctor balance untouched -> Relation & Chat created.
- **Scenario B (Happy Path Offline):** Patient holds slot -> Books OFFLINE -> Slot `BOOKED` -> Appointment `PENDING` -> Doctor manually confirms -> Appointment `CONFIRMED`.
- **Scenario C (Slot Hold Contention):** Two patients attempt holding the same slot simultaneously. First acquires atomic Redis lock/DB update; second receives `409 Conflict: Slot is already on hold`.
- **Scenario D (Hold TTL Expiration):** Patient holds slot but does not complete checkout within 10 minutes. Slot hold expires; background cron or subsequent patient requests release slot back to `AVAILABLE`.
- **Scenario E (Payment Failure / Abandonment):** Patient closes Razorpay modal or payment fails. Slot hold expires cleanly after TTL, allowing other patients to book.
- **Scenario F (Late Payment Verification After Expiry):** Payment succeeds on Razorpay gateway after local hold TTL expired and slot was booked by Patient B. Payment verification fails gracefully, marks payment recoverable, and issues automated refund.
- **Scenario G (Doctor Absence / No-Show):** Doctor misses appointment without completing it. Background cron identifies past unfulfilled appointments, transitions them to `EXPIRED`, and refunds online payments.
- **Scenario H (Doctor Applies Leave Over Existing Bookings):** Overlapping appointments are automatically cancelled and marked `CANCELLED_BY_DOCTOR` with automatic full refund initiated.
- **Scenario I (Patient Cancels Confirmed Appointment):** Slot restored to `AVAILABLE`, appointment marked `CANCELLED`, automated refund initiated if paid online.
- **Scenario J (Withdrawal Double-Spend Race):** Two concurrent withdrawal requests for doctor balance. Executed in atomic `prisma.$transaction`; second request fails with `400 Insufficient Balance`.
- **Scenario K (Socket Disconnect During Chat):** Socket connection drops; messages persist reliably in PostgreSQL via REST/Socket fallback and synchronize on reconnect.

---

## 5. Security & Authorization Hardening

1. **Socket.IO Cryptographic Authentication:** Hardened `socket-server/server.ts` to cryptographically verify JWT token signatures using `JWT_SECRET` rather than blindly trusting handshake user IDs.
2. **IDOR Defense on Bank Details & Clinical Data:** Added session identity validation in `src/app/api/user/[userId]/bank-details/route.ts`, `src/app/api/doctors/[doctorId]/bank-details/route.ts`, and `src/app/api/patients/[patientId]/appointments/[appointmentId]/route.ts`.
3. **Appointment Status State Machine:** Created `src/lib/appointment-state-machine.ts` enforcing strict status transition rules preventing illegal mutations (e.g. `COMPLETED` -> `CANCELLED`).
4. **Admin Logs Pagination & Indexing:** Implemented robust cursor-based and limit/offset pagination, date range filtering (`startDate`, `endDate`), and role filtering with database index backing.
