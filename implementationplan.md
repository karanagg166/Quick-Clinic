# Quick-Clinic Complete Testing Architecture & Full-System Lifecycle

You are working on the Quick-Clinic repository.

Your objective is to build a production-quality automated testing architecture covering all important Quick-Clinic functionality across:

* patients
* doctors
* admins
* authentication
* onboarding
* doctor discovery
* search/filter/sort
* schedules
* availability
* leaves
* slots
* appointment booking
* online payment
* offline payment
* appointment cancellation
* rescheduling
* completion
* no-show
* expiration
* refunds if implemented
* doctor earnings
* doctor balances
* bank accounts
* doctor withdrawals
* payout processing
* patient financial flows where implemented
* doctor-patient relationships
* Socket.IO chat
* notifications
* ratings
* comments/reviews
* audit logs
* access logs
* authorization
* security
* frontend UI
* API behavior
* database integrity
* concurrency
* E2E browser flows
* cleanup

Do not immediately start writing tests.

First inspect the repository completely.

Do not assume any endpoint, route, model, field, component, business rule, status transition, payment rule, Socket.IO event, or authorization rule.

The repository is the source of truth.

Do not change working product behavior merely to satisfy tests.

Do not write placeholder tests for test-count or coverage inflation.

---

# Phase 0 — Repository Investigation

Before modifying anything inspect:

* `AGENTS.md`
* `commands.md`
* root `package.json`
* root lockfile
* `socket-server/package.json`
* socket-server lockfile
* `.env.example`
* Docker configuration
* root Dockerfile(s)
* Docker Compose files
* Vitest configuration
* Playwright configuration
* existing tests
* `src/__tests__/`
* existing integration tests
* existing socket tests
* existing E2E tests
* Prisma schema
* Prisma migrations
* Prisma utilities
* authentication
* NextAuth configuration
* role authorization
* API routes
* Server Actions if used
* patient pages
* doctor pages
* admin pages
* scheduling implementation
* slot generation
* slot-hold implementation
* appointment services
* payment implementation
* Razorpay integration
* withdrawal implementation
* bank-account implementation
* doctor earnings calculations
* Socket.IO server
* Socket.IO client
* doctor-patient relation creation
* notifications
* ratings
* comments
* audit logs
* access logs
* Redis usage
* email/OTP flows
* timezone logic
* background jobs
* cron/scheduled tasks if any

Create a feature-to-file map before implementation.

For every requested feature classify it as:

* fully implemented
* partially implemented
* scaffolded
* not implemented
* deprecated

Tests must reflect actual functionality.

If a requested scenario is not implemented, report it rather than manufacturing business behavior.

---

# Phase 1 — Respect Quick-Clinic Repository Shape

Quick-Clinic has two independent packages.

Root:

* Next.js
* React
* TypeScript
* Prisma
* NextAuth
* PostgreSQL
* Redis
* payment integration
* frontend + API

Socket server:

* separate package
* Socket.IO
* separate package.json
* separate lockfile
* separate tests/build

Do not treat Quick-Clinic as a pnpm workspace.

Before running commands inspect `commands.md`.

Use pnpm only.

Follow Docker execution rules from `AGENTS.md`.

Do not silently run host commands if project rules require container execution.

---

# Phase 2 — Testing Layers

Build a clear testing pyramid.

Use these conceptual levels.

## A. Unit tests

Test isolated business logic.

Examples:

* validation
* status-transition rules
* slot calculations
* schedule calculations
* fee calculations
* payment amount calculations
* balance calculations
* withdrawal eligibility
* appointment eligibility
* cancellation eligibility
* no-show logic
* rescheduling logic
* filters
* sorting
* access decisions
* audit-event construction
* notification construction
* chat authorization helpers
* rating validation
* timezone calculations

No browser or real network required.

---

## B. Component tests

Test frontend behavior using the existing:

* Vitest
* React Testing Library
* user-event
* MSW

Prioritize:

* registration forms
* login forms
* doctor onboarding
* patient onboarding
* doctor search
* doctor filters
* doctor cards
* appointment calendar
* slot selection
* payment-method selection
* booking confirmation
* cancellation dialog
* rescheduling
* doctor schedule editor
* leave editor
* appointments lists
* doctor earnings page
* withdrawals page
* bank-account form
* chat UI
* notifications
* ratings/comments
* admin tables
* audit logs
* access logs

Test user-observable behavior rather than implementation details.

---

## C. API integration tests

Test:

request → authentication → authorization → application logic → Prisma → PostgreSQL → response.

Use a real test PostgreSQL database.

Do not mock Prisma for important integration paths.

---

## D. Socket integration tests

Use the standalone Socket.IO server package.

Test real Socket.IO clients against a test Socket.IO server.

Use its existing:

* Vitest
* socket.io-client
* Supertest

where suitable.

---

## E. Database integrity tests

Test:

* unique constraints
* foreign keys
* cascades
* transaction behavior
* race conditions
* consistent slot state
* appointment consistency
* financial consistency

---

## F. Browser E2E

Use Playwright.

Test a running:

* Next.js app
* PostgreSQL testing DB
* Redis testing instance
* Socket.IO test server

Use realistic browser flows.

Do not duplicate every backend edge case in Playwright.

---

# Phase 3 — Dedicated Testing Environment

Never run destructive tests against development, staging, or production data.

Create or verify a dedicated testing database.

Conceptually:

`quick_clinic_test`

Use the real Prisma schema/migrations.

Tests must abort when the database is not clearly identified as a test database.

Also isolate:

* Redis
* Socket.IO environment
* test payment configuration

