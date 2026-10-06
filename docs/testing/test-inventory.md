# Quick-Clinic Test Inventory & Coverage Map

## 1. Test Suite Summary & True Categorization Breakdown

The test suite across `Quick-Clinic` and `socket-server` has been classified according to true execution and verification categories:

| Category | Description | Primary Test Locations | Execution Target | Count |
| :--- | :--- | :--- | :--- | :--- |
| **UNIT** | Isolated function testing without external I/O (pure state machines, coordinate math, formatters) | `src/__tests__/unit/`<br>`src/__tests__/lib/appointment-state-machine.test.ts` | Memory | 35 |
| **COMPONENT** | React DOM component rendering, user interactions, and visual states | `src/__tests__/components/`<br>`src/components/**/__tests__/` | jsdom | 45 |
| **MOCKED API** | Next.js API route handlers using mocked Prisma / Redis / Razorpay clients | `src/__tests__/api/appointments/phase67-race-conditions.test.ts`<br>`src/__tests__/api/**/mocked-*.test.ts` | Vitest Mocks | 120 |
| **REAL DB INTEGRATION** | End-to-end route and service execution against PostgreSQL database | `src/__tests__/api/appointments/phase22-doctor-cancellation.test.ts`<br>`src/__tests__/api/appointments/phase23-rescheduling.test.ts`<br>`src/__tests__/api/appointments/phase24-appointment-completion.test.ts`<br>`src/__tests__/api/appointments/phase25-patient-no-show.test.ts`<br>`src/__tests__/api/appointments/phase26-doctor-no-show.test.ts`<br>`src/__tests__/api/appointments/phase39-financial-idempotency.test.ts` | PostgreSQL | 280 |
| **REAL SOCKET INTEGRATION** | Standalone Socket.IO server testing with live network handshake and event emissions | `socket-server/__tests__/socketServer.integration.test.ts`<br>`src/__tests__/socket/phase66-notifications-socket-integration.test.ts` | Standalone Socket Server | 25 |
| **SECURITY & IDOR** | Cryptographic token attacks, cross-tenant resource tampering, and RBAC privilege escalation | `src/__tests__/security/part1b-security-hardening.test.ts`<br>`src/__tests__/api/admin/phase56-idor-security.test.ts`<br>`socket-server/__tests__/socketServer.integration.test.ts` (Attack suite) | DB & Sockets | 65 |
| **CONCURRENCY & RACES** | Atomic transactions, double-spend withdrawal contention, and simultaneous slot hold races | `src/__tests__/api/appointments/phase67-race-conditions.test.ts`<br>`src/__tests__/api/doctors/phase43-withdrawal-concurrency.test.ts`<br>`src/__tests__/security/part1b-security-hardening.test.ts` | Redis / DB Transactions | 30 |
| **STATIC / META / SCHEMA** | TypeScript types, ESLint rules, Prisma schema validation, and config checking | `src/__tests__/static/`<br>`commands.md` validation | tsc / eslint | 31 |

---

## 2. Inventory by Domain & Phase

### 2.1 Authentication & User Lifecycle
- `src/__tests__/api/user/signup.test.ts`: User registration, password hashing, email format validation.
- `src/__tests__/api/user/login.test.ts`: Credentials verification, JWT cookie issuance, role assignment.
- `src/__tests__/api/user/otp.test.ts`: 6-digit OTP generation, delivery, verification, single-use enforcement.
- `src/__tests__/api/user/phase7-email-otp.test.ts`: Edge cases for expired and invalid OTP tokens.
- `src/__tests__/api/user/password.test.ts`: Password change, current password validation, reset flows.
- `src/__tests__/api/user/profile.test.ts`: User profile retrieval, partial updates, IDOR isolation.
- `src/__tests__/api/user/phase57-inactive-accounts.test.ts`: Inactive user login rejection and authorization blocks.
- `src/__tests__/api/user/phase69-user-deactivation.test.ts`: Account deactivation with clinical audit retention.

### 2.2 Doctor Onboarding, Profile & Schedule
- `src/__tests__/api/doctors/phase8-doctor-onboarding.test.ts`: Profile creation, specialties, qualifications, coordinates validation.
- `src/__tests__/api/doctors/phase11-doctor-profile.test.ts`: Public profile sanitization, sensitive data masking.
- `src/__tests__/api/doctors/phase12-doctor-schedule.test.ts`: Weekly schedule templates and day-slot population.
- `src/__tests__/api/doctors/phase13-slot-generation.test.ts`: 30-minute slot math, non-working days, duplicate prevention.
- `src/__tests__/api/doctors/phase14-doctor-leave.test.ts`: Leave application, overlapping slot locking, appointment cascade.
- `src/__tests__/api/doctors/phase30-doctor-daily-schedule.test.ts`: Multi-view calendar engine (day/week/month).
- `src/__tests__/api/doctors/phase36-ratings.test.ts`: Rating aggregation, verified patient eligibility, idempotency.
- `src/__tests__/api/doctors/phase37-comments.test.ts`: Patient review comments and moderation.

