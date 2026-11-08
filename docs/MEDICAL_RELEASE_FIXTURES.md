# Owned medical release fixtures

## Inventory before provisioning

The complete authenticated Quick-Clinic upload/index/retrieval/answer/SSE/deletion
journey is missing. Existing status, cleanup, doctor-response authorization and
cached-history checks are implemented and tested; a deployment-contract check is
not the full journey.

`prisma/schema.prisma` has User, Doctor, Patient, Slot and Appointment identities.
`src/lib/medical-record-access.ts` grants a doctor access only through CONFIRMED or
COMPLETED appointments. Fixture provisioning must use a completed past synthetic
appointment, a past BOOKED slot and no schedules, notifications, payments or future
availability. Real accounts and appointments must never be reused or impersonated.

Before adding any fixture doctor, public discovery must exclude it. Currently
`src/app/api/doctors/route.ts` lists every matching profile and the doctor-ID GET
returns its profile. `src/lib/checkout-service.ts` validates fees/slots without a
fixture distinction. A synthetic doctor must not appear to patients as a real
practitioner or enter checkout.

The first repair adds an operator-owned `Doctor.isReleaseFixture` flag, default
false for existing/ordinary profiles. Public list/profile and checkout paths deny
flagged profiles. Private medical routes retain their normal account, appointment
and thread checks; the flag never grants access. Public request bodies cannot set
this flag. Apply the additive migration before deploying code that selects it.

No production fixture identity or appointment has been created. A later dry-run
bootstrap must bind exact IDs and credentials to a private ownership key, refuse
partial/colliding/changed records and preserve private receipts. Only exact
synthetic patient collections may receive short-lived inference eligibility.

## Isolation verification

The flag is now checked by public doctor discovery/profile and checkout, plus the
legacy slot-hold/confirmation and payment-order paths. Existing profiles retain the
false default. The field is absent from public request update/create allowlists;
setting it requires operator-controlled database provisioning. It does not grant
medical-record access or provider eligibility.

Eight PostgreSQL fixture cases verify safe migration defaults/rollback, public
hiding, unchanged ordinary profiles, online/offline checkout denial and legacy
hold/payment denial even with a valid future slot deliberately created only in the
isolated test database. Existing checkout/CRUD/hold suites also pass: 28 focused
checks total. Prisma client was regenerated, schema validation and TypeScript pass,
and focused lint has no errors (existing warnings only). External payment calls
are spied and Redis is synthetic in the new suite.

Apply `prisma/migrations/20261108000000_private_release_doctor/migration.sql` before
merging/deploying the consumers that select this field. The production precheck
must verify the intended database and column metadata without fetching record
contents; add the column with a bounded lock timeout, then confirm Boolean,
non-null and default false. Never use a development seed or `db push` against
production for this step. Do not flag any real profile as a release fixture.

Fixture bootstrap, logins and the complete authenticated medical journey remain
open; this change creates no production identity, appointment, provider approval,
notification or payment.

## Bootstrap contract before implementation

Provision exactly three synthetic users (doctor, patient A, patient B), one hidden
fixture doctor, two patient profiles, one past BOOKED slot and one COMPLETED
appointment from the fixture doctor to patient A. Patient B has no qualifying
appointment. Use an existing immutable canonical Location reference; no synthetic
location should enter public discovery. Create no relation, payment, schedule,
notification, future slot or real clinical note.

Derive all eight owned record IDs, three reserved `example.com` emails and strong
login values from a private ownership key. A read-only plan binds the target
connection and exact expected grant/profile state for at most fifteen minutes.
Apply must re-read under a shared identity lock, verify bcrypt ownership, refuse
partial/colliding/changed records and insert all records atomically. Repeated apply
must not reset a password, role, appointment grant or fixture flag. Keep logins and
ownership key outside Git and protected in the release environment; no email/SMS
or model request belongs in bootstrap. Deployed verification still goes through
real application login and user-authorized routes.

## Bootstrap engine and migration deployment

The additive fixture flag migration was applied to the verified production target
after PR #168 CI passed, before code deployment. Its Boolean/non-null/default-false
contract was checked inside a bounded transaction and its exact SHA-256 migration
checksum recorded atomically in the existing Prisma history. No fixture or real
profile was flagged or created. Older migrations were not replayed.

`src/lib/medical-release-bootstrap.ts` implements the read-only signed plan and
atomic apply contract. Plans expire after fifteen minutes and bind the ownership
key and target fingerprint. Apply takes a nonblocking PostgreSQL identity lock,
rechecks complete ownership and grant state, and inserts all eight records in one
transaction. A repeated create plan recovers a lost response by verifying existing
records; a reuse plan cannot recreate missing identities. Passwords and grants
are never reset. Clinical fields are checked for emptiness through predicates,
without fetching their contents. The engine sends no notifications or inference.

The PostgreSQL suite covers read-only planning, exact patient-A authorization and
patient-B denial, safe reuse, plan tampering/expiry/wrong target/key, partial and
changed records, rollback on a final-insert database failure, lock contention and
restart reuse. The private operator CLI and deployed medical journey remain open;
this module is not a public provisioning endpoint.

## Private operator CLI

Run `pnpm exec tsx scripts/medical-release-bootstrap.ts plan` inside the operator
container with absolute `--database-env-file`, `--key-file` and `--plan-file`
paths. The explicitly selected environment file must contain the verified target's
`DATABASE_URL`; shell defaults and the application's implicit `.env` are ignored.
Review the printed target fingerprint and mode against the intended deployment.
Then run the same command with `apply` and an additional `--credentials-file` path.
Apply accepts only the unexpired signed plan and rechecks ownership and grants.

Keep these inputs/outputs outside Git in an owner-only private directory. All
input files must be regular, owner-only files; output paths must be absent, in a
private directory. The CLI refuses symlinks, FIFOs, oversized files and existing
outputs. Values, connection strings and login credentials are never printed.
Both the plan and credential output are created exclusively with mode `0600`.
If apply succeeds but credential-file persistence fails, keep the ownership key:
another apply to a fresh output path verifies the same records without resetting
them. Never delete or recreate identities just to recover a lost response.

The CLI has been tested using synthetic keys and local PostgreSQL only. Production
provisioning requires the hidden-doctor migration and deployment to be verified
first; it does not approve any patient collection for hosted inference.