Never call real Razorpay charge/payout operations during automated tests.

Use test/sandbox interfaces or controlled mocks at the external-provider boundary.

The application-internal payment/withdrawal code should still be tested.

Testing environment lifecycle:

1. start services
2. safety-check DB
3. apply Prisma schema/migrations
4. clear test data
5. initialize required reference data
6. execute tests
7. cleanup
8. verify no leaked data

Repeated execution must produce the same outcome.

---

# Phase 4 — Test Factories and Fixtures

Do not create all data manually inside every test.

Create reusable deterministic factories/builders for actual Prisma models.

Conceptually include:

* user
* patient
* doctor
* admin
* location
* doctor qualification
* schedule
* leave
* slot
* appointment
* doctor-patient relation
* chat message
* notification
* payment
* withdrawal
* bank account
* rating
* comment
* audit log
* access log

Allow overrides.

Examples conceptually:

* create verified doctor with CARDIOLOGIST specialty
* create patient in specific city
* create doctor with ₹800 fees
* create doctor with a specific weekly schedule
* create available appointment slot
* create confirmed online appointment
* create completed offline appointment
* create doctor with withdrawable balance

Keep important identities deterministic.

Use unique generated values for database uniqueness.

---

# Phase 5 — Canonical Golden Dataset

Create several dedicated test users.

Do not rely on manually existing accounts.

Suggested logical identities:

Doctors:

* doctor_test1
* doctor_test2
* doctor_test3
* doctor_test4
* doctor_test5
* doctor_test6

Patients:

* patient_test1
* patient_test2
* patient_test3
* patient_test4
* patient_test5
* patient_test6
* patient_test7
* patient_test8

Admins:

* admin_test1
* admin_test2

Use proper testing emails based on repository conventions.

Use test-only credentials from environment/config fixtures.

Do not commit real credentials.

Doctors should intentionally differ.

For example:

Doctor 1:

* cardiologist
* low fee
* high experience
* online + offline appointments if supported
* strong availability

Doctor 2:

* dermatologist
* medium fee
* limited availability

Doctor 3:

* general physician
* low experience
* low fees

Doctor 4:

* orthopedic
* high fees
* partial week schedule

Doctor 5:

* psychiatrist
* leave scheduled

Doctor 6:

* another specialty
* no available slots on selected dates

Use different:

* pincodes
* cities
* specialties
* qualifications
* fees
* experiences
* ratings
* schedule availability

This allows search/filter testing.

---

# Phase 6 — Authentication & Signup

Test Doctor registration.

Test Patient registration.

Test Admin authentication/creation according to actual product rules.

For each supported signup flow test:

* valid signup
* duplicate email
* invalid email
* weak password
* incorrect password confirmation if applicable
* invalid age
* impossible age
* invalid phone number
* duplicate phone if uniqueness applies
* invalid pincode
* unsupported location
* missing name
* whitespace
* oversized fields
* malformed body
* unexpected fields
* attempted role escalation

Critical:

A patient must not be able to submit `role=ADMIN`.

A doctor must not elevate themselves to admin.

Verify server-side enforcement.

---

# Phase 7 — Email Verification / OTP

If account verification uses OTP, test:

* correct OTP
* incorrect OTP
* expired OTP
* reused OTP
* mismatched account
* multiple requests
* newest OTP versus old OTP
* missing OTP
* malformed OTP
* rate limiting if implemented

Verify OTP is not logged in AuditLog or AccessLog unless intentionally masked.

Verify OTP records expire/are deleted according to application behavior.

---

# Phase 8 — Doctor Onboarding

Create several doctors.

Exercise:

* specialty
* qualifications
* experience
* fees
* doctor bio
* location
* profile image where supported
* bank account later
* schedule later

Test invalid:

* unsupported specialty
* duplicate qualification
* negative experience
* excessive experience
* negative fee
* unreasonable fee boundaries
* malformed geo coordinates
* invalid profile input

Verify persisted Doctor and User records.

Verify role remains DOCTOR.

---

# Phase 9 — Patient Onboarding

Create several patients.

Exercise:

* demographics
* address
* pincode
* medical history
* allergies
* current medications

Test:

* empty optional information
* very long text
* malformed fields
* unauthorized modification of another patient's record

Patients may only update information allowed by the actual application.

---

# Phase 10 — Doctor Search

Use several different patients to search doctors.

Test exact application filters.

At minimum inspect whether these exist:

* specialty
* location
* pincode
* distance
* fee range
* qualification
* experience
* availability
* rating
* name

Test each implemented filter independently.

Then combined filters.

Examples:

specialty + location

specialty + fees

location + experience

specialty + experience + fees

availability + date

rating + specialty

Test sorting options where supported:

* fee low to high
* fee high to low
* experience
* rating
* distance
* relevance

Verify:

* pagination
* empty results
* invalid page
* invalid sort
* malformed filters
* impossible price range
* invalid specialty

Make sure doctor private information is not leaked.

---

# Phase 11 — Doctor Profile Visibility

Patients inspect doctor profile.

Verify allowed information:

* name
* specialty
* qualification
* experience
* fee
* biography
* rating
* comments
* availability

according to product design.

Do NOT expose:

* doctor password
* authentication secrets
* private bank details
* full bank account number
* payout IDs unnecessarily
* internal balance details if patient shouldn't see them
* private audit logs

Test direct API access too.

---

# Phase 12 — Doctor Schedule

Each doctor configures a schedule.

Use varied schedules.

Examples:

Doctor 1:
Monday-Friday normal hours.

