We are continuing the existing Quick-Clinic testing/hardening project.

PART 1, PART 1B and PART 1C are complete.

Do NOT redo those audits from scratch.

Read first:

* `AGENTS.md`
* `commands.md`
* `docs/testing/PART1_CHECKPOINT.md`
* `docs/testing/PART1_AUDIT.md`
* `docs/testing/test-inventory.md`
* `docs/testing/HLD_FAILURE_SCENARIOS.md`
* root `package.json`
* `socket-server/package.json`
* `playwright.config.ts`
* `vitest.config.ts`
* `prisma/schema.prisma`

Then inspect production code before writing tests.

# PART 2 GOAL

Part 2 must validate Quick-Clinic like a real production healthcare system.

Focus on:

1. Complete functional testing
2. True browser E2E testing
3. Doctor feature coverage
4. Patient feature coverage
5. Admin feature coverage
6. Socket.IO real-time testing
7. Security testing
8. Load / latency / stress / spike / soak testing
9. Redis resilience
10. Database concurrency and performance
11. HLD failure scenarios
12. Accessibility
13. Browser compatibility
14. Production-readiness evidence

FREE TOOLS ONLY.

Do NOT introduce paid SaaS.

Preferred existing/free tools:

* Vitest
* Playwright
* Testing Library
* MSW
* k6 OSS
* OWASP ZAP
* pnpm audit
* Semgrep Community Edition if useful

Do not install Cypress/Jest merely to duplicate existing tools.

---

# IMPORTANT EXECUTION STRATEGY

Do not attempt everything at once.

Part 2 is divided into phases.

Complete each phase, record results, then continue.

Create:

`docs/testing/PART2_CHECKPOINT.md`

and continuously update it after every phase.

For each test classify it as:

* UNIT
* COMPONENT
* API INTEGRATION
* REAL DB INTEGRATION
* TRUE PLAYWRIGHT E2E
* REAL SOCKET INTEGRATION
* SECURITY
* LOAD
* STRESS
* SPIKE
* SOAK
* ACCESSIBILITY
* FAILURE/CHAOS

Do not mislabel tests.

---

# PHASE 1 — REALISTIC TEST ENVIRONMENT AND DATA

Before browser/load testing, build safe deterministic test data.

Never use production data.

Create or improve test factories/seeding for:

## Admins

* 1 Super Admin using existing architecture
* 2 normal/sub admins

## Doctors

Create at least 6 doctors with different:

* specialties
* gender
* locations
* experience
* fees
* ratings
* schedules
* qualifications
* balances

Example variety:

Doctor A:

* Cardiologist
* ₹500
* Delhi
* 10 years

Doctor B:

* Dermatologist
* ₹800
* Noida
* 5 years

Doctor C:

* General Physician
* ₹300
* Gurgaon

Doctor D:

* Pediatrician

Doctor E:

* Orthopedic

Doctor F:

* Psychiatrist

Create realistic weekly schedules.

Include:

* morning doctor
* evening doctor
* doctor working weekends
* doctor unavailable certain days
* doctor with leave
* doctor with no upcoming slots

## Patients

Create at least 8 patient accounts.

Use different:

* ages
* genders
* locations
* medical history
* allergies

Keep fixture data clearly marked TEST.

Generate unique run IDs.

Cleanup ONLY data created by that test run.

Never perform global destructive cleanup.

---

# PHASE 2 — DOCTOR FEATURE TESTING

THIS IS HIGH PRIORITY.

Previous coverage is not enough.

Validate every actual doctor-facing feature from UI + API + DB behavior.

# 2.1 Doctor onboarding

True browser E2E:

Doctor signs up.

Validate:

* valid signup
* duplicate email
* invalid password
* invalid email
* missing fields
* qualification selection
* multiple qualifications
* specialty
* fees
* experience
* address/location
* profile picture if supported
* email verification if required

Verify DB state.

---

# 2.2 Doctor profile

Doctor logs in and:

* views profile
* edits bio
* changes experience where allowed
* changes fee
* updates qualifications
* updates practice location
* changes profile image

Security:

Doctor A cannot modify Doctor B.

