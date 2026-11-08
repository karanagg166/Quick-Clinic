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

## Complete journey controller

`scripts/medical-release-journey.ts --preflight` validates protected inputs without
using an application account or provider. Its normal mode verifies both exact
serving revisions and database readiness, signs into the three owned accounts,
recovers signed catalog/receipt provenance and reconciles previous fixtures before
creating two fresh patient PDFs and one fresh doctor/patient-A conversation.

The controller requires actual upstream READY states, retrieval of the new unique
marker, patient-B evidence isolation, explicit ungranted-doctor denial and patient
source denial. It checks legacy grounded JSON, conversation JSON and a contextual
SSE follow-up against independent expected-answer/citation assertions, then checks
the four saved complete turns. It never retries uploads or generation and never
logs credentials, excerpts, queries, answers or raw upstream errors.

Cleanup attempts every owned fixture even after a primary failure. Logical 404
alone is insufficient: document receipts must prove zero vectors/derived objects
and absent originals; patient-A retrieval must exclude the deleted source. Any
delete/receipt 503 or unverified cleanup fails the run and preserves its signed
pending receipt. Lost upload/thread responses recover through signed metadata.
Unknown content in a fixture catalog blocks inference and is left untouched.
Old completed receipts cannot substitute for a new journey.

Twenty-two controller tests against an isolated synthetic HTTP peer pass, including
terminal/stuck indexing, access leakage, provider failure, wrong answers/citations,
incomplete SSE/saved turns, cold health recovery, lost responses, strict cleanup
failures and restart reconciliation. These are controller regression tests, not
live acceptance. TypeScript and focused lint pass. The protected workflow, trusted
artifact restoration, exact synthetic provider policies and deployed medical run
remain open.

## Protected workflow and artifact recovery

`.github/workflows/medical-release-journey.yml` is a separate post-deployment main
dispatch. It uses the existing `search-sphere-release` environment, which was
verified to allow only `main`; only derived synthetic logins and the ownership key
were installed. The job has read-only repository/Actions permissions and serialized
execution. Exact successful main CI and main history for both serving revisions
are required before restoration or mutation. Missing protected inputs fail rather
than skip acceptance.

`medical-release-restore.ts` restores only bounded, signed receipts from this
repository's prior completed main-dispatch workflow. Later queued runs are ignored;
still-active predecessors, expired/altered/missing receipts and untrusted history
fail closed. A missing artifact is skipped only with explicit proof that its
mutating step never ran. Recovery validates archive metadata, a regular bounded
receipt file and every signature before accepting it. The latest journal is
uploaded with `always()` and missing-file errors enabled, retaining content-free
cleanup provenance for thirty days. Missing provenance requires explicit operator
reconciliation; it never means cleanup succeeded.

Seventeen admission/artifact recovery cases, TypeScript and focused lint pass. YAML,
protected environment and required-artifact contracts were checked. Deployment and
the first live medical journey still require the exact synthetic provider policies
and successful final-main CI; no live acceptance is claimed by these local checks.

## First deployed evaluation and cleanup-contract repair