Doctor 2:
selected weekdays.

Doctor 3:
morning-only.

Doctor 4:
evening-only.

Doctor 5:
weekends.

Test:

* valid weekly schedule
* overlapping intervals
* duplicate intervals
* start after end
* zero-length availability
* invalid weekday
* malformed JSON
* timezone boundaries
* changing schedule
* removing working day
* updating schedule with future appointments

Important:

Existing booked appointments must remain consistent when schedule changes according to business rules.

---

# Phase 13 — Slot Generation

Inspect how Quick-Clinic creates slots.

Test:

* generation from weekly schedule
* correct start/end times
* duplicate prevention
* multiple doctors
* timezone correctness
* DST assumptions if relevant
* already-booked slots
* unavailable slots
* cancelled slots
* leave overlap

Verify Prisma uniqueness constraints are respected.

---

# Phase 14 — Doctor Leave

Doctors create leaves.

Test:

* one-day leave
* multi-day leave
* future leave
* overlapping leave
* duplicate leave
* invalid date range
* past leave
* leave overlapping booked appointments

Determine actual product rule for existing appointments during newly added leave.

Test expected behavior.

Verify affected future availability.

---

# Phase 15 — Appointment Search

Patients look for appointments with doctors.

Test:

* available date
* unavailable date
* doctor on leave
* fully booked doctor
* future availability
* past dates
* current day
* timezone boundary
* wrong doctor ID
* inactive doctor

Ensure held/booked slots are not presented incorrectly as available.

---

# Phase 16 — Slot Hold / Concurrency

Quick-Clinic has slot states such as:

* AVAILABLE
* HELD
* BOOKED
* UNAVAILABLE
* CANCELLED
* ON_LEAVE

Test the actual slot-hold mechanism.

Scenario:

Patient A selects a slot.

Slot becomes held where supported.

Patient B attempts same slot.

Expected:
Patient B must not successfully book the same slot.

Test:

* valid hold
* hold expiration
* same patient retry
* second patient conflict
* stale hold
* abandoned checkout
* payment failure after hold
* simultaneous hold requests

This must include concurrency testing.

A doctor's slot must never produce two active appointments.

---

# Phase 17 — Offline Appointment Booking

Patient 1 books Doctor 1 using OFFLINE payment.

Verify:

* correct patient
* correct doctor
* correct slot
* correct appointment mode
* correct paymentMethod
* correct appointment status
* slot no longer available
* correct notification
* expected logs

Test:

* duplicate booking
* already booked slot
* past slot
* unavailable slot
* doctor on leave
* wrong doctor
* wrong patient
* unauthorized booking for another patient
* forged price
* forged doctor fee
* malformed slot
* patient trying to directly set appointment COMPLETED

Server must derive trusted fields.

Do not trust client-provided doctor fee or status.

---

# Phase 18 — Online Appointment Booking

Patient 2 books Doctor 1 using ONLINE payment.

Test the real internal Razorpay workflow while mocking/sandboxing external provider interactions.

Test:

* order creation
* correct amount
* correct currency
* order association with patient/doctor/slot
* payment success
* payment verification
* invalid signature
* wrong amount
* wrong order ID
* duplicated payment webhook/callback
* reused payment ID
* abandoned payment
* payment failure
* timeout
* slot released after payment failure/expiration

Never call production Razorpay.

Financial tests should use deterministic external-provider responses.

---

# Phase 19 — Appointment Status Lifecycle

Explicitly test allowed state transitions.

Existing schema includes statuses such as:

* PENDING
* CONFIRMED
* COMPLETED
* CANCELLED
* NO_SHOW
* RESCHEDULED
* EXPIRED

Build a transition matrix from real application logic.

For each transition test:

* allowed actor
* disallowed actor
* correct timing
* database state
* slot state
* payment implications
* notifications
* audit log
* access log

Do not allow arbitrary transitions just because an enum exists.

---

# Phase 20 — Appointment Confirmation

If doctor confirmation is required, test:

* doctor confirms own appointment
* unrelated doctor cannot confirm
* patient cannot confirm if not allowed
* admin behavior according to product rules
* duplicate confirm
* confirm cancelled appointment
* confirm expired appointment

---

# Phase 21 — Appointment Cancellation by Patient

Patient cancels future appointment.

Test:

* valid cancellation
* cancellation before permitted cutoff
* cancellation at exact cutoff
* cancellation after cutoff
* cancelling completed appointment
* cancelling NO_SHOW appointment
* cancelling someone else's appointment
* duplicate cancellation

Verify:

* appointment status
* slot release
* payment/refund behavior if implemented
* doctor balance behavior
* notifications
* logs

---

# Phase 22 — Appointment Cancellation by Doctor

Doctor cancels appointment.

Test:

* doctor cancelling own appointment
* other doctor attempting cancellation
* cancellation reason if implemented
* cancellation near appointment time
* cancellation after appointment completion
* bulk impact if doctor adds leave

Verify patient notification.

Verify financial implications.

---

# Phase 23 — Appointment Rescheduling

Patient and/or doctor reschedules according to real product permissions.

Test:

* available target slot
* already-booked target
* same slot
* past slot
* doctor on leave
* rescheduling cancelled appointment
* rescheduling completed appointment
* concurrent booking of target slot

Verify:

* old slot state
* new slot state
* appointment status/history behavior
* payment association
* notifications
* logs

---

# Phase 24 — Appointment Completion

Doctor marks appointment completed where permitted.

Test:

* valid completion after/at appointment time
* early completion
* unrelated doctor
* patient trying to complete
* completed twice
* cancelled appointment
* no-show appointment