Patient cannot modify doctor private data.

---

# 2.3 DOCTOR SCHEDULE — DEEP TESTING

This was under-tested previously.

Test complete schedule lifecycle.

Doctor creates weekly schedule.

Example:

Monday:
09:00–13:00
14:00–17:00

Tuesday:
10:00–15:00

Wednesday:
OFF

Saturday:
09:00–12:00

Validate generated slots.

Check:

* first slot
* last slot
* slot duration
* lunch break
* no overlap
* no duplicate slot
* no slots on off-days
* no past slots
* timezone correctness
* month boundary
* year boundary

Modify schedule.

Check existing future slots update correctly according to current business rules.

Do not silently invalidate booked appointments.

Test concurrent schedule updates if possible.

---

# 2.4 DOCTOR LEAVE — DEEP FUNCTIONAL + HLD TESTING

This is a mandatory Part 2 focus area.

Test:

Doctor creates leave:

`2026-09-10 -> 2026-09-12`

Validate:

* leave record created
* schedule remains correct
* relevant future slots become ON_LEAVE/unavailable
* patient search no longer shows them

Boundary cases:

* one-day leave
* multi-day leave
* overlapping leave
* duplicate leave
* past leave
* start > end
* leave covering part of day if supported
* leave spanning month boundary
* leave spanning year boundary

## Leave with booked appointments

Create:

Patient A booked September 10 at 10:00.

Patient B booked September 11 at 11:00.

Then doctor applies leave covering both.

Validate actual business rules.

If system cancels them:

* appointment transitions legally
* slots become appropriate status
* patients receive durable Notification
* Socket.IO notification emitted if online
* online payment refund initiated
* offline appointment handled correctly
* audit log created

Ensure refund occurs exactly once.

## Leave race scenario

At the same time:

Doctor applies leave.

Patient attempts to hold/book a slot in that leave range.

Exactly one consistent outcome.

Never:

* confirmed appointment inside valid doctor leave
* payment captured for a slot that cannot be honored without compensation

## Leave removal

If leave cancellation/removal exists:

* future unbooked slots regenerate/become available correctly
* previous cancelled appointments must NOT magically re-confirm

Add:

* API integration
* real DB integration
* Playwright E2E
* concurrency tests

---

# 2.5 DOCTOR APPOINTMENTS

Test doctor dashboard appointment states:

* PENDING
* CONFIRMED
* COMPLETED
* CANCELLED
* NO_SHOW
* EXPIRED
* RESCHEDULED

Doctor:

* views appointment
* confirms offline booking if workflow requires
* cancels
* marks patient no-show
* completes appointment
* sees patient details where authorized

Validate appointment state-machine rules through true APIs.

Doctor A cannot mutate Doctor B's appointment.

---

# 2.6 DOCTOR EARNINGS — DEEP TESTING

THIS IS MANDATORY.

Trace how earnings are actually calculated.

Test exact financial invariant:

Doctor fees = ₹500.

Completed eligible appointment should credit:

`50000 paise`

Verify exactly WHEN earning is credited.

Not:

* at hold time
* at online payment order creation
* at PENDING
* accidentally twice

Test:

### Online appointment

payment successful
appointment confirmed
appointment completed

Expected balance increase exactly once.

### Offline appointment

Determine current business rule.

If doctor receives earnings for offline appointment, validate appropriate credit timing.

If not, document that.

### Cancelled appointment

Should not incorrectly credit earning.

### No-show

Determine business rule and test it.

### Expired appointment

No accidental credit.

### Duplicate completion request

Balance must increase ONCE.

### Concurrent completion requests

Two requests racing must credit ONCE.

### Retry after HTTP timeout

Must credit ONCE.

### Multiple appointments

Fees:

₹300
₹500
₹700

Correct total:

₹1500 / 150000 paise where applicable.

Test integer/paise arithmetic.

No floating-point money calculations.

---

# 2.7 DOCTOR EARNINGS PAGE / UI

True Playwright tests.

Doctor opens earnings page.

Verify:

* current balance
* total earnings
* completed appointment count
* date filters
* today
* week
* month
* custom range if available
* transaction/history rows
* empty state
* pagination if applicable

