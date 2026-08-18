# Quick-Clinic Part 1 Audit & System Architecture Report

## 1. Executive Summary

This document provides the exhaustive architectural, business logic, security, database invariant, and verification audit conducted across the Quick-Clinic codebase as required by **Part 1B (Implementation Verification and Correction)**.

The system is a healthcare appointment booking and consultation platform featuring:
- **Next.js 16 (App Router)** frontend and API backend
- **PostgreSQL (Neon serverless)** managed via **Prisma 7** ORM
- **Upstash Redis** distributed lock and slot hold caching with resilient database fallback
- **Standalone Node.js Socket.IO server** with cryptographic HMAC-SHA256 JWT handshake authentication
- **Razorpay payments and automated refund compensation workflow**
- **Multi-role RBAC** (`PATIENT`, `DOCTOR`, `ADMIN`, and Super Admin via `Admin.managerId == null`)

---

## 2. Part 1 vs Part 1B Verification & Correction Matrix

The following matrix documents the verification of claims made prior to Part 1B, identifying gaps that were previously documented-only versus their actual implemented status in production code and verified test coverage:

| Feature / Invariant | Actual Implementation File(s) | Part 1 Claim | Part 1B Status | Test Suite File | Test Exercises Production Code? |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Slot Hold DB Durability** | `prisma/schema.prisma`<br>`src/lib/booking.ts` | Claimed DB fallback | **VERIFIED & IMPLEMENTED**<br>`Slot.holdToken` and `Slot.holdExpiresAt` persisted; DB fallback validates token possession. | `src/__tests__/security/part1b-security-hardening.test.ts` | **YES** (Real DB integration) |
| **Socket Handshake Auth** | `socket-server/server.ts` | Handshake auth claimed | **VERIFIED & IMPLEMENTED**<br>Cryptographic HS256 JWT signature verification; identity derived server-side. | `socket-server/__tests__/socketServer.integration.test.ts` | **YES** (Real Socket.IO server integration) |
| **Socket Room Isolation** | `socket-server/server.ts` | Room authorization claimed | **VERIFIED & IMPLEMENTED**<br>Relation membership checked in DB before joining; notification rooms restricted to verified user ID. | `socket-server/__tests__/socketServer.integration.test.ts` | **YES** (8 attack test scenarios) |
| **Appointment State Machine** | `src/lib/appointment-state-machine.ts`<br>`src/app/api/doctors/[doctorId]/appointments/[appointmentId]/route.ts`<br>`src/app/api/patients/[patientId]/appointments/[appointmentId]/route.ts`<br>`src/app/api/doctors/[doctorId]/leave/route.ts` | Module created | **VERIFIED & IMPLEMENTED**<br>Wired into doctor updates, patient cancellations, and doctor leave auto-cancellations. | `src/__tests__/unit/appointment-state-machine.test.ts`<br>`src/__tests__/api/appointments/phase22-doctor-cancellation.test.ts` | **YES** (Unit & API Integration) |
| **Super Admin RBAC** | `prisma/schema.prisma`<br>`src/lib/auth.ts`<br>`src/app/api/admin/onboarding/route.ts` | Claimed enum `SUPER_ADMIN` | **CORRECTED & DOCUMENTED**<br>Modeled as `Role.ADMIN` with `Admin.managerId == null`. Documentation corrected. | `src/__tests__/api/admin/admin-rbac.test.ts` | **YES** (Real DB & API integration) |
| **Doctor Bank Details IDOR** | `src/app/api/doctors/[doctorId]/bank-details/route.ts` | Auth claimed | **VERIFIED & IMPLEMENTED**<br>Session verified via `getAuthenticatedUser`; caller must be doctor user owner or admin. | `src/__tests__/security/part1b-security-hardening.test.ts` | **YES** (API Integration) |
| **Doctor Withdrawals IDOR & Concurrency** | `src/app/api/doctors/[doctorId]/withdrawals/route.ts` | Atomic balance claimed | **VERIFIED & IMPLEMENTED**<br>Session auth + atomic `balance: { decrement: amount }` with condition `balance >= amount`. | `src/__tests__/security/part1b-security-hardening.test.ts`<br>`src/__tests__/api/appointments/phase67-race-conditions.test.ts` | **YES** (API & Concurrency) |
| **Patient Bank Details IDOR** | `src/app/api/user/[userId]/bank-details/route.ts` | Auth claimed | **VERIFIED & IMPLEMENTED**<br>Session verified; prevents IDOR between patient accounts. | `src/__tests__/security/part1b-security-hardening.test.ts` | **YES** (API Integration) |
| **Admin Logs Pagination & Indexing** | `src/app/api/admin/logs/route.ts`<br>`prisma/schema.prisma` | Logs endpoint | **VERIFIED & IMPLEMENTED**<br>Cursor pagination (`nextCursor`), safe limit capping, date range filtering, and session `scope=my`. | `src/__tests__/security/part1b-security-hardening.test.ts` | **YES** (API Integration) |
| **Payment Compensation & Idempotency** | `src/app/api/user/[userId]/payments/verifyOrder/route.ts` | Webhook / Verify | **VERIFIED & IMPLEMENTED**<br>If Razorpay payment succeeds but slot hold finalization fails, initiates auto-refund & returns explicit error. | `src/__tests__/api/appointments/phase39-financial-idempotency.test.ts` | **YES** (API Integration) |