This is a critical financial event.

Verify doctor earnings/balance update exactly once.

Duplicate completion must not credit doctor twice.

---

# Phase 25 — Patient No-Show

Test NO_SHOW.

Scenario:

Patient books appointment but never attends.

Authorized doctor/system marks it NO_SHOW according to real rules.

Test:

* before appointment time
* after appointment window
* unrelated doctor
* patient self-mark
* already completed
* already cancelled
* duplicate NO_SHOW

Verify financial treatment.

For ONLINE payment, determine whether doctor retains fee, partial fee, refund occurs, or another rule.

Do not invent policy.

Test whatever actual application implements.

---

# Phase 26 — Doctor No-Show

Determine whether doctor no-show exists explicitly.

If implemented test it.

If no explicit status exists, identify this as an uncovered product capability rather than pretending `NO_SHOW` represents both sides.

If doctor fails to attend, verify intended cancellation/refund/admin behavior if such functionality exists.

---

# Phase 27 — Appointment Expiration

Test appointments that are never confirmed or never completed and become expired if this behavior exists.

Test exact time boundary.

Do not use long sleeps.

Use fake timers or controlled clock abstractions where suitable.

---

# Phase 28 — Patient Appointment Pages

Test patient appointment views.

Verify categories:

* upcoming
* pending
* confirmed
* completed
* cancelled
* rescheduled
* no-show
* expired

according to actual UI.

Test filters:

* doctor
* date
* status
* payment method
* online/offline
* date range

Test sorting:

* newest
* oldest
* appointment time

Test pagination.

Verify Patient A cannot see Patient B appointments through API manipulation.

---

# Phase 29 — Doctor Appointment Pages

Test doctor's schedule/appointment management pages.

Doctor should see only their own appointment scope.

Test:

* today
* upcoming
* completed
* cancelled
* no-show
* pending
* date range
* patient search
* appointment status
* payment method

Verify direct API isolation between doctors.

Doctor 1 must not query Doctor 2 private appointments just by changing IDs.

---

# Phase 30 — Doctor Daily Schedule Page

Test schedule page behavior.

Verify:

* today's slots
* booked appointments
* open slots
* held slots
* unavailable slots
* leave days
* past slots
* current slot
* future slots

Test different date selections.

Test timezone handling thoroughly using project timezone conventions.

Verify UI and backend show matching appointment time.

---

# Phase 31 — Doctor–Patient Relationship

Inspect when a `DoctorPatientRelation` is created.

Determine whether it happens:

* at booking
* after confirmation
* after completion
* after first message
* via another flow

Test exact behavior.

Ensure duplicate relationships are prevented.

Patient must not arbitrarily create relationship with any doctor if business rules forbid it.

---

# Phase 32 — Socket.IO Chat Authorization

Use the actual standalone `socket-server/`.

Create Doctor 1 ↔ Patient 1 authorized relation.

Test realtime messaging.

Verify:

* doctor connects authenticated
* patient connects authenticated
* unauthorized connection
* invalid user identity
* Patient 1 joins correct relation
* Doctor 1 joins correct relation
* Patient 2 cannot join Patient 1 relation
* Doctor 2 cannot join Doctor 1 relation
* admin access only if explicitly supported

Never trust room IDs supplied by client without authorization verification.

---

# Phase 33 — Socket.IO Messaging

Test:

Patient 1 sends Doctor 1 message.

Doctor receives it.

Doctor replies.

Patient receives it.

Verify message persisted to database.

Test:

* empty message
* whitespace-only
* oversized message
* unauthorized sender
* forged senderId
* forged relationId
* duplicate event
* rapid messages
* reconnect
* disconnection
* multiple tabs
* messages while recipient offline
* retrieving conversation after reconnect
* ordering
* timestamps

Database is source of truth.

A lost Socket.IO event must not cause persistent message loss if the request was accepted.

---

# Phase 34 — Chat History

Verify both authorized participants can load history.

Test:

* ordering
* pagination if implemented
* empty conversation
* long conversation
* unauthorized relation
* deleted/inactive users where applicable

Doctor cannot read another doctor's conversation.

Patient cannot read another patient's conversation.

Admin access must follow explicit product rules.

---

# Phase 35 — Notifications

Test notification creation for implemented events.

Possible events:

* appointment booked
* appointment confirmed
* appointment cancelled
* rescheduled
* doctor cancellation
* appointment reminder
* chat message
* withdrawal update
* payment update

Verify:

* correct recipient
* correct actionHref
* unread state
* marking read
* duplicate handling
* unauthorized reading

Patient 1 cannot read Patient 2 notifications.

Doctor 1 cannot read Doctor 2 notifications.

---

# Phase 36 — Ratings

After eligible appointment completion, patient rates doctor if application permits.

Test:

* rating 1
* rating 5
* invalid 0
* invalid 6
* non-integer if disallowed
* duplicate rating
* update rating if supported
* rating doctor never visited
* rating before completed appointment

Existing schema permits one rating per patient/doctor pair.

Test whether product business rules add additional eligibility constraints.

Verify doctor aggregate rating calculation if implemented.

---

# Phase 37 — Comments / Reviews

Test doctor comments/reviews.

Verify:

* valid comment
* empty comment
* huge comment
* duplicate behavior
* editing if supported
* deleting if supported
* unauthorized patient
* review before appointment completion

Verify XSS-safe rendering in frontend.

Do not rely solely on UI sanitization.

---

# Phase 38 — Doctor Earnings

Inspect actual earnings calculation and UI.

Create multiple appointments.