### 2.3 Patient Onboarding & Doctor Discovery
- `src/__tests__/api/patients/phase9-patient-onboarding.test.ts`: Patient medical history, allergies, emergency contacts.
- `src/__tests__/api/doctors/phase15-appointment-search.test.ts`: Multi-criteria search, distance sorting, past slot filtering.
- `src/__tests__/api/patients/crud.test.ts`: Patient CRUD operations and session verification.
- `src/__tests__/api/patients/stats.test.ts`: Patient dashboard metrics and appointment counters.

### 2.4 Booking, Concurrency & State Machine
- `src/__tests__/security/part1b-security-hardening.test.ts`: Slot hold persistence (`holdToken`, `holdExpiresAt`), DB ownership proof, hold cancellation.
- `src/__tests__/api/appointments/holds.test.ts`: Slot hold creation, Redis TTL enforcement, hold token verification.
- `src/__tests__/api/appointments/phase67-race-conditions.test.ts`: Concurrent slot booking race conditions.
- `src/__tests__/lib/appointment-state-machine.test.ts`: Complete appointment status transition validation.
- `src/__tests__/api/appointments/phase74-appointment-matrix.test.ts`: ONLINE vs OFFLINE state transitions and side effects.
- `src/__tests__/api/appointments/phase25-patient-no-show.test.ts`: Patient NO_SHOW handling and slot consumption.
- `src/__tests__/api/appointments/phase26-doctor-no-show.test.ts`: Doctor absence auto-expiration and refund triggering.
- `src/__tests__/api/cron/phase27-appointment-expiration.test.ts`: Midnight cron job appointment expiration and batch processing.

### 2.5 Payments, Balances & Withdrawals
- `src/__tests__/api/user/payments.test.ts`: Razorpay order creation, server-side amount calculation, HMAC verification.
- `src/__tests__/api/user/phase58-payment-security.test.ts`: Payment secrets non-exposure and transaction integrity.
- `src/__tests__/api/appointments/phase39-financial-idempotency.test.ts`: Balance crediting determinism, OFFLINE completion balance preservation, idempotent duplicates.
- `src/__tests__/api/doctors/phase40-bank-accounts.test.ts`: Doctor bank details validation and IDOR protection.
- `src/__tests__/api/doctors/phase41-withdrawal-requests.test.ts`: Payout requests, balance checks, atomic decrements.
- `src/__tests__/api/doctors/phase43-withdrawal-concurrency.test.ts`: Double-spend withdrawal race protection.
- `src/__tests__/api/doctors/phase44-withdrawal-failure.test.ts`: Failed withdrawal balance restoration.
- `src/__tests__/api/doctors/phase59-doctor-balance-integrity.test.ts`: Mathematical balance invariant (fee in rupees * 100 = paise).

### 2.6 Admin, RBAC & Observability
- `src/__tests__/security/part1b-security-hardening.test.ts`: Cursor pagination (`nextCursor`), safe limits, session `scope=my` filtering.
- `src/__tests__/api/admin/phase46-admin-auth-rbac.test.ts`: Admin route RBAC protection.
- `src/__tests__/api/admin/phase47-admin-user-management.test.ts`: Admin user management and deactivation.
- `src/__tests__/api/admin/phase48-admin-doctor-management.test.ts`: Doctor verification, activation, and deactivation.
- `src/__tests__/api/admin/phase49-admin-appointment-management.test.ts`: Global appointment querying and management.
- `src/__tests__/api/admin/phase50-admin-withdrawal-management.test.ts`: Admin payout approval, rejection, and processing.
- `src/__tests__/api/admin/phase51-audit-logs.test.ts`: Audit log retrieval and action tracking.
- `src/__tests__/api/admin/phase52-access-logs.test.ts`: Access log indexing and response time metrics.
- `src/__tests__/api/admin/phase53-log-visibility.test.ts`: Scope-based log visibility.
- `src/__tests__/api/admin/phase54-admin-hierarchy.test.ts`: Super Admin and Sub-Admin onboarding and relationships.
- `src/__tests__/api/admin/phase55-access-control-matrix.test.ts`: Formal RBAC matrix verification across all endpoints.
- `src/__tests__/api/admin/phase56-idor-security.test.ts`: Cross-tenant IDOR attack penetration suite.
- `src/__tests__/api/admin/phase77-admin-logs-filtering.test.ts`: Compound filtering on logs (date, user, action).

