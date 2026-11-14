# Quick-Clinic

Next.js frontend with one Python FastAPI backend for the API and Socket.IO.

Patients upload and manage private medical documents. Doctors access records through eligible appointments and the Doctor AI Copilot (LangGraph + Search Sphere `search-sphere-ingest` RAG + 60-second Human-in-the-Loop approvals). Human doctor–patient messaging remains available.

## Doctor AI Agent & Medical RAG

- **Orchestration**: FastAPI + LangGraph (`backend/app/features/ai_agent/`) with durable PostgreSQL checkpoints (`AgentThread`, `AgentTurn`, `AgentMessage`, `AgentApproval`, `AgentRetrievalRun`, `AgentMessageCitation`).
- **Doctor Tools**: Read-only profile, schedule, slots, appointments, leaves, earnings, authorized patient lists/documents, and clinical RAG queries; mutating tools (leaves, schedule/slots, profile, appointment status, patient messages) require explicit 60-second HITL approval via `/api/ai-agent/approvals/{approval_id}/decision`.
- **Medical Document RAG**: Uses `search-sphere-ingest` locally in Quick-Clinic's backend (`backend/app/features/documents/`) to extract/chunk into Quick-Clinic's own PostgreSQL + `pgvector` (`MedicalDocumentChunk`, `MedicalChunkEmbedding`) with per-query appointment authorization and immediate cleanup on document deletion/revocation.
- **LLM & Embeddings**: Gemini (`GOOGLE_API_KEY`) with Groq/Cohere fallbacks and `gemini-embedding-001` (384-dim) / deterministic hash fallback.

Start with [commands.md](commands.md). See [backend migration and deployment](docs/backend-migration.md) for configuration, data preservation, historical document imports and rollback.

See [testing](docs/testing.md) for the feature coverage matrix, isolated backend/browser suites, security and performance checks, and read-only live deployment probes. Python tooling uses uv; frontend tooling uses pnpm.
