# Quick-Clinic

Next.js frontend with one Python FastAPI backend for the API and Socket.IO.

Patients upload and manage private medical documents. Doctors access records through eligible appointments. Human doctor–patient messaging remains available. The previous chatbot and Search Sphere integrations have been removed.

Start with [commands.md](commands.md). See [backend migration and deployment](docs/backend-migration.md) for configuration, data preservation, historical document imports and rollback.

See [testing](docs/testing.md) for the feature coverage matrix, isolated backend/browser suites, security and performance checks, and read-only live deployment probes. Python tooling uses uv; frontend tooling uses pnpm.
