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

## Verified production fixture bootstrap

After #168–#171 passed CI and revision
`9267d56b5a94f3b5954e024d44ce750e1fbf9cd5` was verified serving, the reviewed
private plan was applied to its verified database target. It created exactly eight
owned synthetic records. The ownership key, signed plan and credential recovery
file are private operator files. Only derived synthetic logins/key were installed
in the existing protected release environment; no database or upstream service key
was added there.

Live application login passed for the fixture doctor and both patients with exact
role/profile checks. The doctor's public profile returned 404. Its legacy search
and answer requests for ungranted patient B both returned 403 before inference.
These checks made zero model calls. They are bootstrap/authorization evidence,
not the required complete upload/index/retrieval/answer/SSE/cleanup journey.

The legacy search and answer routes also need the same safe upstream failure
contract as chat: preserve 429/503/504 and allowlisted provider codes, use static
client messages, and do not replay model requests. A single bounded deadline now
covers transport and JSON/error-body parsing for search, answer and nonstreaming
chat. Answer's deadline is capped at 55 seconds within the existing 60-second
serverless envelope; the hosted provider's own inference timeout is unchanged.
Seventy-eight focused client/legacy-route cases and fifty existing chat, response
authorization and conversation-deletion cases pass. Timeout cases include stalled
success/error bodies across all three nonstreaming operations and invalid deadlines.
TypeScript passes and focused lint has no errors (existing warnings only).

## Authenticated journey transport and cleanup provenance

`src/lib/medical-release-http.ts` confines release requests to the fixed deployed
Quick-Clinic/Search Sphere origins. It keeps each login cookie in its own session,
rejects redirects and unsafe paths, never retries requests, and bounds transport
and response-body reads together. Default reads/deletes remain fifteen seconds;
POST defaults to forty-five, with an explicit maximum sixty-five for completed
answer/SSE checks. Responses are capped at 256 KiB. HTTP errors, including cleanup
503, remain failures for the controller to assert. HTTP 200 alone does not prove
an SSE stream completed.

`src/lib/medical-release-journal.ts` signs both fixture titles and content-free
document/conversation receipts using the protected fixture ownership key. Receipts
bind kind, ID, patient/thread label, title and completion. Imports validate every
entry before accepting any; forged, conflicting or foreign-owner entries fail.
Private atomic saves survive interrupted runs, verified completion takes precedence
over older pending copies, and rediscovered live metadata requires verification
again. The bounded journal preserves unresolved entries and fails for operator
reconciliation at capacity; the controller must check remaining capacity before
creating fixtures. It contains no credentials, passages, medical values or answers.

Twenty-six HTTP/journal cases pass, including stalled transport/body, unsafe URLs,
cookie isolation, strict failure status, output bounds, SSE bytes, restart recovery,
tampering, wrong owner, conflicting provenance and capacity. TypeScript and focused
lint pass. The full journey controller, trusted artifact restoration and protected
workflow remain the next separate repair; these libraries do not claim live
medical acceptance.

## Required inputs and independent evidence assertions

`medical-release-config.ts` requires the exact derived three-account credential
manifest, both full serving revisions and an explicit private journal path. In
Actions it also requires this repository's main-branch dispatch, a run identity,
artifact read access and the fixed private runner receipt path. Missing or changed
inputs fail before fixture mutation; no real-account or implicit-config fallback
is available.

`medical-release-evidence.ts` generates a one-page public synthetic verification
note and independently checks its expected color against the unique marker and
authorized page citation. Negated/wrong answers, wrong documents/pages, unsupported
excerpts, fabricated IDs and leaked scores fail. Its downstream SSE parser requires
the correct thread, token/citation order, explicit done event and saved message ID;
HTTP 200 or a token alone is insufficient. It uses no provider as an answer judge.

Thirty-two configuration/evidence cases pass, with TypeScript and focused lint
passing. The generated PDF was also opened with PyMuPDF: one page and both its
unique marker and expected fact extracted successfully. The complete protected
medical journey still requires the controller and live verification.
