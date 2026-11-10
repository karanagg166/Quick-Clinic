# Quick-Clinic commands

The frontend uses pnpm; the unified FastAPI/Socket.IO backend uses uv.

```bash
# Copy configuration, fill credentials, then start both services.
cp .env.example .env
docker compose up --build

# Frontend development (without Docker)
pnpm install --frozen-lockfile
pnpm dev

# Backend development (from backend/)
uv sync --locked
uv run uvicorn app.main:app --host 0.0.0.0 --port 4000 --reload

# Verification (run after implementation)
docker compose exec backend uv run ruff check app tests
docker compose exec backend uv run pytest
docker compose exec app pnpm type-check
docker compose exec app pnpm lint
docker compose exec app pnpm test
docker compose exec app pnpm build

# Fresh disposable database initialization only; not a production migration.
docker compose exec backend uv run python -m scripts.init_db

# Logs and shutdown. Preserve the medical document volume.
docker compose logs -f backend
docker compose down
```

For deployment, data preservation and historical document imports, see [backend migration](docs/backend-migration.md). Do not run database tests against production.

For feature coverage, test layers, isolated PostgreSQL/browser setup, coverage gates and read-only live probes, see [testing](docs/testing.md). The default browser command is now `pnpm test:e2e` with `QC_BROWSER_TEST_DATABASE_URL` set to a local disposable `quickclinic_e2e_test` database. Build the browser frontend with the isolated values documented there first. The suite starts the frontend and FastAPI itself; it never reuses a production database or running service.
