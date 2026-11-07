# Search-Sphere integration follow-up

## Current production stack and cleanup verification

Search Sphere now uses its PostgreSQL durable worker, pgvector, private Supabase
Storage and approved hosted Cohere APIs. The RabbitMQ/Qdrant/local-model rollout
notes below are historical; use the current
[versioned client guide](https://github.com/karanagg166/search-sphere/blob/main/docs/VERSIONED_CLIENT_GUIDE.md)
and [acceptance matrix](https://github.com/karanagg166/search-sphere/blob/main/docs/ACCEPTANCE_MATRIX.md).
Search Sphere's standalone and persistent-conversation production journeys passed;
Quick-Clinic's full authenticated consumer journey is still required.

Before this follow-up, patient deletion already revokes upstream evidence and
removes local metadata, while Search Sphere durably retries physical cleanup.
Quick-Clinic has no authenticated way to poll the scoped physical receipt after
that local metadata disappears. Plan: add a patient-only cleanup read that derives
the patient from the verified session/profile and calls the versioned receipt API
with that subject and hashed collection. It must work after local deletion, fail
closed on missing scope or invalid receipts, reject 503 as unverified, expose only
validated counts/status, and never return service credentials or upstream details.
No database migration, new service or model call is required.

`GET /api/patients/me/medical-documents/{documentId}/cleanup` now follows that
contract and returns `cleanup` with `status`, `vectorsRemaining`,
`derivedObjectsRemaining` and `objectDeleted`. Complete requires both counts to be
zero and the private object deleted. The patient identity comes from the verified
session/profile even after local document deletion; browser scope headers/parameters
are ignored. Another subject's scoped upstream denial becomes 404; unavailable or
malformed receipts return 503 `cleanup_unverified`. Responses are private/no-store.
The upstream GET uses one bounded attempt and no inference. New wrapper/route tests
cover forged delegation, absent identities, malformed/contradictory receipts,
pending status, denied scope and 503 failures. Full authenticated production proof
remains pending; a local test pass does not establish physical production cleanup.

## Durable ingestion retry contract (2026-11-06)

Initial ingestion sends `forceReindex: false`, so duplicate registration preserves
the upstream job and actual status. The patient-authorized retry route sends
`forceReindex: true` to start a new durable job generation. It makes one HTTP attempt;
an upstream outage cannot automatically repeat the reindex action. Upstream `FAILED`
continues to be returned as failure. Older Search Sphere releases ignore this optional
field, so this consumer change can deploy before the PostgreSQL worker repair.
The RabbitMQ result below is historical evidence, not the current rollout gate.

## Status

The synthetic backend lifecycle passed on 2026-10-06: upload → RabbitMQ → worker → READY → legacy and generic retrieval → observations → real Cohere answers/citations → chat/SSE → deletion. The same indexed document serves both retrieval contracts. Browser E2E and production cutover remain unverified. The [active compatibility report](https://github.com/karanagg166/search-sphere/blob/fix/quick-clinic-generic-rag-compat/docs/QUICK_CLINIC_COMPATIBILITY_REPORT.md) tracks migration prerequisites; remove it after the deployed migration is finished and its lasting conclusions are incorporated into permanent docs.

Follow-up branch: fix/search-sphere-v1-integration. Search-Sphere companion branch: fix/quick-clinic-generic-rag-compat. Production client provisioning, legacy data migration and browser checks remain prerequisites for deployment.

## Backend configuration

```env
SEARCH_SPHERE_API_URL="http://your-search-sphere-api"
SEARCH_SPHERE_API_KEY=""
SEARCH_SPHERE_CLIENT_ID="quick_clinic"
SEARCH_SPHERE_TENANT_ID="quick_clinic_default"
# Temporary fallback only:
SEARCH_SPHERE_SERVICE_SECRET=""
```

Register quick_clinic in the intended Search-Sphere database using its private-output maintenance command. The isolated test registration does not register production. Manually copy the generated API key into backend environment configuration; do not commit it. API key takes precedence over legacy secret. The server-only wrapper sends client, tenant, patient subject, hashed patient collection and request correlation headers. Browser calls stay on Quick-Clinic's backend; service credentials must never use NEXT_PUBLIC_ variables.

Tenant means the current clinic/platform tenancy, never a patient. Patient is owner_subject_id. Collection is patient_{sha256(patientId UTF-8)[:32]}_records. Future clinics can use clinic_abc/clinic_xyz through generic endpoints; legacy medical storage adapters support only quick_clinic_default.

## Ownership and failures

Quick-Clinic retains login, roles, doctor profile, eligible doctor/patient access, consent, appointments, metadata and UI. Search-Sphere retains extraction/OCR/chunking/embedding/index/retrieval/generation/citations. Structured observations and numeric medical routing remain domain extensions. Service authentication does not replace doctor authorization.

Retries are bounded and limited to transient HTTP/network failures; 400/401/403/404 are not retried. Upstream detail is not returned to browser callers. SSE keeps cancellation and timeout active for the stream lifetime. Vector deletion failure preserves metadata for retry; a typed upstream 404 permits cleanup of an unindexed record. Database insertion failure compensates uploaded storage; enqueue failure records processing failure and supports retry.

## Tests run

- Focused backend integration/auth/client: 143 passed, 12 files.
- Full isolated PostgreSQL suite: 951 passed, 0 failed, 1 intentionally skipped opt-in live test. Auth, profile, OTP, notification and doctor-search tests own their fixtures; the previous reset timeout did not recur in the full suite or 20 targeted reruns.
- type-check and production build passed.
- lint: 0 errors, 1093 warnings.
- Playwright not run.
- Both opt-in backend runs passed: retrieval-only and actual Cohere answer/chat/SSE. Forged client/tenant/subject/collection and foreign-document access were rejected; invalid tokens returned 401. Search-Sphere's separate generic lifecycle verified revoked tokens, client isolation, reindexing and deletion.

## Optional live synthetic test

With the isolated Search-Sphere stack running and its scoped key configured:

```bash
RUN_SEARCH_SPHERE_INTEGRATION=1 pnpm exec vitest run src/__tests__/integration/search-sphere-live.test.ts
# Also request actual Cohere generation/chat/stream assertions:
RUN_SEARCH_SPHERE_INTEGRATION=1 RUN_SEARCH_SPHERE_COHERE_SMOKE=1 pnpm exec vitest run src/__tests__/integration/search-sphere-live.test.ts
```

Only generated synthetic patients and documents are used. The test checks both retrieval contracts, scope forgery, observations and deletion; provider assertions are opt-in. Run model-heavy suites sequentially on small Docker VMs. Keep pytest in a separate runtime from a model-loaded API: the 4 GB verification VM OOM-killed the API when pytest ran inside it. A host test driver completed the generic lifecycle against the unchanged Docker services.

## Rollout

1. Apply Search-Sphere Alembic 007 and review legacy DB scope backfill.
2. Reindex legacy vectors, or review/apply its conservative vector payload migration. DB migrations alone do not update Qdrant.
3. Provision the deployed least-privilege quick_clinic ServiceClient and configure backend API key.
4. Repeat the verified backend lifecycle against the target environment and complete browser E2E before cutover.
5. Keep compatibility endpoints temporarily. Next migrate upload/register/status/delete/search toward /api/v1 and the shared SDK once SDK scope/correlation/retry behavior is ready.
6. Retain medical structured/hybrid routing and safety constraints in adapters. Do not replace exact numeric observations with LLM inference or turn medical-record retrieval into diagnosis/treatment generation.

## Processing-state contract

Upload and retry responses preserve Search Sphere's validated PENDING, QUEUED,
PROCESSING, READY or FAILED state. A successful HTTP registration can still report
FAILED; it is never converted to QUEUED. Status refresh returns HTTP 503 with
`upstreamAvailable: false` and the last known local state when Search Sphere is
unavailable or returns an unsupported state. The local record is retained for retry.


## Deployment contract gate

The post-deploy workflow runs only by trusted `main` dispatch after deployment, with
a required full `expected_sha`. The `search-sphere-release` environment permits only
`main`. `/api/health` exposes the web commit without a database or provider call; the
contract gate requires an exact match and bounds HTTP timeouts. Pre-deploy CI remains
separate. These health/API checks do not establish the authenticated upload, indexing,
retrieval, grounded-answer, patient-isolation, or physical-cleanup journey. That
required Search Sphere release journey remains a separate open rollout phase.

## Doctor-scoped conversation delegation

Medical chat forwards the verified doctor profile ID in `X-Actor-ID`, the authorized
patient in the subject/collection headers, and the locally owned thread ID as
`conversationId`. Search Sphere maps the reference within those scopes and selects
its own authorized PostgreSQL history. Quick-Clinic no longer reads or copies old
message text into model requests. Browser-supplied actor/history fields are ignored by
the route; doctor/patient/thread authorization still runs before delegation.

Generation uses one upstream HTTP attempt. JSON and streaming initiation allow at
most 55 seconds under the existing 60-second route limit, forward disconnects, and
preserve safe provider timeout/quota/approval codes. No provider diagnostic contents
leave the service boundary. Existing stateless calls must also identify their verified
doctor. The backend medical-history repair must be deployed for complete multi-turn
behavior; this change alone does not establish the production Search Sphere journey.