Doctor A must never see Doctor B earnings.

Check API and UI.

---

# 2.8 WITHDRAWALS

Continue Part 1C financial lifecycle verification.

Doctor balance:

₹10,000.

Test withdrawal:

₹500

Expected:

PENDING request.

Then admin processing:

PENDING -> PROCESSING -> COMPLETED

Also test:

PROCESSING -> FAILED

and balance restoration according to business rules.

Test:

* minimum amount
* zero
* negative
* decimals
* more than balance
* exact balance
* concurrent withdrawals
* repeated submit
* browser double-click
* admin duplicate processing
* failed payout retry
* bank details missing
* account masking

Audit log every important financial transition.

---

# PHASE 3 — PATIENT COMPLETE GOLDEN FLOWS

Create TRUE Playwright flows.

Do not substitute component rendering.

# Patient journey A — Offline booking

Patient:

1. signs up
2. verifies account
3. logs in
4. completes profile
5. searches doctors
6. filters doctors
7. opens doctor
8. views schedule
9. chooses slot
10. creates hold
11. selects OFFLINE
12. confirms booking
13. sees appointment
14. doctor receives notification
15. doctor confirms
16. patient receives notification
17. patient opens chat
18. patient and doctor exchange messages
19. appointment occurs
20. doctor completes it
21. patient rates doctor
22. patient comments
23. rating visible on doctor profile

Verify DB at critical stages.

---

# Patient journey B — Online booking

Repeat using Razorpay testing/mocked boundary safely.

Do NOT make real financial charges.

Validate:

* order creation
* server amount
* signature verification
* payment success
* appointment creation
* replay
* late verification
* refund path

---

# Patient journey C — Cancellation

Patient books.

Then cancels.

Validate:

* state transition
* slot behavior
* refund if online
* notifications
* doctor UI
* audit log

---

# Patient journey D — Reschedule

If supported:

Book Doctor A 10:00.

Reschedule to 11:00.

Validate:

* old slot
* new slot
* appointment state
* no duplicate appointments
* notifications
* payment behavior

---

# Patient journey E — No-show

Patient does not attend.

Doctor marks NO_SHOW where allowed.

Validate state and financial rules.

---

# PHASE 4 — DOCTOR SEARCH AND FILTER TESTING

Exercise all actual search filters.

Test:

* specialty
* doctor name
* fees min/max
* experience
* rating
* gender
* city
* pincode
* distance/location
* availability/date
* combinations of filters

Boundary cases:

* no matches
* whitespace
* case-insensitive
* special characters
* huge search string
* invalid range
* min > max
* exact boundary

Performance tests later must include search endpoints.

---

# PHASE 5 — CHAT + SOCKET.IO FULL FEATURE TESTING

Real Socket.IO server/client where possible.

Test:

Patient <-> Doctor conversation.

Features:

* initial messages
* pagination
* send message
* ordering
* typing
* reconnect
* duplicate browser tabs
* disconnect
* reconnect after socket server restart
* notifications
* multiple simultaneous chats

Security:

* Patient A cannot enter Patient B room
* Doctor A cannot enter Doctor B relation
* forged relationId
* expired token
* forged token
* missing token
* invalid token

Input abuse:

* empty message
* whitespace
* oversized message
* HTML
* script payload
* Unicode
* emoji

Ensure stored/displayed safely.

---

# PHASE 6 — ADMIN TRUE E2E

Admin browser flow:

1. login
2. dashboard
3. user list
4. doctor list
5. patient list
6. appointments
7. withdrawals
8. logs

Test:

* filters
* pagination
* search
* activate/deactivate account
* doctor actions
* withdrawal processing
* audit logs
* access logs

Verify every admin mutation creates appropriate audit evidence.

Sub-admin restrictions must be tested according to actual hierarchy.

---

# PHASE 7 — ACCESSIBILITY

Use free tooling.

Prefer Playwright + axe-core if adding axe is appropriate.

Test major pages:

* login
* signup
* patient dashboard
* doctor search
* doctor profile
* booking
* patient appointments
* doctor dashboard
* doctor schedule
* doctor leave
* doctor earnings
* admin dashboard

Check:

* labels
* semantic buttons
* headings
* keyboard navigation
* dialogs
* forms
* focus
* aria attributes
* obvious contrast violations detectable by tooling

Do not claim WCAG compliance merely because automated tests pass.

Report as:

`automated accessibility checks`

---

# PHASE 8 — TRUE CROSS-BROWSER PLAYWRIGHT

Configure/test:

* Chromium
* Firefox
* WebKit

Critical flows:

* auth
* doctor search
* booking
* appointments
* doctor schedule
* leave
* earnings
* chat basic connection where compatible

Also test:

* mobile viewport
* tablet viewport
* desktop

Check layout clipping and unusable controls.

---

# PHASE 9 — SECURITY DYNAMIC TESTING

FREE ONLY.

Use:

* OWASP ZAP
* pnpm audit
* Semgrep Community if useful

Run only against LOCAL/TEST environment.

Never actively scan unrelated production infrastructure.

Security categories:

## Auth

* brute-force protections
* session tampering
* expired tokens
* forged tokens

## Authorization

* IDOR
* vertical escalation
* horizontal escalation

## Input

* SQL-like payloads
* XSS strings
* malformed JSON
* oversized bodies
* parameter pollution

Prisma protects parameterization, but verify endpoint behavior.

## HTTP

Check:

* security headers
* CORS
* cookies
* HttpOnly
* Secure in production
* SameSite
* CSP if configured

## Sensitive data

Ensure APIs/logs do NOT leak:

* password hash
* OTP
* JWT secret/token
* bank full account
* Razorpay secret
* medical data to unauthorized users

Create:

`docs/testing/SECURITY_REPORT.md`

Categorize:

* Critical
* High
* Medium
* Low
* Informational

Do not blindly fix scanner false positives.

---

# PHASE 10 — LATENCY BASELINE

Use k6 OSS or another completely free load tool.

Create:

`tests/load/`

Define performance thresholds.

Do not invent impossible universal numbers.

Measure baseline locally/test environment first.

Key APIs:

* login
* doctor search
* doctor detail
* availability
* slot hold
* offline booking
* appointment listing
* notifications
* admin logs
* doctor earnings

Capture:

* p50
* p90
* p95
* p99
* error rate
* requests/sec

Example initial investigation thresholds:

Normal read APIs:
p95 < 500 ms

Important mutations:
p95 < 1000 ms

These are starting targets, not blindly asserted SLAs.

Document hardware/environment.

---

# PHASE 11 — LOAD TESTING

Start small.

Never overload Neon/Upstash/Vercel/Render production services.

Prefer local Docker/test services.

Scenarios:

## Read-heavy

50 virtual users:

doctor search
doctor detail
schedule/availability

## Mixed workflow

20 users:

login
search
view
appointments

## Booking

Simulated multiple patients booking DIFFERENT slots.

Measure DB/Redis behavior.

---

# PHASE 12 — BOOKING CONTENTION LOAD

Critical scenario:

100 simulated users target SAME slot.

Expected:

exactly ONE successful hold.

99 conflict/failure responses.

No:

* duplicate appointment
* duplicate payment context
* corrupted slot

Repeat multiple iterations.

Then test 100 users across 20 slots.

Measure lock contention.

---

# PHASE 13 — DOCTOR EARNINGS CONCURRENCY LOAD

This is mandatory.

Generate multiple appointments for same doctor.

Simultaneously mark multiple valid appointments completed.

Expected final balance:

exact mathematical sum of eligible appointment fees.

Then repeatedly send duplicate completion requests.

Expected:

NO duplicate credits.

Example:

100 completed appointments × ₹500

Expected:

₹50,000

or `5,000,000 paise`.

Validate DB exactly.

---

# PHASE 14 — WITHDRAWAL LOAD / RACE

Doctor balance:

₹100,000.

Send many concurrent withdrawal requests.

Total successful reserved amount must NEVER exceed balance.

Test:

* 10 parallel requests
* 50 parallel requests
* repeated identical client submissions