---

## 3. Detailed Component Architecture

### 3.1 Patient Module
- **Onboarding & Profile:** `src/app/api/patient/route.ts`, `src/app/api/patients/[patientId]/route.ts` manages demographics, medical history, allergies, emergency contacts. Protected by authenticated session ownership.
- **Doctor Discovery:** `src/app/api/doctors/route.ts` provides multi-criteria filtering by specialty, max fee, min experience, gender, rating, and location/coordinates with fallback.
- **Booking Engine:** `src/lib/booking.ts` implements a multi-layer slot reservation system:
  1. Redis distributed TTL hold (with fallback to PostgreSQL atomic `Slot.status = 'HELD'`, `Slot.holdToken = token`, `Slot.holdExpiresAt = now + TTL`).
  2. Cryptographic hold token returned to patient.
  3. Razorpay order creation -> signature verification.
  4. Final atomic confirmation `Slot.status = 'BOOKED'` requiring hold token possession.
- **Appointments Management:** `src/app/api/patients/[patientId]/appointments/` handles appointment history, patient cancellation, and refund processing through centralized state machine validation.
- **Bank Details:** `src/app/api/user/[userId]/bank-details/route.ts` manages patient bank account details for refund processing with IDOR authorization checks.

### 3.2 Doctor Module
- **Onboarding & Profile:** `src/app/api/doctor/route.ts`, `src/app/api/doctors/[doctorId]/route.ts` manages specialties, qualifications, fee structure, experience, bio, and clinic coordinates. PUT & PATCH endpoints enforce doctor session ownership.
- **Schedule Management:** `src/lib/scheduleUtils.ts`, `src/app/api/doctors/[doctorId]/schedule/` maintains weekly schedule templates and generates 30-minute date-specific slots.
- **Leave System:** `src/app/api/doctors/[doctorId]/leave/route.ts` supports date-range leaves, automatically transitioning overlapping slots to `ON_LEAVE` and auto-cancelling/refunding overlapping patient appointments via state machine transitions.
- **Earnings & Balance Ledger:** `Doctor.balance` stores accumulated earnings in paise. Completed appointments credit `Doctor.fees * 100` paise atomically.
- **Withdrawals:** `src/app/api/doctors/[doctorId]/withdrawals/route.ts` allows doctors to request payouts against their available balance with atomic decrementing and double-spend protection inside `prisma.$transaction`.

### 3.3 Admin Module
- **Hierarchy & Moderation:** `src/app/api/admin/onboarding/route.ts`, `src/app/api/admin/users/route.ts`, `src/app/api/admin/doctors/route.ts` enables Super Admin and Sub-Admin creation, user/doctor account activation/deactivation.
  - **Super Admin Architectural Model:** In the database schema, Super Admin is represented as `User.role == 'ADMIN'` where the corresponding `Admin` record has `managerId == null`. Sub-admins have `Admin.managerId != null` referencing their creator.
- **Financial Oversight:** `src/app/api/admin/withdrawals/route.ts` allows processing withdrawal requests (`PENDING` -> `PROCESSING` -> `COMPLETED` / `FAILED`).
- **Audit & Access Observability:** `src/app/api/admin/logs/route.ts`, `src/lib/logger.ts` logs structured access events and sensitive domain state changes with role, action, and IP metadata. Features cursor pagination (`cursor`, `nextCursor`), safe limit capping (max 100), date-range filtering, and session `scope=my`.

