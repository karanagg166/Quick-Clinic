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