### 2.7 Real-Time Sockets & Communication
- `socket-server/__tests__/socketServer.integration.test.ts`: Cryptographic JWT authentication, 8 attack tests, room isolation, message broadcasting.
- `socket-server/__tests__/part2-phase5-socket-deep.test.ts`: Real Socket.IO deep server testing, token verification, and chat room isolation.
- `src/__tests__/socket/socketServer.test.ts`: Socket authentication middleware, room joining, chat broadcast.
- `src/__tests__/socket/phase66-notifications-socket-integration.test.ts`: Multi-channel notification delivery.
- `src/__tests__/api/chats/phase34-chat-history.test.ts`: Chat pagination, timestamp sorting, relation isolation.
- `src/__tests__/api/phase31-doctor-patient-relations.test.ts`: Relationship creation, idempotency, and room binding.

### 2.8 Part 2 Deep Integration & Concurrency Load Invariants
- `src/__tests__/integration/part2-phase1-environment-data.test.ts`: Multi-tenant realistic database dataset seeding (Admins, 6 Doctors, 8 Patients) with scoped teardown.
- `src/__tests__/api/doctors/part2-phase2-doctor-deep.test.ts`: Doctor deep testing (Onboarding, Profiles, Schedule, Leave Cascade, State Transitions, Balance Invariants, Withdrawals).
- `src/__tests__/api/patients/part2-phase3-patient-golden-flows.test.ts`: Patient golden paths (Offline/Online booking, Hold, Rescheduling, Cancellation, Ratings).
- `src/__tests__/api/doctors/part2-phase4-search-filters.test.ts`: Doctor multi-parameter filter matrix (specialty, fees, experience, gender, coordinates).
- `src/__tests__/api/admin/part2-phase6-admin-deep.test.ts`: Admin operations, moderation, audit, and withdrawal processing.
- `src/__tests__/concurrency/part2-slot-contention-load.test.ts`: 20-thread slot contention race condition invariant test (1 winner, 19 conflicts).
- `src/__tests__/concurrency/part2-earnings-concurrency-load.test.ts`: Multi-appointment completion earnings credit determinism and idempotency invariant test.
- `src/__tests__/concurrency/part2-withdrawal-concurrency-load.test.ts`: Parallel withdrawal overdraft prevention invariant test.
- `tests/load/*`: k6 load testing scripts for search baseline, slot contention, earnings concurrency, and withdrawals.


## Fixture ownership and verification

Run database tests against an explicitly configured isolated PostgreSQL database with the Prisma schema applied, using the commands in `commands.md`. `src/__tests__/setup.ts` clears mocks but does not reset the database. `fileParallelism: false` serializes files; it does not isolate their records. `src/lib/test-db.ts` is a development inspection script, not test setup.

Database suites must create their own users and dependent records and remove only those records in teardown, including after assertion failures. Login fixtures use known hashed passwords and explicit role profiles. Shared canonical locations may be connected without changing their fields or deleting them. Guard cleanup against undefined IDs, since omitted Prisma filters can match unrelated records. UUID email/run identifiers prevent accidental collisions across suite reloads; factory defaults still allow explicit overrides.

The security and financial regression suites enforce JWT verification, resource ownership, masked bank responses, deterministic log pagination, payment/refund replay protection, single-winner slot holds, integer-paise credits and withdrawal balance reservation. See the corresponding test files above and `src/__tests__/security/part1c-payment-refund-idempotency.test.ts`, `src/__tests__/api/admin/part1c-admin-logs-pagination.test.ts`, and `src/__tests__/api/doctors/part1c-withdrawal-lifecycle-masking.test.ts` for executable assertions. Historical pass counts, security scan outputs and latency measurements are temporary run artifacts, not a production-readiness guarantee. Keep the ZAP configuration and load scripts; regenerate their outputs when needed and remove them after review.

The live synthetic RAG lifecycle is opt-in via `RUN_SEARCH_SPHERE_INTEGRATION=1`; actual Cohere calls additionally require `RUN_SEARCH_SPHERE_COHERE_SMOKE=1` and private service/provider credentials. A skipped live test does not verify ingestion, retrieval or generation.

`GET /api/doctors` keeps its existing response contracts: queries without coordinates return a doctor array; queries with valid latitude/longitude return `{ doctors, distanceUnavailable }`, sorted by distance when coordinates are available. The phase 10 search tests cover both forms. Consumers must normalize these forms rather than assume every response is an array.
