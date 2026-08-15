# Project Rules & AI Agent Workflow (`AGENTS.md`)

## 0. Project Shape (read first)
Quick-Clinic is **not** a pnpm workspace/monorepo — there's no `pnpm-workspace.yaml`.
It's two independent packages in one repo:
- **root** (`/`) — Next.js 16 app (App Router, `src/app`), Prisma 7, NextAuth, Vitest. Deployed to **Vercel**.
- **`socket-server/`** — standalone Socket.IO server, its own `package.json` + lockfile. Deployed to **Render**.

Canonical command reference is available at `commands.md`.

---

## 1. Package Manager & Environment
- **Whole Repository:** ALWAYS use `pnpm`. The repo pins `packageManager: pnpm@10.33.0` for both root and `socket-server/`.
- **`socket-server/`:** uses `pnpm` (`pnpm install`, `pnpm dev`, `pnpm build`, `pnpm start`).
- `pnpm-lock.yaml` is the source of truth in both root and `socket-server/`. Stray `package-lock.json` files should be removed.

---

## 2. Docker & Container Isolation
- `docker-compose.yml` only defines **dev** services (`app` via `Dockerfile.dev`, `socket-server` via `socket-server/Dockerfile.dev`). There is no prod compose file — prod for the socket server is built straight from `socket-server/Dockerfile.prod` on Render, and the root `Dockerfile` is a plain multi-stage build (Vercel doesn't use it).
- All installs, Prisma commands, lint, and tests for local dev MUST run inside the container: `docker compose exec app <cmd>` (or `docker compose exec socket-server <cmd>` for that service).
- Prisma client output is customized to `src/generated/prisma` (see `prisma/schema.prisma`) — always re-run `prisma generate` after touching `prisma/schema.prisma`, and make sure `src/generated` stays out of manual edits.

---

## 3. Mandatory Verification Loop
After every file modification, run inside the container:
1. **Type check:** `package.json` has **no** `type-check` script — use `pnpm exec tsc --noEmit` directly, or add the script first (`"type-check": "tsc --noEmit"`) before relying on `pnpm type-check`.
2. **Lint:** `pnpm lint` (ESLint 9 flat config — matches).
3. **Schema validation:** validate Zod schemas (project uses `zod@4`) whenever `src/app/api/**` handlers or `prisma/schema.prisma` change.
4. **Tests:** `pnpm test` (`vitest run`, config at `vitest.config.ts`, tests under `src/__tests__`). Fix root causes, not just assertions, and don't stop until 0 failures.

---

## 4. Git & Repository Safety (NON-NEGOTIABLE)
- No unprompted `git commit`.
- No unprompted `git push`.
- Only stage/commit/push on explicit instruction.

---

## 5. Skills & Tool Integrations
- No `.agents/skills/` or `~/.gemini/config/skills/` currently exist in this repo. Don't assume they're there — if you add project-specific skills/commands, create the directory and document it here rather than pointing at a phantom path.

---

## 6. Post-Push Deployment & Observability
- **Frontend (Vercel):** check build/deploy logs and SSR/hydration issues via the Vercel CLI after pushing to the branch Vercel tracks.
- **Socket server (Render only — no Railway/separate backend in this project):** the app has **no `/health` or `/api/health` route today**. Don't assume one exists — either add a minimal health endpoint first, or check Render's own service logs/runtime status instead of hitting a route that isn't there.
- **Database:** Postgres is Neon (`DATABASE_URL` in `.env.example`), plus Upstash Redis (`UPSTASH_REDIS_REST_URL`/`TOKEN` and a raw `REDIS_URL` for `ioredis`). Confirm these env vars are bound on both Vercel and Render after any env change, not just DB connection pooling.

---

## 7. Env & Secrets
- Copy `.env.example` → `.env` for local/Docker dev. Current required vars: `DATABASE_URL`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `REDIS_URL`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, plus NextAuth vars once auth is fully wired (`NEXTAUTH_SECRET`, `NEXTAUTH_URL`) and `NEXT_PUBLIC_SOCKET_URL` for the socket connection.
- Never commit real values for these — `.env.local` is gitignored, keep it that way.