Validate balance + withdrawals mathematically.

---

# PHASE 15 — SOCKET.IO LOAD TESTING

Use a FREE approach.

Could use:

* k6 WebSocket capabilities if compatible
* custom Node Socket.IO load runner

Do not install paid services.

Test:

* 10 clients
* 50 clients
* 100 clients
* increase cautiously

Measure:

* connection success
* auth failures
* message delivery
* latency
* disconnects
* reconnect behavior

Simulate multiple independent doctor-patient rooms.

Ensure no cross-room messages.

---

# PHASE 16 — REDIS FAILURE TESTING

Test HLD cases.

Redis:

## healthy

Normal hold.

## unavailable before hold

DB correctness fallback.

## unavailable after lock acquisition

No permanent ghost lock.

## timeout/slow

API must not hang indefinitely.

## key eviction

DB token remains authoritative.

## restart

Existing durable holds behave according to DB expiration.

Create automated failure-injection tests where safe.

---

# PHASE 17 — DATABASE FAILURE / STRESS

Test controlled local/test Postgres conditions where feasible.

Scenarios:

* temporary disconnect
* query timeout
* transaction failure
* duplicate request retry
* connection pool pressure

Core invariants must survive.

Especially:

* booking
* appointment
* doctor earnings
* withdrawal

No partial financial corruption.

---

# PHASE 18 — SPIKE TEST

Traffic pattern:

5 VUs
-> sudden 100 VUs
-> back to 5

Test read endpoints first.

Then controlled booking/search combination.

Record:

* latency spike
* error rate
* recovery

---

# PHASE 19 — SOAK TEST

Keep lightweight enough for local/free environment.

Example:

10–20 VUs for 20–30 minutes.

Focus:

* doctor search
* appointment list
* notifications

Watch:

* memory
* CPU
* connection count
* error accumulation
* latency degradation

Do NOT run multi-hour expensive tests unless explicitly justified.

---

# PHASE 20 — HLD FAILURE MATRIX

Validate and update:

`docs/testing/HLD_FAILURE_SCENARIOS.md`

Add runtime evidence for:

* Redis failure
* DB failure
* Socket failure
* email failure
* Razorpay failure
* Cloudinary failure
* cron failure
* concurrent booking
* concurrent leave + booking
* concurrent completion/earnings
* concurrent withdrawals
* duplicate HTTP retries
* server restart

For each:

Current implementation
Test performed
Observed behavior
Expected behavior
PASS/FAIL
Recommended production architecture

---

# PHASE 21 — OBSERVABILITY VALIDATION

Verify admin can actually use logs.

Create user journey:

Patient books appointment.

Expected logs should let admin trace:

* user
* booking/hold action
* payment action if applicable
* appointment creation
* cancellation/status changes

Doctor applies leave.

Admin should see:

* doctor
* leave action
* affected appointments where appropriate

Withdrawal:

* request
* processing
* completion/failure

Security events:

* failed auth
* invalid payment signature
* unauthorized socket access where logging is appropriate

Do NOT put sensitive values into logs.

---

# PHASE 22 — DOCTOR DASHBOARD COMPLETE FEATURE CHECK

This is mandatory.

Perform a final manual + automated feature inventory of the doctor experience.

Check every accessible doctor page/button/navigation route.

At minimum:

* dashboard
* appointments
* appointment detail
* schedule
* slots/calendar
* leave
* patients
* patient details
* chat
* notifications
* profile
* ratings/reviews
* earnings
* bank account
* withdrawals
* withdrawal history

For each feature classify:

IMPLEMENTED + WORKING
IMPLEMENTED + BUG
PARTIAL
MISSING

Do not assume feature completeness because API exists.

Validate frontend wiring.

Create:

`docs/testing/DOCTOR_FEATURE_AUDIT.md`

---

# PHASE 23 — PATIENT FEATURE CHECK

Same inventory:

* dashboard
* doctor search
* filters
* doctor profile
* schedule
* slot hold
* online booking
* offline booking
* appointment history
* cancellation
* rescheduling
* chat
* notifications
* ratings
* comments
* profile
* medical information
* payment states