Examples:

Appointment A:
offline + completed.

Appointment B:
online + completed.

Appointment C:
cancelled.

Appointment D:
no-show.

Appointment E:
future confirmed.

Appointment F:
payment failed.

Determine which affect doctor earnings.

Verify exact expected balances.

Do not assume cancelled/no-show rules.

Use business implementation as source of truth.

Test:

* total earnings
* available balance
* pending earnings if supported
* withdrawn amount
* date filters
* appointment filters
* online/offline breakdown
* pagination where relevant

Doctor 1 cannot view Doctor 2 financial information.

Patient cannot view doctor earnings.

---

# Phase 39 — Financial Idempotency

Critical test:

Mark same appointment completed twice or receive duplicate payment webhook.

Doctor balance must be credited only once.

Also test:

* duplicate Razorpay callback
* duplicate payout callback
* retrying server requests
* concurrent completion requests

Financial state must remain deterministic.

---

# Phase 40 — Bank Accounts

Doctor adds bank account.

Test:

* valid account
* invalid account number
* invalid IFSC
* empty account holder
* duplicate account number
* editing if supported
* removing if supported
* multiple accounts if supported
* unauthorized patient trying to add doctor bank account

Protect sensitive fields.

Do not expose full account details in unrelated APIs/logs.

Patient should never see bank data.

---

# Phase 41 — Doctor Withdrawal Requests

Doctor with positive eligible balance requests withdrawal.

Use multiple scenarios.

Doctor 1:
sufficient balance.

Doctor 2:
zero balance.

Doctor 3:
balance below minimum if minimum exists.

Doctor 4:
no bank account.

Test:

* valid withdrawal
* full balance withdrawal
* partial withdrawal
* amount zero
* negative amount
* amount greater than balance
* decimal/invalid amount
* malformed payload
* no bank account
* inactive doctor
* duplicate submission

Amounts must follow repository currency representation.

Existing schema comments indicate withdrawal amount is stored in paise; verify all UI/API conversions carefully.

---

# Phase 42 — Withdrawal State Lifecycle

Schema includes:

* PENDING
* PROCESSING
* COMPLETED
* FAILED
* CANCELLED

Build transition tests based on actual application rules.

Test admin/system processing.

Verify:

* PENDING → PROCESSING
* PROCESSING → COMPLETED
* PROCESSING → FAILED
* cancellation if implemented

Test illegal transitions.

---

# Phase 43 — Withdrawal Concurrency

Critical financial scenario:

Doctor balance = X.

Doctor sends two simultaneous withdrawals each close to X.

The application must not allow total withdrawal to exceed available balance.

Test using real DB transactions/concurrent requests.

Verify final:

* doctor balance
* withdrawal records
* statuses

No double spend.

---

# Phase 44 — Withdrawal Failure

Simulate provider payout failure.

Verify:

* withdrawal FAILED
* failure reason stored if supported
* balance restored/reserved correctly
* notification
* audit log

Retry according to actual product rules.

---

# Phase 45 — Patient Withdrawal / Refund Scenario

The Prisma schema currently has withdrawals directly associated with Doctor.

Do not assume patient withdrawals exist.

Inspect product behavior.

If patients have refund/credit/wallet functionality elsewhere, test it.

If patient withdrawal does not exist, report:

"Patient withdrawal is not currently a modeled feature."

Do not create patient-withdrawal architecture just because it was requested.

For patients, test appropriate refund flows from cancelled ONLINE appointments if implemented.

---

# Phase 46 — Admin Authentication and RBAC

Create admin fixtures according to real admin provisioning.

Test:

* admin login
* non-admin access to admin routes
* patient accessing admin API
* doctor accessing admin API
* forged ADMIN role
* expired session
* inactive admin

Never rely on frontend route hiding.

Test backend authorization directly.

---

# Phase 47 — Admin User Management

Inspect actual admin features.

For implemented functionality test:

* list doctors
* list patients
* search users
* filter role
* filter active status
* view doctor profile
* view patient profile where allowed
* activate/deactivate users
* pagination
* sorting

Verify admin actions generate audit logs where intended.

---

# Phase 48 — Admin Doctor Management

If admin can moderate doctors:

Test:

* viewing doctor
* disabling doctor
* enabling doctor
* consequences for future booking
* existing appointment handling
* financial data visibility
* withdrawal processing

Do not invent verification/approval features unless implemented.

---

# Phase 49 — Admin Appointment Management

If admin can inspect/manage appointments test:

* search appointment
* doctor filter
* patient filter
* status
* date range
* online/offline
* transaction/payment filter

Admin should not arbitrarily alter medically/business-critical status unless product explicitly allows it.

---

# Phase 50 — Admin Withdrawal Management

If admin processes withdrawals test:

* pending withdrawals
* processing
* completion
* failure
* cancellation
* filtering by doctor
* filtering by status
* date filtering
* amount sorting

Test authorization carefully.

Each financial mutation must create appropriate audit records.

---

# Phase 51 — Audit Logs

Quick-Clinic has AuditLog.

Inspect every actual use.

Ensure important mutations generate logs where expected.

Candidates:

* user registration
* verification
* login security events
* role changes
* profile changes
* doctor schedule changes
* leave creation
* appointment booking
* confirmation
* cancellation
* reschedule
* completion
* no-show
* payment success/failure
* bank account changes
* withdrawal request
* withdrawal processing
* user activation/deactivation
* admin-sensitive actions

Verify audit log fields according to actual schema:

* user
* action
* tag
* metadata
* created time

Never log:

* password
* OTP
* session token
* access token
* full bank account
* Razorpay secret
* private auth secrets

---

# Phase 52 — Access Logs

Quick-Clinic has AccessLog.

Determine intended difference between AccessLog and AuditLog.

Test access logging according to actual design.

Possible events:

* sensitive page access
* appointment access
* profile access
* admin access
* financial page access
* audit-log access

Verify:

* actor
* target
* action
* tag
* timestamp

Do not create uncontrolled high-volume logs if product does not intend that.

---

# Phase 53 — Log Visibility

Build access-control tests.

Patient:

* should not access system audit logs unless product explicitly permits limited own history.

Doctor:

* should not access global audit logs.

Admin:

* can access logs according to actual admin permission rules.

If application has admin hierarchy, respect manager/sub-admin scope.

Test direct API manipulation.

---

# Phase 54 — Admin Hierarchy

The schema supports an Admin hierarchy.

Inspect actual implementation.

If implemented, test:

* manager
* sub-admin
* permitted scopes
* restricted operations
* access-log visibility
* audit-log visibility
* user management
* withdrawal management

If not exposed yet, mark as schema capability only.

---

# Phase 55 — Access Control Matrix

Create a formal matrix covering:

| Resource | Patient | Doctor | Admin |

Include actual supported operations for:

* users
* patient profile
* doctor profile
* schedules
* leaves
* appointments
* payments
* bank accounts
* withdrawals
* chat
* notifications
* ratings
* comments
* audit logs
* access logs

Test every important denial at API level.

---

# Phase 56 — IDOR Tests

Perform local test-environment authorization tests.

Examples:

Patient A changes appointment ID to Patient B appointment.

Patient A changes patientId.

Doctor A requests Doctor B appointment.

Doctor A requests Doctor B earnings.

Doctor A requests Doctor B withdrawals.

Patient tries Doctor bank API.

Doctor tries admin log API.

Patient tries another chat relation.

Admin role forged in request body.

Every sensitive route must reject horizontal or vertical privilege escalation.

---

# Phase 57 — Inactive Accounts

Mark doctors/patients inactive where feature exists.

Verify inactive user cannot:

* authenticate if intended
* book appointment
* modify schedule
* send chat messages
* withdraw funds
* execute privileged APIs

Determine existing appointment behavior.

---

# Phase 58 — Payment Data Security

Inspect all payment responses.

Ensure clients do not receive unnecessary secrets.

Test:

* forged order amount
* forged doctorId
* forged patientId
* forged slotId
* mismatched payment/order
* duplicate payment ID
* webhook replay
* invalid signature

Amounts must be calculated server-side.

---

# Phase 59 — Doctor Balance Integrity

Construct financial invariant tests.

For example:

total eligible credited earnings
minus completed withdrawals
minus reserved withdrawals
plus reversed failed withdrawals

must equal expected available balance according to real business rules.

Test across many operations.

---

# Phase 60 — Timezone Testing

Quick-Clinic has dedicated timezone handling documentation.

Inspect it.

Test:

* stored appointment time
* displayed appointment time
* slot generation
* schedule creation
* server timezone
* browser timezone
* cross-midnight appointment
* date filters
* leave dates

Use deterministic time.

Avoid arbitrary sleeps.

---

# Phase 61 — Search Edge Cases

Doctor search should be tested with:

* capitalization
* partial names
* special characters
* leading/trailing spaces
* no match
* many matches
* same specialty
* same fee
* same experience
* pagination boundaries

Ensure deterministic sorting when values tie.

---

# Phase 62 — Rating/Search Integration

If doctor search supports ratings:

Create doctors with various ratings.

Verify:

* rating calculation
* sorting
* filtering
* unrated doctor behavior

Do not seed aggregate rating independently unless the application stores it that way.

Generate source ratings through fixtures.

---

# Phase 63 — Schedule/Search Integration

Doctor search with availability must reflect:

* weekly schedule
* leave
* booked slots
* unavailable slots
* held slots

A doctor who has a schedule but no free slot for selected date should not be represented as available if product promises slot availability.

---

# Phase 64 — Appointment/Chat Integration

Determine when patient becomes allowed to chat.

Test:

Before valid relationship:
chat denied.

After required appointment state:
chat allowed.

After cancelled appointment:
test product rule.

After completed appointment:
test product rule.

Do not assume relationships automatically expire.

---

# Phase 65 — Appointment/Rating Integration

Verify only eligible patients can rate/comment according to actual business rules.

If completed appointment is required, test it explicitly.

---

# Phase 66 — Notifications/Socket Integration

If chat notifications and Socket.IO coexist:

Test online recipient.

Test offline recipient.

Ensure persistent Notification is available if designed.

Test reconnect.

Avoid duplicate notification on Socket retries.

---

# Phase 67 — Race Conditions

Add integration tests for:

* two patients booking same slot
* payment completing while hold expires
* cancellation while payment finalizes
* rescheduling target slot race
* two completion requests
* two no-show requests
* duplicate payment webhook
* duplicate payout webhook
* simultaneous withdrawal
* schedule modification while booking
* doctor leave while patient booking

Assert database invariants after each race.

---

# Phase 68 — Database Integrity

Test Prisma constraints from actual schema.

Important examples include:

* User email unique
* doctor user unique
* patient user unique
* schedule per doctor unique
* doctor qualification uniqueness
* slot uniqueness
* one appointment per slot
* doctor-patient relation uniqueness
* Payment razorpayOrderId uniqueness
* bank account number uniqueness
* OTP uniqueness
* one rating per doctor/patient pair

