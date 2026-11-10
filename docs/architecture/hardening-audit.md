# Production architecture audit

Audit date: 2026-11-10. This is a source audit of the existing working tree, including the pending FastAPI/Supabase migration and expanded tests. It does not certify production readiness or represent a deployed change. No production mutation, provider payment, commit, push or deployment is authorized by this hardening task.

## Deployment and repository boundary

The deployed frontend/backend remain the existing Vercel/Render services. The local code uses private Supabase storage; earlier Neon/Cloudinary references describe the preceding deployment. The project MCP and ignored runtime configuration now point to the supplied replacement Supabase project `atsicusbhiujthlshszg`. Read-only checks confirmed that its database and object storage are empty. The preceding migration copy remains in the earlier project; moving it again and publishing code require a separately authorized cutover. Secrets never belong in this report.

## Prioritized actual findings

| Priority | Finding and evidence | Required correction |
| --- | --- | --- |
| P1 | `features/scheduling/availability.py:daily_slots` updates holds, takes a doctor write lock and inserts slots through public GET; overview repeats those writes. Arbitrary dates allow unbounded creation. | Separate read-only projection from bounded, explicit, idempotent materialization. Adapt both existing frontend callers without changing slot IDs/GET response shape. |
| P1 | `features/documents/service.py:delete_patient_document` removes bytes before metadata/audit commit. A later DB error leaves a medical row referencing lost bytes. | Durable deletion intent, hidden pending deletions, leased retryable object cleanup and fenced metadata finalization. |
| P1 | Document/avatar upload occurs before a durable intent and final request commit. Provider ambiguity, crashes and compensation failure have no recovery record. | Durable immutable upload intents and recoverable cleanup, including replaced avatars. Never persist file bytes or secrets in job payloads/logs. |
| P1 | `features/booking/service.py:confirm_hold` locks only Slot while leave creation locks Doctor then discovers appointments. Confirmation can commit between leave discovery and its slot update. | Consistent locking and real PostgreSQL interleaving tests across booking, cancellation, leave and financial finalization. |
| P1 | Public doctor detail, slot lookup and hold acquisition do not check owning User.isActive, although search does. | Recheck active identity on public lookup and all reservation/finalization paths. |
| P1 | `features/payments/refunds.py` sends colon-containing `refund:full:<id>` as `X-Refund-Idempotency`, contrary to Razorpay's permitted alphabet. | Stable provider-safe key while preserving already-valid persisted keys. |
| P1 | Refund completion checks status without exact payment/amount/currency binding; webhook recovery may attach a partial refund to a full local claim. | Validate provider identity and exact amount before attachment/completion; mismatch remains unresolved/reviewable. |
| P1 | Reconciliation selects eligible Checkout rows without atomically claiming a lease. Outbox claims entire batches then publishes without timeout, so later items' leases can expire. | Atomic per-item ownership, bounded calls and batches, fenced state updates, crash/lease recovery and concurrent-worker PostgreSQL tests. |
| P1 | Expiry is a mutating GET and is not included in the scheduled reconciliation workflow. | POST maintenance commands, external scheduled expiry/recovery/storage/outbox execution and read-only GET status. |
| P1 | Socket authentication still accepts token query parameters; doctor appointments page sends a user ID without a ticket. | Auth payload tickets only, shared refresh-capable frontend socket hook and rejection/redaction regressions. |
| P1 | Worker `logger.exception` calls can serialize SQLAlchemy parameters/provider URLs; signup logs personal profiles. | Safe structured failure logging and removal of verified sensitive frontend debug output. |
| P1 | Request size guard trusts Content-Length; streaming/chunked bodies bypass the budget. Redis rate limiter lacks a short I/O deadline. | ASGI receive-level limit and bounded, fail-closed Redis calls. |
| P2 | No Alembic authority exists. Metadata JSON/JSONB and FK ON UPDATE semantics differ from historical DDL; unmanaged historical tables could be dropped by naive autogeneration. | Guarded legacy baseline, additive revisions, schema verification, unmanaged-table exclusions and rehearsal/rollback tooling. |
| P2 | Pooling uses SQLAlchemy defaults (5 + 10 overflow) and has no explicit query/lock/connect budgets. | Small configurable pools and bounded PostgreSQL work appropriate for free hosting. |
| P2 | Weekly schedule changes leave generated unused availability stale; duration metrics assume every slot is ten minutes; leave shading compares UTC dates to local dates. | Track generated provenance, synchronize only unused generated slots, derive actual durations and local-day overlaps. |
| P2 | Historical online earnings use mutable Doctor.fees; withdrawals have no request idempotency. | Use captured payment amounts and add compatible request-key deduplication with concurrency tests. |
| P2 | Public doctor detail returns fields omitted by public search; a few admin helpers rely solely on router authorization. | Explicit public views and trusted, freshly authorized application-service entry points for future tools. |
| P2 | Backend CI lacks static typing and migration/drift verification; production containers are not checked by CI. | Gradual strict typing for new boundaries, real PostgreSQL migration/recovery checks and reproducible container smoke verification. |

## Verified non-issues and compatibility constraints

- Account/profile GET helpers are already read-only. Patient profile creation is explicit onboarding; do not rewrite it based on an assumed lazy-write issue.
- Existing tests already cover authenticated ownership, JWT audience separation, real Socket.IO transport, competing holds, confirmation, refund enqueueing and message deduplication. Extend them for the identified gaps.
- Prisma seed/history and legacy test helpers still use Prisma/bcryptjs. Historical tooling is not an unused runtime backend and must be retained.
- Medical access auditing is an intentional GET side effect; slot creation, hold cleanup and other business writes are not.
- Immutable persisted slot IDs, existing response envelopes, cookie/token audiences, PostgreSQL names and historical rows must remain compatible.
- Redis is optional for a single process; it must not become the durable source of financial, storage or agent execution state.

## Verification standard

Implementation must include deterministic failure injection and real PostgreSQL contention/restart tests, not just mocks. Tests run after each implementation batch is complete. External provider success contracts are modeled from primary documentation; sandbox acceptance, new-project storage verification, real migration adoption and live deployment remain separate operator-controlled steps.
