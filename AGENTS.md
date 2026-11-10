# Quick-Clinic agent rules

## Architecture and source of truth

- Next.js in the root is the frontend. It proxies `/api/*` using `next.config.ts` and `BACKEND_URL`.
- `backend/` is the single Python FastAPI + Socket.IO service. Do not add another Node socket server or Next.js API business logic.
- Medical chatbot and Search Sphere integrations are retired. Patients upload/manage medical documents; doctors need an eligible appointment to access them. Human doctor–patient messaging remains supported.
- Read `commands.md`, `.env.example`, package manifests, `backend/uv.lock`, `pnpm-lock.yaml`, and relevant implementation/tests before changing code.
- Existing database mappings are `backend/app/infrastructure/schema.json` and `backend/app/infrastructure/database.py`; `prisma/` preserves historical schema/migration tooling. Never manually edit generated Prisma output.

## Package managers and commands

- Use pnpm exclusively for JavaScript/TypeScript; never npm, npx, yarn or bun.
- Use uv exclusively for Python dependencies and local virtual environments; never invoke pip directly.
- Prefer commands inside Docker: `docker compose exec app ...` or `docker compose exec backend ...`.
- Follow an explicit user instruction to defer tests until implementation is complete.

## Migration and safety

- Never run production schema/data mutations, drop tables, reset Git state, or overwrite unrelated user work.
- Database tables/columns remain compatible with the existing PostgreSQL schema. No automatic table creation or migration at startup.
- Preserve JWT session/socket audience separation, cookie authentication, database role/active checks, appointment ownership and payment/refund idempotency.
- Store new medical documents only in private persistent storage. Never expose storage paths or publish a static document directory. Preserve legacy file metadata pending explicit import.
- No live payments, provider webhooks, production data tests or deployments as part of local verification. Use isolated test databases and mocked providers.
- Never print secrets or real clinical records. `.env` is runtime configuration, not a documentation source.
- Do not stage, commit or push without explicit user instructions.

## Implementation quality

- Keep modules focused and around 300–350 lines when practical; split responsibilities where useful.
- Preserve frontend request/response contracts when migrating routes. Keep `backend/tests/route_contracts.json` and meaningful security/transaction tests aligned.
- Check authorization, validation, state transitions, concurrency, provider ambiguity, atomic database writes and error handling.
- Run backend lint/tests and frontend type checks/lint/tests/build after meaningful changes. Add PostgreSQL-specific tests for locking/concurrency; SQLite alone cannot validate PostgreSQL guarantees.
- Update `commands.md`, `.env.example`, README and `docs/backend-migration.md` when conventions change. Remove temporary reports/artifacts.

## Hosting constraints

- Use free instances only, always. Reuse the existing Neon database. Do not provision paid Render plans, persistent disks, or Render cron jobs.
- Render production documents must use authenticated Cloudinary storage; never its ephemeral filesystem.
- `.codex/config.toml` contains the project-scoped Render MCP alias. Credentials are stored outside Git. Restrict actions to Quick-Clinic resources.