### 3.4 Infrastructure & Real-Time Socket Server
- **Database:** Neon PostgreSQL with Prisma 7 ORM (`prisma/schema.prisma`).
- **Distributed Cache & Locking:** Upstash Redis with resilient PostgreSQL fallback for slot holding and rate-limiting.
- **Socket Server (`socket-server/`):** Standalone Socket.IO service featuring:
  - Cryptographic HMAC-SHA256 handshake verification using shared `JWT_SECRET`.
  - Identity binding strictly to verified token claims (`userId`, `role`).
  - Relation access verification before joining `relation_${relationId}` rooms.
  - Private notification room isolation (`user_${verifiedUserId}`).

---

## 4. Database Invariants & Integrity Analysis

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
| **Slot Hold Token & Expiry** | `Slot.holdToken String?`, `Slot.holdExpiresAt DateTime?` | Hardened | Persisted in DB for hold ownership verification on Redis eviction |
| **Access & Audit Indexes** | Compound indexes on `createdAt`, `userId`, `tag` | Hardened | Sub-millisecond log querying and filtering |

---

## 5. Booking Concurrency & Failure Recovery (Scenarios A through K)

- **Scenario A (Happy Path Online):** Patient holds slot -> Redis lock acquired / DB hold token saved -> Order created -> Razorpay payment verified -> Slot `BOOKED` -> Appointment `CONFIRMED` -> Doctor balance untouched -> Relation & Chat created.
- **Scenario B (Happy Path Offline):** Patient holds slot -> Books OFFLINE -> Slot `BOOKED` -> Appointment `PENDING` -> Doctor manually confirms -> Appointment `CONFIRMED`.
- **Scenario C (Slot Hold Contention):** Two patients attempt holding the same slot simultaneously. First acquires atomic Redis lock/DB update; second receives `409 Conflict: Slot is already on hold`.
- **Scenario D (Hold TTL Expiration):** Patient holds slot but does not complete checkout within 10 minutes. Slot hold expires (`holdExpiresAt <= now`); background cron or subsequent requests release slot back to `AVAILABLE`.
- **Scenario E (Payment Failure / Abandonment):** Patient closes Razorpay modal or payment fails. Slot hold expires cleanly after TTL, allowing other patients to book.
- **Scenario F (Late Payment Verification After Expiry / Loss):** Payment succeeds on Razorpay gateway after local hold TTL expired and slot was booked by another patient. `verifyOrder` catches missing appointment/slot booking failure, initiates deterministic Razorpay refund compensation, sets status to `REFUND_PENDING`/`REFUNDED`, and returns explicit recoverable error.
- **Scenario G (Doctor Absence / No-Show):** Doctor misses appointment without completing it. Background cron identifies past unfulfilled appointments, transitions them to `EXPIRED`, and refunds online payments.
- **Scenario H (Doctor Applies Leave Over Existing Bookings):** Overlapping appointments are automatically cancelled and marked `CANCELLED_BY_DOCTOR` with automatic full refund initiated.
- **Scenario I (Patient Cancels Confirmed Appointment):** Slot restored to `AVAILABLE`, appointment marked `CANCELLED` via state machine, automated refund initiated if paid online.
- **Scenario J (Withdrawal Double-Spend Race):** Two concurrent withdrawal requests for doctor balance. Executed in atomic `prisma.$transaction` with conditional update; second request fails with `400 Insufficient Balance`.
- **Scenario K (Socket Disconnect During Chat):** Socket connection drops; messages persist reliably in PostgreSQL via REST/Socket fallback and synchronize on reconnect.

---

## 6. Socket.IO Security & Attack Scenarios

The standalone Socket server (`socket-server/server.ts`) was audited and tested against 8 explicit attack and misuse scenarios in `socket-server/__tests__/socketServer.integration.test.ts`:

1. **Connection without token:** Connection rejected with `Authentication error: Token required`.
2. **Connection with forged / tampered token:** Connection rejected with `Authentication error: Invalid or expired token`.
3. **Connection with expired token:** Connection rejected with `Authentication error: Invalid or expired token`.
4. **Client-controlled handshake spoofing:** Handshake attempt with `auth: { userId: 'victim_user', token: 'attacker_token' }` ignores spoofed payload; identity is strictly derived from verified token.
5. **Unauthorized relation join:** User A attempting to join `join_relation` for relation between Doctor B and Patient C receives `error: Unauthorized to join this relation room`.
6. **Valid member relation join:** Doctor/patient belonging to the relation successfully joins `relation_${relationId}` room.
7. **Message spoofing:** Messages emitted over socket have sender identity forced to verified `socket.data.userId`.
8. **Notification room eavesdropping:** Client cannot join arbitrary user notification rooms; server binds sockets only to `user_${verifiedUserId}`.
