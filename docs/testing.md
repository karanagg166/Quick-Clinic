# Quick-Clinic verification

The frontend uses pnpm. The unified FastAPI and Socket.IO service uses uv. Write implementation and tests first, then run verification. Tests never use the ordinary configured Neon database. Test data is synthetic; payment, email, routing and private file providers are mocked.

## Feature coverage map

| Feature | Behavioral suites | Important boundaries |
| --- | --- | --- |
| Authentication | `backend/tests/unit/test_auth_security.py`, `features/test_auth_flows.py` | Signup, login, cookies, role changes, password changes/reset, OTP expiry, consumption, delivery failures |
| Accounts | `unit/test_account_validation.py`, `features/test_account_*.py` | Profile ownership, avatar URLs/uploads, bank details, notification visibility/read status |
| Patients | `features/test_patient_profiles.py`, `test_identity.py` | Profile validation, list/stats, relationship-based privacy |
| Administration | `unit/test_admin_log_parsing.py`, `features/test_admin_*.py`, `test_admin_logs.py` | Onboarding hierarchy, privileges, user management, audit/log filters, withdrawals and analytics |
| Doctors | `unit/test_doctor_routing.py`, `features/test_doctor_workflows.py`, `test_doctors.py` | Search, geographic fallback, reviews, earnings, balance, withdrawal ownership |
| Scheduling | `unit/test_schedule_contracts.py`, `features/test_schedule_workflows.py` | Local dates/time zones, interval validation, slots, leave, overview and ownership |
| Booking | `unit/test_booking_contracts.py`, `features/test_booking_http.py`, `test_booking.py` | Reservation ownership, expiry, confirmation, status changes and retry safety |
| Payments | `unit/test_payment_gateway.py`, `features/test_payment_http.py`, `integration/test_financial_*.py` | Provider request/response contracts, capture binding, ambiguity, refunds, reconciliation and idempotency |
| Operations | `features/test_operation_http.py`, `integration/test_financial_*.py`, `test_keep_alive.py` | Cron credentials, webhook signatures, retry/outbox leases, expiry and finite keepalive |
| Documents | `unit/test_document_validation.py`, `features/test_document_resilience.py`, `test_documents.py`, `unit/test_supabase_storage.py` | Content validation, private storage, quotas, filtering, compensating cleanup, patient ownership, eligible doctor access |
| Human messaging | `features/test_messaging_workflows.py`, `integration/test_realtime_contracts.py`, `test_realtime.py` | Membership, pagination, deduplication, read receipts, socket authentication/expiry/refresh and real wire protocol |
| Health and core | `unit/test_core.py`, `smoke/test_service.py`, `test_lifecycle.py` | UTC serialization, transaction commit/rollback/cancellation, startup/shutdown, liveness/readiness |
| Migration safety | `unit/test_migration_policy.py` | Positive fake-data evidence, protected document owners, exact references/cascades, fingerprint guards and slot repair |
| Cross-feature journey | `integration/test_clinic_journey.py` | Book → confirm → upload → authorized doctor download → message → cancel → revoke file access |

Paths in the table are relative to `backend/tests/` unless written in full. Retained HTTP methods and paths have an additional migration contract check in `test_contracts.py`. Route registration alone is not treated as behavioral coverage.

## Functional and nonfunctional layers

- **Unit:** pure logic, boundary values, provider contracts and property-based UTC roundtrips.
- **Feature:** requests cross actual FastAPI dependencies, validation, middleware, authorization, service and isolated SQL persistence.
- **Integration:** database/provider/realtime coordination and recovery. PostgreSQL races use independent connections to test holds, confirmation, refund singleton creation, duplicate messages and rollback.
- **Browser:** Chromium uses the actual Next.js proxy, Python service and a separate disposable PostgreSQL database. It checks failed login, successful login, private document upload/download/filter/delete and form accessibility with axe WCAG A rules. There are no mocked API routes in this suite.
- **Security:** JWT algorithms/audiences/expiry, role and object ownership, CORS, abuse limits, private caching, input redaction and removal of AI/static-file endpoints.
- **Reliability:** provider timeouts, malformed responses, rollback, retries, lease recovery, dependency unavailability and shutdown cleanup.
- **Performance/resources:** bounded parallel local health requests and serialization time/memory budgets. These are regression checks, not capacity/SLA certification. Historical k6 scripts in `tests/load/` are not run automatically and must not target production.
- **Smoke/live:** public GET probes for frontend rendering, API proxy, readiness, anonymous access denial and unified socket transport. Live probes require explicit URLs and an opt-in flag; they do not authenticate, upload, send messages, pay or read clinical records.