Verify cascading behavior intentionally.

---

# Phase 69 — User Deletion / Deactivation

Determine whether Quick-Clinic deletes or deactivates accounts.

Test real behavior.

Consider:

* appointments
* chats
* payments
* withdrawals
* audit logs
* access logs
* ratings

Financial/audit data should not accidentally disappear when legal/business rules require retention.

Do not modify retention policy in tests.

---

# Phase 70 — Frontend Patient E2E

Create Playwright flow.

Patient registers.

Completes profile.

Searches doctors.

Uses multiple filters.

Views Doctor 1.

Checks schedule.

Selects slot.

Books OFFLINE appointment.

Verifies appointment page.

Chats with doctor if permitted.

Cancels/reschedules another appointment.

Books ONLINE appointment.

Completes sandbox/mock payment.

Views notifications.

Views appointment history.

Rates/comments after eligible completion.

---

# Phase 71 — Frontend Doctor E2E

Doctor registers.

Completes onboarding.

Configures specialties/qualifications/profile.

Sets weekly schedule.

Adds leave.

Views appointments.

Filters appointments.

Confirms appointment.

Chats with patient.

Completes appointment.

Marks another eligible appointment NO_SHOW.

Views earnings.

Adds bank account.

Requests withdrawal.

Views withdrawal state.

Views notifications.

---

# Phase 72 — Frontend Admin E2E

Admin logs in.

Views admin dashboard.

Searches patients.

Searches doctors.

Filters users.

Views appointments.

Processes or reviews withdrawals where implemented.

Views Audit Logs.

Views Access Logs.

Tests restricted actions.

Admin must not see secrets.

---

# Phase 73 — Full Golden Lifecycle

Build one large but controlled golden-path scenario.

Create Doctor 1–6.

Create Patient 1–8.

Create Admin 1.

Doctors complete onboarding.

Give doctors different:

* specialties
* qualifications
* experience
* fees
* locations
* schedules
* leave days

Patients search doctors using varied filters.

Patient 1 books Doctor 1 OFFLINE.

Patient 2 books Doctor 1 ONLINE.

Patient 3 attempts same booked slot and is rejected.

Patient 4 books Doctor 2.

Patient 5 books Doctor 3.

Patient 6 books Doctor 4.

Use enough appointments for lifecycle diversity.

Then create outcomes:

Appointment A:
confirmed → completed.

Appointment B:
confirmed → patient cancelled.

Appointment C:
doctor cancelled.

Appointment D:
rescheduled → completed.

Appointment E:
patient NO_SHOW.

Appointment F:
expires if supported.

Appointment G:
online payment failure.

Appointment H:
online payment success.

Verify every state transition.

Doctor ↔ Patient chat occurs for authorized relations.

Test unauthorized chat relationships.

Completed patients rate/comment doctors.

Doctors inspect appointment pages.

Doctors inspect schedule pages.

Doctors inspect earnings.

Doctor 1 adds bank account.

Doctor 1 requests valid withdrawal.

Doctor 2 attempts over-balance withdrawal and fails.

Doctor 3 attempts withdrawal without bank account and fails.

Admin reviews withdrawal.

Progress withdrawal through permitted statuses.

Verify balances before and after processing.

Verify payout failure scenario separately.

Verify Notifications.

Verify AuditLogs.

Verify AccessLogs.

Verify patient cannot see Doctor earnings.

Verify doctor cannot see another Doctor earnings.

Verify patient cannot see another Patient appointments.

Verify Doctor 1 cannot access Doctor 2 chat.

Verify Patient 1 cannot access Patient 2 chat.

Verify non-admin cannot access logs.

Finally clean the test DB.

---

# Phase 74 — Offline vs Online Appointment Matrix

Create explicit matrix:

OFFLINE + completed

OFFLINE + cancelled by patient

OFFLINE + cancelled by doctor

OFFLINE + no-show

ONLINE + completed

ONLINE + cancelled by patient

ONLINE + cancelled by doctor

ONLINE + no-show

ONLINE + payment failed

ONLINE + payment abandoned

ONLINE + rescheduled

For each verify:

* appointment status
* slot status
* Payment record
* doctor earnings
* doctor balance
* refund behavior
* notification
* logs

Do not assume financial policy.

Read implementation.

---

# Phase 75 — Doctor Earnings Filters

Test actual earnings-page filters.

Potential dimensions where implemented:

* today
* week
* month
* custom range
* appointment
* patient
* payment method
* status

Verify totals mathematically.

Verify displayed values match DB-derived expected values.

---

# Phase 76 — Withdrawals Page

Doctor views withdrawal history.

Test:

* pending
* processing
* completed
* failed
* cancelled
* date filter
* pagination
* sorting

Verify another doctor cannot query these records.

---

# Phase 77 — Admin Logs Filtering

If log UI supports filtering, test:

* actor
* action
* tag
* date range
* target
* user role

Test pagination/sorting.

Large datasets must not break the page.

---

# Phase 78 — Resilience

Test controlled dependency failures where reasonable.

Examples:

* Redis unavailable
* Socket server unavailable
* payment provider unavailable
* email provider unavailable
* DB transaction rollback

Application should fail safely.

Appointment booking must not leave permanently inconsistent slot/payment state after partial failure.

---

# Phase 79 — Redis

Inspect every Redis use.

Test actual use cases only.

Possible areas:

* rate limiting
* caching
* sessions
* socket coordination
* temporary holds

Test:

* key expiry
* stale value
* unavailable Redis
* duplicate operation
* reconnect

PostgreSQL should remain source of persistent truth unless architecture intentionally differs.