Create:

`docs/testing/PATIENT_FEATURE_AUDIT.md`

---

# PHASE 24 — ADMIN FEATURE CHECK

Audit:

* dashboard
* doctors
* patients/users
* appointments
* withdrawals
* logs
* filtering
* pagination
* hierarchy
* activate/deactivate

Create:

`docs/testing/ADMIN_FEATURE_AUDIT.md`

---

# PHASE 25 — BUG FIX POLICY

When tests uncover bugs:

1. reproduce with failing test
2. record root cause
3. fix smallest correct implementation
4. run regression test
5. run related suite
6. update Part 2 checkpoint

Do not:

* delete tests
* weaken assertions
* hide failures
* change business behavior merely to satisfy a test

If behavior is ambiguous, infer from existing architecture/documentation and record the decision.

---

# REQUIRED PART 2 OUTPUTS

Create/update:

`docs/testing/PART2_CHECKPOINT.md`

`docs/testing/PART2_FINAL_REPORT.md`

`docs/testing/SECURITY_REPORT.md`

`docs/testing/PERFORMANCE_REPORT.md`

`docs/testing/DOCTOR_FEATURE_AUDIT.md`

`docs/testing/PATIENT_FEATURE_AUDIT.md`

`docs/testing/ADMIN_FEATURE_AUDIT.md`

Update:

`docs/testing/test-inventory.md`

`docs/testing/HLD_FAILURE_SCENARIOS.md`

---

# PERFORMANCE REPORT MUST INCLUDE

For each scenario:

* environment
* VUs
* duration
* total requests
* throughput
* p50
* p90
* p95
* p99
* error %
* pass/fail threshold
* bottleneck
* recommendation

Never claim production capacity based solely on a laptop/local test.

---

# FINAL PART 2 EXIT GATE

Do not declare Part 2 complete merely because tests pass.

Required:

## Functional

Patient golden flows PASS

Doctor golden flows PASS

Admin flows PASS

Doctor leave PASS

Doctor schedule PASS

Doctor earnings PASS

Withdrawals PASS

Chat PASS

Notifications PASS

Search/filter PASS

## Security

No unresolved Critical vulnerabilities.

No unresolved High authorization/payment vulnerabilities.

## Concurrency

Same-slot contention invariant PASS.

Doctor earning duplicate-credit invariant PASS.

Withdrawal overdraw invariant PASS.

Leave-vs-booking invariant PASS.

## Performance

Baseline recorded.

Load test recorded.

Spike test recorded.

Soak test recorded.

Socket load recorded.

No unexplained severe resource leak.

## E2E

True Playwright critical flows pass in Chromium.

Important flows tested in Firefox/WebKit where feasible.

## Quality

Typecheck PASS.

Lint PASS.

Relevant Vitest PASS.

No hidden skipped critical tests.

---

# FINAL OUTPUT FORMAT

When everything is complete output:

PART 2 RESULT

Functional:
Patient: PASS/FAIL
Doctor: PASS/FAIL
Doctor Leave: PASS/FAIL
Doctor Schedule: PASS/FAIL
Doctor Earnings: PASS/FAIL
Withdrawals: PASS/FAIL
Admin: PASS/FAIL
Chat/Socket: PASS/FAIL

Security:
Critical: X
High: X
Medium: X
Low: X

Performance:
Baseline: PASS/FAIL
Load: PASS/FAIL
Spike: PASS/FAIL
Soak: PASS/FAIL
Socket Load: PASS/FAIL

Concurrency:
Same Slot: PASS/FAIL
Leave vs Booking: PASS/FAIL
Earnings Double Credit: PASS/FAIL
Withdrawal Overdraw: PASS/FAIL

Playwright:
Chromium: PASS/FAIL
Firefox: PASS/FAIL/NOT RUN
WebKit: PASS/FAIL/NOT RUN

Typecheck: PASS/FAIL
Lint: PASS/FAIL
Vitest: X passed / X failed

Remaining P0:
Remaining P1:
Remaining P2:

Production-readiness assessment:
READY / READY WITH CONDITIONS / NOT READY

Then STOP.