## Run locally

```bash
uv sync --locked --project backend
pnpm install --frozen-lockfile

# Own disposable PostgreSQL container; never reuse Neon or another project's DB.
docker run -d --name quickclinic-test-pg -p 127.0.0.1:15439:5432 \
  -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=quickclinic_test postgres:16
# Wait for pg_isready before testing.
docker exec quickclinic-test-pg pg_isready -U postgres

# Full backend suite, branch-aware 80% aggregate coverage gate and reports.
QC_REQUIRE_POSTGRES=true \
QC_TEST_DATABASE_URL=postgresql+asyncpg://postgres:postgres@localhost:15439/quickclinic_test \
uv run --directory backend pytest --cov=app --cov-report=term-missing \
  --cov-report=xml:/tmp/quick-clinic-coverage.xml \
  --cov-report=json:/tmp/quick-clinic-coverage.json \
  --junitxml=/tmp/quick-clinic-backend-tests.xml

# Layer selection (each feature directory receives its pytest marker automatically).
uv run --directory backend pytest -m unit
uv run --directory backend pytest -m feature
uv run --directory backend pytest -m 'security or performance or smoke' --ignore=tests/live

# Browser data has its own database. This script accepts only local DBs with this exact name.
docker exec quickclinic-test-pg createdb -U postgres quickclinic_e2e_test
pnpm exec playwright install chromium
JWT_SECRET=browser-isolated-signing-secret-at-least-32-characters \
BACKEND_URL=http://localhost:4100 NEXT_PUBLIC_SOCKET_URL=http://localhost:4100 pnpm build
QC_BROWSER_TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:15439/quickclinic_e2e_test \
  pnpm test:e2e

uv run --directory backend ruff check app tests scripts/testing
pnpm type-check
pnpm lint
pnpm test:coverage
pnpm build

# Read-only deployed service probes; no production data/provider traffic.
QC_LIVE_FRONTEND_URL=https://quick-clinic-nine.vercel.app \
QC_LIVE_BACKEND_URL=https://quick-clinic-api.onrender.com \
  uv run --directory backend pytest tests/live --run-live
```

`QC_TEST_DATABASE_URL` must name an explicitly disposable test database. PostgreSQL tests create a unique schema per test and drop only that schema afterward. `QC_REQUIRE_POSTGRES=true` makes missing PostgreSQL configuration fail instead of silently skipping. Unit/feature tests use fresh SQLite connections with foreign keys. Application settings are isolated before import, and a network guard blocks accidental external provider connections. Mock HTTP transports still execute provider request/response handling.

Default Playwright configuration selects `e2e/integration/`. Earlier UI simulations remain in `e2e/` for reference and are not included in the verified browser suite. Browser servers do not reuse running instances or load database credentials from `.env`. The browser suite uses a production Next.js build; its frontend and FastAPI share the same synthetic signing key. Temporary documents are removed when the server exits. Browser screenshots, traces and reports go to `/tmp/quick-clinic-playwright-*`.

CI runs the coverage gate with PostgreSQL, frontend checks/coverage/build, and isolated browser tests in separate jobs. Coverage and JUnit/browser artifacts are retained for review. The manually invoked deployment health workflow runs the same opt-in live tests. Provider sandbox acceptance, sustained load/soak testing, full accessibility audits and compliance certification require dedicated environments and are not implied by this suite.