Exact main CI [42467599857](https://github.com/karanagg166/Quick-Clinic/actions/runs/42467599857)
passed for `9e24d3e5813df63d644ec50805e4256b6649a6ed`. Vercel redeployment
`dpl_FmfyHn2ehjDq8PSZdqc5i9NYdNxW` serves that revision with the production-only
registered Quick-Clinic tenant key. It has only documents read/write/delete,
search and answer scopes. Live foreign-tenant and collection-administration probes
deny access with 403. Only the two owned synthetic patients and their deterministic
collections have short-lived synthetic provider policies; real medical records
remain ineligible for trial inference.

The first protected journey
[42468180296](https://github.com/karanagg166/Quick-Clinic/actions/runs/42468180296)
passed exact revision/readiness/login admission, two fresh PDF uploads/indexes,
unique-marker retrieval, patient isolation and the legacy grounded/page-cited
answer. It failed during the conversation JSON/SSE stage; safe backend telemetry
recorded a bounded chat provider timeout at 26,241 ms. It also rejected two HTTP-200
cleanup receipts because the controller incorrectly expected Search Sphere's
snake_case fields. Quick-Clinic's established route returns camelCase fields.

The release controller and typed test peer now use the actual Quick-Clinic receipt
contract. The corrected peer reproduced nineteen failing cases before the checker
fix. Fifty controller/route/client cases now pass with TypeScript and focused lint,
including rejection of remaining vectors, derived objects, undeleted originals,
wrong document IDs and 503 responses. Physical assertions and provider deadlines
were preserved. The failed run's signed receipts remain retained for independent
reverification and the next trusted run. This repair does not turn that failed
journey into a pass; complete live medical acceptance remains open.

## Content-free failure diagnostics

After #177, exact main CI
[42469336359](https://github.com/karanagg166/Quick-Clinic/actions/runs/42469336359)
and Vercel `dpl_HizfaqwKCAdSYoaJBTfN2GipC9aq` verified
`4bf10616387be9d8a298a59f97251263ebcf7db0` against Search Sphere `9b3c137`.
Protected runs [42469836296](https://github.com/karanagg166/Quick-Clinic/actions/runs/42469836296)
and [42471363646](https://github.com/karanagg166/Quick-Clinic/actions/runs/42471363646)
passed receipt restoration, two fresh PDF uploads/indexes, marker retrieval,
patient isolation, legacy cited answers and physical cleanup, then failed the
combined conversation JSON/SSE stage. The second run recorded three completed
chat requests; that telemetry alone does not explain which downstream assertion
failed. Neither run is treated as a pass.

An independent direct deployed diagnostic on the same revisions passed fresh
PDFs, cited legacy/JSON answers, contextual SSE start/token/citations/done with a
saved message ID, persisted turns and all physical cleanup. It logged only
statuses, event types and assertion booleans, with no response contents or secrets.
This direct result does not replace the required successful GitHub Actions run.

The release controller now separates thread creation, JSON response validation,
SSE framing and SSE fact/citation validation. Failures report only fixed assertion
codes, bounded HTTP status and allowlisted provider/stream categories. Transport
deadlines receive a typed static diagnostic. Unknown errors, invalid JSON and
untrusted category values never print upstream messages or raw response bodies.
Seventy-four focused controller/evidence/transport cases pass with TypeScript and
lint. Deadlines, model configuration, factual/citation assertions, authorization
and cleanup requirements remain unchanged. Complete protected medical acceptance
is still open pending the finer diagnosed run.

## Conversation runtime margin

The finer protected run
[42489722050](https://github.com/karanagg166/Quick-Clinic/actions/runs/42489722050)
on `3d6d63d` passed fresh PDFs, indexed marker retrieval, patient isolation and
cited legacy/conversation JSON answers, then failed `sse_incomplete`. Physical
cleanup passed. SSE started at 14:30:23 UTC and ended at 14:31:23 UTC. Vercel's
production runtime log independently reported `Task timed out after 60 seconds`
for that invocation; this establishes the platform termination, rather than a
successful stream completion. No raw logs or response content are committed.

The conversation JSON/SSE routes now reserve 90 seconds for local authorization,
the existing bounded 55-second upstream call, persistence and final access checks.
Their conversation lease also lasts 90 seconds. The protected release transport
allows 95 seconds only for those two clinic routes; other paths retain their
65-second ceiling. Provider deadlines, model choice, data eligibility, citation
validation and access rechecks remain unchanged. The bounded margin fits the
[documented Hobby fluid-compute maximum](https://vercel.com/docs/functions/configuring-functions/duration)
without a plan upgrade. This change still requires exact CI, deployment and a
successful fresh-PDF medical workflow; the failed run remains a failure.
