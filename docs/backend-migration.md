# Unified Python backend

Quick-Clinic has one FastAPI ASGI service for `/api/*` and Socket.IO `/socket.io` on port 4000. Next.js serves the UI and proxies HTTP API requests using `BACKEND_URL`; it owns no API business logic. The browser uses `NEXT_PUBLIC_SOCKET_URL` for Socket.IO. Both must point at the same backend deployment. The backend uses python-socketio so existing Socket.IO clients remain compatible; see the [official ASGI integration](https://python-socketio.readthedocs.io/en/stable/server.html#uvicorn-daphne-and-other-asgi-servers).

Python environments and dependencies use uv and committed `backend/uv.lock`. Frontend dependencies use pnpm. PostgreSQL table names, camelCase columns, IDs, password hashes, and session/socket JWT audiences are preserved. Mappings live in `backend/app/infrastructure/schema.json` and `database.py`; startup never creates tables, applies migrations, deletes historical AI records, or changes existing data. Prisma schema/migration history remains available as a record of the existing schema. Do not use `prisma db push --accept-data-loss` against an existing database.

## Local operation

Copy `.env.example` to `.env`, supply your existing PostgreSQL credentials and JWT secret, then run `docker compose up --build`. There are two application containers: frontend `app`, unified Python `backend`. Existing independent Node socket service is retired. Readiness checks query PostgreSQL; `/api/health` and `/health` provide liveness. API docs are at backend `/docs`.

For a **fresh disposable database only**, initialize tables with `docker compose exec backend uv run python -m scripts.init_db`. Existing production databases must already have the reviewed historical migrations, including `Appointment_active_slot_unique`; no data migration is needed for the Python switch. Take a backup and validate the deployed schema in staging before cutover.

## Documents and removed AI features

Patients can upload PDF/JPEG/PNG/WebP documents, list/filter, preview/download, rename and delete their own files. Doctors can read documents only when a CONFIRMED or COMPLETED appointment grants access. Human doctor–patient chat remains available. Medical chatbot routes, conversation UI, semantic search, RAG answers, observations and all Search Sphere network integrations have been removed. No new AI agent is implemented in this migration.

New files use private Supabase object storage in free Render production, or private `DOCUMENT_STORAGE_DIR` storage in local Docker, with 10 MB file, 100 document and 100 MB patient quotas. Files are validated by actual file content, never served as a public static directory, and reauthorized on each download. Storage paths are omitted from API responses. Use persistent storage and include it in backups. A single backend deployment can use its persistent volume; multiple backend replicas require a shared filesystem for medical files, Redis for socket fanout and distributed rate limiting, and sticky routing for Socket.IO polling.

Existing `MedicalDocument.storagePath` values pointing to the retired service are retained. Opening or deleting those records returns `LEGACY_DOCUMENT_REQUIRES_IMPORT` until imported. Export their bytes through your existing storage operator, validate source ownership, then import each approved file using `uv run python -m scripts.import_document DOCUMENT_ID /secure/export/file.pdf` from `backend/`. The command validates content/size and updates one existing metadata record using the configured private storage backend. It never contacts Search Sphere. Verify checksums/export provenance and retain the original backup before retiring the remote storage; the command cannot independently authenticate the provenance of an exported file.

## Deployment cutover and rollback

1. Back up PostgreSQL and existing medical file storage. Build and verify the backend against a staging copy, using sandbox provider credentials.
2. Deploy `backend/Dockerfile` with production settings, your existing `JWT_SECRET`, PostgreSQL URL, allowed frontend origin, provider credentials, and private Supabase object storage. Set `BACKEND_PUBLIC_URL` to its HTTPS URL.
3. Point Next.js `BACKEND_URL` and `NEXT_PUBLIC_SOCKET_URL` to that service and rebuild/redeploy the frontend. For the frontend Docker image, pass these as `--build-arg BACKEND_URL=... --build-arg NEXT_PUBLIC_SOCKET_URL=...`; rewrites and public URLs are baked into the Next.js build. Proxy cookies remain on the frontend origin. Use HTTPS and ensure your reverse proxy allows WebSocket upgrades.
4. Route the Razorpay webhook to `/api/webhooks/razorpay` on this backend; set its dedicated `RAZORPAY_WEBHOOK_SECRET`. Point cron requests at this backend (or the frontend proxy) using `CRON_SECRET`. Stop the old Node socket service and old cron workers before switching traffic so only one implementation processes events.
5. Verify readiness, auth, sandbox checkout/cancel/refund, human messaging and uploads. Import historical files separately. No production deployment or provider calls were performed by the local migration.

Rollback uses the prior frontend/backend Git revision and its deployment configuration. The Python backend uses the same schema and token contract and does not drop old AI tables; document uploads written to the new volume must be preserved. Do not delete that volume on rollback.

## Verification

Run checks after implementation: `docker compose exec backend uv run ruff check app tests`, `docker compose exec backend uv run pytest`, then `docker compose exec app pnpm type-check`, `docker compose exec app pnpm lint`, `docker compose exec app pnpm test` and `docker compose exec app pnpm build`. Tests must use an isolated database and sandbox/mocked providers, never the production `.env` database. Python tests replace the retired Next.js route and standalone Node socket implementation tests; browser and frontend tests remain relevant.

## Code organization

`app/main.py` is the ASGI entrypoint and `app/api.py` composes the HTTP application. `app/core/` contains configuration, authentication, errors, middleware, UTC serialization and process lifecycle. Each `app/features/<domain>/` owns its router, domain service and request schemas where needed; routers authenticate and validate before calling services. `app/infrastructure/` owns PostgreSQL mappings, audit persistence and the Socket.IO transport. Document validation/storage belongs to the documents feature and external payment calls belong to payments. Tests cover HTTP contracts, business invariants, authorization, a real socket connection and PostgreSQL locking.

## Free Render and Vercel deployment

Only free instances are authorized. `render.yaml` defines a free Singapore Docker service and the dedicated Quick-Clinic Supabase project `yrrcjcddrmkercetjfhl`; it creates no Render Postgres, paid service, disk or cron job. Medical documents use the private `quick-clinic-medical-documents` bucket. The backend downloads objects using its secret key after clinic authorization and never exposes provider download URLs. Avatars are decoded, bounded, stripped of metadata and uploaded as WebP to the separate public `quick-clinic-avatars` bucket. `DOCUMENT_STORAGE_BACKEND=local` is for development; production on Render refuses ephemeral local storage. Historical document keys require a verified file export before import.

Vercel project `quick-clinic` remains the frontend. Set `BACKEND_URL` and `NEXT_PUBLIC_SOCKET_URL` to the actual new Render HTTPS origin, then deploy. `JWT_SECRET` must match the backend because the frontend's page middleware validates the session cookie. Backend secrets stay on Render. Database and Supabase secret credentials never belong in frontend runtime variables.

The project-scoped MCP configuration is `.codex/config.toml`, under `render-quick-clinic`. Login with `codex mcp login render-quick-clinic` from this directory; OAuth credentials remain in Codex's credential store. This server name and configuration are project-specific, but account permissions are determined by Render; a server alias does not restrict a credential to one service. Only manage Quick-Clinic resources using this connection.

`.github/workflows/keep-alive.yml` probes the backend every five minutes, offset from the hour. Set repository variables `QUICK_CLINIC_BACKEND_URL` and `KEEPALIVE_UNTIL` (an explicit UTC timestamp no more than 30 days ahead), then dispatch it once. After expiry, requests stop automatically. This is a best-effort health monitor: GitHub schedules can be delayed and Render's free service can restart or be suspended. No 24/7 guarantee is made. Render's 750 free instance hours are shared across the workspace; keep other services' usage in mind. See [Render free-tier limits](https://render.com/docs/free) and [GitHub scheduled events](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule).

The cron file must be on the repository's default branch for scheduled runs. Existing authenticated reconciliation and appointment-expiry cron endpoints continue to run independently. A health probe never performs payments, modifies clinical data, or creates database tables.

The expanded verification strategy, feature matrix, isolated PostgreSQL/browser setup and read-only deployment checks are documented in [testing](testing.md). CI enforces an aggregate 80% branch-aware backend coverage gate and preserves test reports.


## Supabase migration and cleanup

The explicit migration preserves the Neon source and a private custom-format PostgreSQL backup. It copies all 29 source tables, verifies row counts and order-independent full-row fingerprints, and then removes only audited synthetic/demo records on the destination. The cleanup is rehearsed against a restored disposable PostgreSQL copy before execution, guarded by the complete pre-cleanup fingerprints, and checked against the rehearsal afterward. It preserves medical-document owners, operator administration, retained appointment participants and all four legacy document metadata records. Proven demo identities retained for clinical history are disabled, and known demo logins are removed only with matching seed-password evidence. Private snapshots, row IDs and cleanup SQL stay outside Git; no medical data is embedded in migrations.

`supabase/migrations/` contains schema-only import and access controls. Every imported public table has RLS enabled and grants revoked from `anon` and `authenticated`: FastAPI's own sessions, database role checks and ownership rules remain authoritative. No Supabase Auth migration is performed. The backend's secret key remains private. The old Render `quickclinic-socket-server` service was explicitly deleted at the user's request; the unified `quick-clinic-api` service is retained.

The project MCP configuration is available to Codex (`.codex/config.toml`), VS Code (`.vscode/mcp.json`) and Antigravity (`.agents/mcp_config.json`). Open the Quick-Clinic folder as the workspace. Each configuration uses `project_ref=yrrcjcddrmkercetjfhl` with only documentation, database, debugging, development and storage capabilities. Authentication is managed by each client outside the repository; no global MCP definitions or secret tokens are added.