---

# Phase 80 — Email

If booking/payment/withdrawal emails exist:

Test email generation/service boundary without sending real production email.

Verify recipients.

Verify no secrets.

Test external email failure does not corrupt appointment state.

---

# Phase 81 — Accessibility

For critical Playwright workflows consider axe integration.

Test major:

* form labels
* dialogs
* buttons
* appointment calendar
* doctor search
* payment form
* chat
* admin tables

Only add the dependency if needed and compatible.

---

# Phase 82 — Cross-Browser

Run main E2E on Chromium.

Run a selected critical subset on:

* Firefox
* WebKit

Do not unnecessarily multiply every expensive E2E case.

---

# Phase 83 — Coverage

Use existing Vitest coverage.

Root and socket-server should have separate useful coverage reporting.

Prioritize near-complete coverage for:

* appointment state transitions
* slot concurrency
* financial calculations
* withdrawals
* RBAC
* chat authorization

Do not chase arbitrary 100% cosmetic coverage.

---

# Phase 84 — CI

Inspect existing GitHub Actions first.

Design stages conceptually:

Fast:

* lint
* type-check
* unit
* component

Integration:

* PostgreSQL
* Redis
* API integration
* database integrity

Socket:

* Socket.IO package tests

E2E:

* root app
* DB
* Redis
* socket server
* Playwright

Financial external providers must run mocked/sandboxed.

Upload useful artifacts on failure:

* Playwright trace
* screenshots
* coverage
* relevant logs

Never upload secrets.

---

# Phase 85 — Dependency Policy

Do not replace existing frameworks.

Keep:

* Vitest
* Testing Library
* MSW
* Playwright
* Socket.IO testing stack

Evaluate additions only if genuinely useful.

Potential:

* `@faker-js/faker`
* `fast-check` for property-based TypeScript testing
* `@axe-core/playwright`

Possibly a PostgreSQL testcontainer solution only if it fits Docker/project conventions better than existing Docker Compose.

Do not add Jest.

Do not add Cypress unless there is an extraordinary reason.

Do not create redundant testing frameworks.

---

# Phase 86 — Cleanup

Use isolated DB reset as primary cleanup.

Do not depend only on browser deletion flows.

Every suite must be rerunnable.

Tests must not destroy:

* development DB
* production DB
* real Razorpay data
* real Cloudinary files
* real email data

Create safeguards.

---

# Phase 87 — Final Required Validation

Before completion run repository-approved commands from `commands.md`.

Verify:

* root unit tests pass
* frontend component tests pass
* API integration tests pass
* DB tests pass
* socket-server unit tests pass
* socket integration tests pass
* Playwright flows pass
* financial tests pass
* authorization tests pass
* golden lifecycle passes
* cleanup passes
* lint passes
* type-check passes
* builds pass

Repeat important integration/E2E suites to expose hidden order dependence.

---

# Phase 88 — Final Report

Produce a detailed final report.

## Existing Testing

Explain what was present before modifications.

## Testing Architecture

Explain test layers.

## Test Environment

Explain PostgreSQL/Redis/Socket isolation.

## Dependencies

List existing libraries and newly added libraries with reason.

## Patient Coverage

List patient features and status.

## Doctor Coverage

List doctor features and status.

## Admin Coverage

List admin features and status.

## Appointments

Summarize online/offline and every tested lifecycle.

## Search

List supported filters/sorts tested.

## Scheduling

Summarize schedules/leaves/slots.

## Chat

Summarize Socket.IO authorization and realtime tests.

## Payments

Summarize payment cases.

## Earnings

Summarize doctor balance/earnings verification.

## Withdrawals

Summarize withdrawal and payout scenarios.

## Notifications

Summarize covered events.

## Ratings/Comments

Summarize eligibility/security.

## Audit Logs

Summarize operations captured.

## Access Logs

Summarize accesses captured.

## Authorization

Provide Patient/Doctor/Admin matrix.

## Security

Summarize IDOR/privilege tests.

## Concurrency

Summarize slot/payment/withdrawal races.

## Coverage

Report root and socket-server coverage.

## Bugs Found

Separate real application bugs from testing infrastructure issues.

## Features Not Implemented

Explicitly list requested features not actually present.

## Remaining Risks

Describe meaningful untested areas.

---

# Critical Rules

Never make a test pass by weakening application authorization.

Never alter business behavior without determining intended behavior.

Never trust frontend role checks.

Test backend authorization directly.

Never call production Razorpay.

Never process real payouts.

Never use real bank details.

Never send production emails.

Never use production or development database for destructive integration tests.

Never assume a patient's refund is equivalent to a doctor withdrawal.

Never assume `NO_SHOW` means doctor no-show and patient no-show.

Never assume chat becomes available merely because users know each other's IDs.

Never expose bank, payment, password, OTP, or auth secrets to logs.

Never allow duplicate appointment completion to duplicate doctor earnings.

Never allow concurrent withdrawals to exceed doctor balance.

Never allow two appointments to own the same slot.

Never allow another patient to view private appointment/chat information.

Never allow another doctor to view private earnings/withdrawals/chat information.

Never allow a patient or doctor to access global admin audit/access logs.

The goal is not simply a large number of tests.

The goal is to prove Quick-Clinic remains correct across the entire realistic lifecycle:

signup → onboarding → doctor search → schedule → availability → booking → payment → appointment → chat → completion/cancellation/no-show/reschedule → earnings → withdrawal → admin oversight → audit/access logs → cleanup.

Test both successful behavior and adversarial edge cases at every important boundary.
