# Search-Sphere integration follow-up

## Status

**PARTIAL:** contract/security fixes are covered by 143 focused backend tests. A complete live upload → retrieval → Cohere → chat/stream → UI lifecycle has not passed. Search-Sphere's isolated worker did index a synthetic PDF; Docker memory exhaustion prevented completion of the live matrix. See the [full compatibility report](https://github.com/karanagg166/search-sphere/blob/fix/quick-clinic-generic-rag-compat/docs/QUICK_CLINIC_COMPATIBILITY_REPORT.md) for bugs, actual test results, migration prerequisites and remaining risks.

Source branch verified at eb93700fb9755b87781ed774b395bfec40eb8997. Follow-up branch: fix/search-sphere-v1-integration. Search-Sphere companion branch: fix/quick-clinic-generic-rag-compat. Neither should be merged/deployed before the remaining live checks and data migration.

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
- Full isolated PostgreSQL suite: 933 passed, 12 failed, 6 skipped. Login/profile/signup/doctor-search fixture failures and one unchanged medical-search UI reset failure remain.
- type-check and production build passed.
- lint: 0 errors, 1094 warnings.
- Playwright not run; live service/browser setup was incomplete.
- Real Search-Sphere lifecycle attempts failed on worker/runtime timeouts; do not claim real streaming or Cohere validation from mocked tests.

## Optional live synthetic test

With the isolated Search-Sphere stack running and its scoped key configured:

```bash
RUN_SEARCH_SPHERE_INTEGRATION=1 pnpm exec vitest run src/__tests__/integration/search-sphere-live.test.ts
# Also request actual Cohere generation/chat/stream assertions:
RUN_SEARCH_SPHERE_INTEGRATION=1 RUN_SEARCH_SPHERE_COHERE_SMOKE=1 pnpm exec vitest run src/__tests__/integration/search-sphere-live.test.ts
```

Only generated synthetic patients and documents are used. The test checks both retrieval contracts, scope forgery, observations and deletion; provider assertions are opt-in. Run model-heavy suites sequentially on small Docker VMs. A successful first complete live run remains required.

## Rollout

1. Apply Search-Sphere Alembic 007 and review legacy DB scope backfill.
2. Reindex legacy vectors, or review/apply its conservative vector payload migration. DB migrations alone do not update Qdrant.
3. Provision the deployed least-privilege quick_clinic ServiceClient and configure backend API key.
4. Complete the real lifecycle/security/RAG/SSE/browser matrix before cutover.
5. Keep compatibility endpoints temporarily. Next migrate upload/register/status/delete/search toward /api/v1 and the shared SDK once SDK scope/correlation/retry behavior is ready.
6. Retain medical structured/hybrid routing and safety constraints in adapters. Do not replace exact numeric observations with LLM inference or turn medical-record retrieval into diagnosis/treatment generation.
