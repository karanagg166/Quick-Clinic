# Quick-Clinic — AI Agent Final Functional Completion & Production Acceptance Report

**Date:** 2026-11-17  
**Repository:** `https://github.com/karanagg166/Quick-Clinic`  
**Verified Production Commit (`main`):** `3cb36be3d84bc0337a063f95d966b33f02023cb1` (PR #190)  
**Production Frontend (Vercel):** `https://quick-clinic-nine.vercel.app` (Deployment `dpl_FchcxZaGYf2GfRz4Ek9PUvWofcPb`, state `READY`)  
**Production Backend (Render):** `https://quick-clinic-api-u91s.onrender.com` (Service `srv-dbtf1s3m8hqs73ao8450`, Deploy `dep-dbu8gj15efls73c65m50`, status `live`)  
**Production Database & Object Storage (Supabase):** Project `atsicusbhiujthlshszg` (`pgvector` + private medical storage bucket)

---

## 1. Executive Verdict

**Verdict: PASS** (Functionally Complete & Accepted for Doctor AI Agent, Patient AI Agent, Medical PDF RAG Pipeline, LangGraph Persistence, HITL Approvals, CI, and Production End-to-End Verification; explicit free-tier extraction limitations documented below).

All core functional requirements for Phases 1–8 have been audited, repaired (PR #189 and PR #190), tested against PostgreSQL + `pgvector` + Playwright Chromium + live LLM/embedding/reranking APIs, and verified end-to-end against the live production deployments on Vercel, Render, and Supabase using strictly isolated synthetic accounts and zero post-test database residue (`cleanupExactMatch: true`).

---

## 2. System Inventory & Feature Audit

### Status Key
- `PASS`: Verified via automated tests and/or live production execution on `3cb36be`.
- `FAIL`: Verified defect remaining open.
- `BLOCKED`: Blocked by missing environment capability/credentials.
- `NOT TESTED`: Not executed in the current cycle.

| Capability Area | Pre-Audit State | Current Status | Notes & Evidence |
| --- | --- | --- | --- |
| Unified FastAPI + LangGraph Backend (`backend/app/features/ai_agent`) | Partially verified | `PASS` | PR #189 + #190 fixed multi-tool, fallback, RAG JSON/citation, checkpoint dedup, and HITL JSONB serialization bugs |
| Doctor AI Agent (16 Read + 10 HITL Mutating tools) | Partially implemented | `PASS` | All 26 tools registered and verified (`test_agent_tool_contracts.py`, `test_doctor_tools_graph.py`, `test_functional_completion.py`, live production) |
| Patient AI Agent (22 Read + 9 HITL Mutating tools) | Partially implemented | `PASS` | All 31 tools registered and verified; slot hold vs checkout/payment separation enforced; `PROPOSE_BOOKING` JSONB bug fixed in PR #190 |
| Medical PDF Ingestion (`search-sphere-ingest` rev `f0f674ce9549139129f692b9f6812adbed64945a`) | Partially verified | `PASS` (bounded) | `TesseractOCRProvider`, 25-page bounded batching up to 200 pages (201 rejected with 400); pure vector/graphic chart value parsing without `vision` provider honestly reports `PARTIAL` (`vision_provider_unavailable`) |
| Hybrid RAG & Hosted Embeddings (`search-sphere-rag` rev `f0f674ce9549139129f692b9f6812adbed64945a`) | Broken (Gemini content blocks & async connection race) | `PASS` | Fixed `_extract_ai_text`, `asyncio.Lock` per retrieval, LLM provider fallback (`google -> groq -> cohere`), Doctor citation `href`, and nested transaction delete (`PR #189`) |
| Multi-Provider LLM + Fallback (`BindableFallbackChatModel`) | Broken (provider fallback factory unwired) | `PASS` | `get_fallback_model([provider, "groq", "cohere"], model_factory=get_model)` wired in `AIAgentService`; verified on live Google `gemini-3.1-flash-lite`, Groq `openai/gpt-oss-120b`, Cohere `command-a-03-2025` |
| Persistent Checkpoints & HITL Reject/Approve Recovery | Broken (reject left stale interrupt; `datetime` crashed `AgentToolCall`) | `PASS` | Verified with `AsyncPostgresSaver` (`test_live_llm_and_rag_acceptance.py`) and live production Render/Supabase (`prod_acceptance.py`) |
| Frontend Proxy & Agent UI (`src/hooks/useAgentChat.ts`, `ApprovalCard.tsx`, `AgentMessage.tsx`) | Implemented | `PASS` | Verified via `pnpm type-check`, `pnpm lint`, Vitest (`28 files / 112 tests`), Playwright E2E (`5 passed`), and live Vercel proxy requests |
| Phase Boundary Compliance | In scope | `PASS` | No dedicated LLM evaluation frameworks (RAGAS/DeepEval/LangSmith evals), new advanced guardrail frameworks, or security-hardening initiatives added; existing auth, isolation, and HITL controls preserved |

---

## 3. Doctor AI Agent Functional Matrix (26 Tools: 16 Read-Only, 10 Mutating)

### Read-Only Doctor Tools (`READ_ONLY_DOCTOR_TOOLS` in `backend/app/features/ai_agent/graph/routing.py`)

| Tool Name | Category | Automated Contract & Graph Test | Live / Production Verification | Status |
| --- | --- | --- | --- | --- |
| `get_my_profile` | Profile | `test_all_doctor_read_and_mutating_tools` | Verified via `test_live_doctor_google_multitool_and_hitl_leave_approval` & live Render/Vercel (`specialty=GENERAL_PHYSICIAN`, `fees=500`) | `PASS` |
| `get_my_consultation_slots` | Slots | `test_all_doctor_read_and_mutating_tools` | Verified on live production after HITL slot creation & rejection recovery | `PASS` |
| `get_my_free_slots` | Slots | `test_all_doctor_read_and_mutating_tools` | Covered by contract & graph suite | `PASS` |
| `get_my_weekly_schedule` | Schedule | `test_all_doctor_read_and_mutating_tools` | Verified via live Google multi-tool test | `PASS` |
| `get_my_leaves` | Leaves | `test_all_doctor_read_and_mutating_tools` | Verified post-HITL leave approval/rejection | `PASS` |
| `get_my_statistics` | Analytics | `test_all_doctor_read_and_mutating_tools` | Covered by contract suite | `PASS` |
| `get_my_balance` | Finances | `test_all_doctor_read_and_mutating_tools` | Verified on live production chat (`doctor_read_tools`) | `PASS` |
| `get_my_earnings_summary` | Finances | `test_all_doctor_read_and_mutating_tools` | Covered by contract suite | `PASS` |
| `get_my_appointments` | Appointments | `test_all_doctor_read_and_mutating_tools` | Verified via live Google multi-tool test | `PASS` |
| `get_appointment_details` | Appointments | `test_all_doctor_read_and_mutating_tools` | Covered by contract suite | `PASS` |
| `list_my_patients` | Patients | `test_all_doctor_read_and_mutating_tools` | Covered by contract suite | `PASS` |
| `get_patient_info` | Patients | `test_all_doctor_read_and_mutating_tools` | Covered by contract suite | `PASS` |
| `get_patient_appointment_history` | Patients | `test_all_doctor_read_and_mutating_tools` | Covered by contract suite | `PASS` |
| `list_patient_medical_documents` | Medical RAG | `test_all_doctor_read_and_mutating_tools` | Covered by contract suite & Playwright E2E | `PASS` |
| `query_patient_medical_documents` | Medical RAG | `test_all_doctor_read_and_mutating_tools`, `test_medical_rag_pipeline.py` | Verified on live production (`doctor_authorized_rag` returned `84` and `26` with `/doctor/patients/{patientId}/medical-documents` citation) | `PASS` |
| `get_conversation_history` | Messaging | `test_all_doctor_read_and_mutating_tools` | Covered by contract suite | `PASS` |

### HITL-Gated Mutating Doctor Tools (`MUTATING_TOOL_ACTION_MAP` in `backend/app/features/ai_agent/tools/doctor_mutations.py`)

| Tool Name | `actionType` | Automated Approval & Execution Test | Live / Production Verification | Status |
| --- | --- | --- | --- | --- |
| `apply_leave` | `APPLY_LEAVE` | `test_all_doctor_read_and_mutating_tools`, `test_functional_completion.py` (reject) | Approved live in `test_live_doctor_google_multitool_and_hitl_leave_approval`; Rejected live on production (`rejectedApprovalId=c8c86c5de63d3427e99f1c7400a4fc28b`, `leavesCreated=0`) | `PASS` |
| `update_leave` | `UPDATE_LEAVE` | `test_all_doctor_read_and_mutating_tools` | Verified via executor & HITL contract suite | `PASS` |
| `cancel_leave` | `CANCEL_LEAVE` | `test_all_doctor_read_and_mutating_tools` | Verified via executor & HITL contract suite | `PASS` |
| `update_weekly_schedule` | `UPDATE_SCHEDULE` | `test_all_doctor_read_and_mutating_tools`, `test_doctor_schedule_approval.py` | Verified via Playwright E2E & PostgreSQL executor | `PASS` |
| `create_slot` | `CREATE_SLOT` | `test_all_doctor_read_and_mutating_tools` | Approved & executed live on production (`approvalId=c768d2719fc7f4d92a5337d19a4523bb3`, `slotId=c3b06a5552d704d2fb6191f6ab3e2d5b5`) | `PASS` |
| `update_slot_availability` | `UPDATE_SLOT` | `test_all_doctor_read_and_mutating_tools` | Verified via executor & HITL contract suite | `PASS` |
| `remove_slot` | `REMOVE_SLOT` | `test_all_doctor_read_and_mutating_tools` | Verified via executor & HITL contract suite | `PASS` |
| `update_my_profile` | `UPDATE_DOCTOR_PROFILE` | `test_all_doctor_read_and_mutating_tools` | Verified via executor & HITL contract suite | `PASS` |
| `update_appointment_status` | `UPDATE_APPOINTMENT` | `test_all_doctor_read_and_mutating_tools` | Verified via executor & HITL contract suite | `PASS` |
| `send_patient_message` | `SEND_PATIENT_MESSAGE` | `test_all_doctor_read_and_mutating_tools`, `test_relative_slot_dates_and_doctor_send_message_patient_id_resolution` | Verified `Patient.id` -> `Patient.userId` lookup & relation authorization | `PASS` |

**HITL Lifecycle Controls Verified (Doctor & Patient):**
- Pending `AgentApproval` persisted with SHA-256 `payloadHash`, `idempotencyKey`, and 600s (`APPROVAL_TTL_SECONDS = 600`) expiry.
- Rejections transition `AgentApproval.status` to `REJECTED` without domain mutation and resume/clear the LangGraph checkpoint interrupt so subsequent turns on the same thread succeed.
- Expired proposals return `HTTP 410`; unauthorized actors return `HTTP 403`; duplicate/re-claimed approvals return `HTTP 409` without double execution.

---

## 4. Patient AI Agent Functional Matrix (31 Tools: 22 Read-Only, 9 Mutating)

### Read-Only Patient Tools (`READ_ONLY_PATIENT_TOOLS` in `backend/app/features/ai_agent/graph/routing.py`)

| Tool Name | Category | Automated Contract & Integration Test | Live / Production Verification | Status |
| --- | --- | --- | --- | --- |
| `get_my_profile` | Account | `test_all_patient_read_tools_contracts_and_isolation` | Covered by contract suite | `PASS` |
| `get_my_medical_profile` | Health Profile | `test_all_patient_read_tools_contracts_and_isolation` | Covered by contract suite | `PASS` |
| `get_my_health_summary` | Health Profile | `test_all_patient_read_tools_contracts_and_isolation` | Covered by contract suite | `PASS` |
| `get_my_notifications` | Notifications | `test_all_patient_read_tools_contracts_and_isolation` | Covered by contract suite | `PASS` |
| `search_doctors` | Discovery | `test_all_patient_read_tools_contracts_and_isolation`, `test_live_groq_and_cohere_patient_tool_calling` | Verified live on Groq, Cohere, and production (`AcceptDoc` discovery) | `PASS` |
| `get_doctor_details` | Discovery | `test_all_patient_read_tools_contracts_and_isolation` | Covered by contract suite | `PASS` |
| `get_doctor_available_slots` | Availability | `test_all_patient_read_tools_contracts_and_isolation`, `test_relative_slot_dates_and_doctor_send_message_patient_id_resolution` | Verified `"today"`/`"tomorrow"` date resolution & slot availability | `PASS` |
| `get_doctor_schedule` | Availability | `test_all_patient_read_tools_contracts_and_isolation` | Covered by contract suite | `PASS` |
| `get_doctor_ratings` | Discovery | `test_all_patient_read_tools_contracts_and_isolation` | Covered by contract suite | `PASS` |
| `get_my_appointments` | Appointments | `test_all_patient_read_tools_contracts_and_isolation` | Covered by contract suite | `PASS` |
| `get_appointment_details` | Appointments | `test_all_patient_read_tools_contracts_and_isolation` | Covered by contract suite | `PASS` |
| `get_upcoming_appointments` | Appointments | `test_all_patient_read_tools_contracts_and_isolation`, `test_live_groq_and_cohere_patient_tool_calling` | Verified live on Groq & Cohere | `PASS` |
| `get_past_appointments` | Appointments | `test_all_patient_read_tools_contracts_and_isolation` | Covered by contract suite | `PASS` |
| `list_my_medical_documents` | Documents | `test_all_patient_read_tools_contracts_and_isolation` | Covered by contract & Playwright E2E suite | `PASS` |
| `get_my_document_details` | Documents | `test_all_patient_read_tools_contracts_and_isolation` | Covered by contract suite | `PASS` |
| `get_document_processing_status` | Documents | `test_all_patient_read_tools_contracts_and_isolation` | Verified `processingError`, `issueCount`, and `issues` detail fields | `PASS` |
| `search_my_medical_documents` | Medical RAG | `test_all_patient_read_tools_contracts_and_isolation`, `test_live_rag_followup_and_ungrounded_denial` | Verified live on production (first turn + follow-up + ungrounded ABO denial + post-delete zero-hit check) | `PASS` |
| `get_my_checkout_status` | Checkout/Payment | `test_all_patient_read_tools_contracts_and_isolation` | Covered by contract suite | `PASS` |
| `get_my_payment_status` | Checkout/Payment | `test_all_patient_read_tools_contracts_and_isolation` | Covered by contract suite | `PASS` |
| `list_my_doctor_conversations` | Messaging | `test_all_patient_read_tools_contracts_and_isolation` | Covered by contract suite | `PASS` |
| `get_my_messages` | Messaging | `test_all_patient_read_tools_contracts_and_isolation` | Covered by contract suite | `PASS` |
| `get_conversation_history` | Messaging | `test_all_patient_read_tools_contracts_and_isolation` | Covered by contract suite | `PASS` |

### HITL-Gated Mutating Patient Tools (`PATIENT_MUTATING_TOOL_ACTION_MAP` in `backend/app/features/ai_agent/tools/patient_mutations.py`)

| Tool Name | `actionType` | Automated Approval & Execution Test | Live / Production Verification & Notes | Status |
| --- | --- | --- | --- | --- |
| `update_my_profile` | `UPDATE_PATIENT_ACCOUNT` | `test_all_patient_mutating_executors_and_authorization` | Verified via PostgreSQL HITL executor | `PASS` |
| `update_my_medical_profile` | `UPDATE_MEDICAL_PROFILE` | `test_all_patient_mutating_executors_and_authorization` | Verified via PostgreSQL HITL executor | `PASS` |
| `cancel_my_appointment` | `CANCEL_PATIENT_APPOINTMENT` | `test_all_patient_mutating_executors_and_authorization` | Verified via PostgreSQL HITL executor; also forms cancel step of rescheduling workflow | `PASS` |
| `propose_appointment_booking` | `PROPOSE_BOOKING` | `test_all_patient_mutating_executors_and_authorization`, `test_patient_propose_booking_hitl_approval_with_datetime_hold` | Approved & executed live on production (`approvalId=c17c239bf072f445ba7cdec1fce70bc30`); creates slot `HELD` + checkout handoff without claiming confirmed/paid | `PASS` |
| `rename_my_document` | `RENAME_DOCUMENT` | `test_all_patient_mutating_executors_and_authorization` | Verified via PostgreSQL HITL executor | `PASS` |
| `delete_my_document` | `DELETE_DOCUMENT` | `test_all_patient_mutating_executors_and_authorization`, `test_delete_document_hitl_approval_nested_tx_and_rag_gemini_blocks` | Approved & executed live on production (`deleteApprovalId=c062a5937577846d1aac1dfd216b404a7`); invalidated document & embeddings | `PASS` |
| `send_doctor_message` | `SEND_DOCTOR_MESSAGE` | `test_all_patient_mutating_executors_and_authorization` | Verified via PostgreSQL HITL executor with relation check | `PASS` |
| `mark_notification_read` | `MARK_NOTIFICATION_READ` | `test_all_patient_mutating_executors_and_authorization` | Verified via PostgreSQL HITL executor | `PASS` |
| `submit_doctor_feedback` | `SUBMIT_DOCTOR_FEEDBACK` | `test_all_patient_mutating_executors_and_authorization` | Verified via PostgreSQL HITL executor (eligibility enforced) | `PASS` |

**Note on Rescheduling:** Quick-Clinic does not expose a standalone single-endpoint in-place reschedule mutation; `backend/app/features/ai_agent/prompts.py` instructs the Patient Agent to perform rescheduling transparently as two HITL steps (`cancel_my_appointment` followed by `propose_appointment_booking`).

---

## 5. Medical PDF Upload & Extraction Matrix

All document ingestion reuses pinned `search-sphere-ingest` (`rev = "f0f674ce9549139129f692b9f6812adbed64945a"`) with `TesseractOCRProvider()`, `vision=None`, `use_opencv=False`, and 25-page bounded batching (max 200 pages, max file size `MAX_FILE_BYTES`).

| # | Document Format / Case | Verification Test / Evidence | Observed Outcome | Status |
| --- | --- | --- | --- | --- |
| 1 | Native text PDFs | `test_simple_text_and_structured_lab_report_content`, `test_patient_upload_to_answer_e2e`, `prod_acceptance.py` | Full text, provenance bboxes, `READY` / `COMPLETED`, indexed chunks & 384-d embeddings | `PASS` |
| 2 | Scanned PDFs requiring OCR | `test_scanned_ocr_mixed_text_and_partial_unreadable`, Dockerfile `tesseract-ocr` | `TesseractOCRProvider` extracts rasterized page text; low/unreadable scan flagged accurately without crash | `PASS` |
| 3 | Mixed text and scanned documents | `test_scanned_ocr_mixed_text_and_partial_unreadable` | Native text + OCR text combined per page provenance | `PASS` |
| 4 | PDFs with drawn tables | `test_multipage_narrative_and_table_continuations`, `test_drawn_multipage_table_across_25_page_boundary_unicode_and_corrupt_pdf` | Extracted as `MedicalDocumentObject` (`kind="table"`) with normalized rows and page refs; borderless whitespace-aligned tables fall back to text paragraphs | `PASS` |
| 5 | Multi-page tables extending across pages & 25->26 batch boundary | `test_drawn_multipage_table_across_25_page_boundary_unicode_and_corrupt_pdf` | Drawn table spanning pages 25–26 merges into 1 table object (`firstPage=25`, `lastPage=26`) via `merge_continuations` | `PASS` |
| 6 | Medical charts and diagrams | `test_images_charts_and_diagrams` | Explicit limitation: with `vision=None` (free-tier architecture), vector/graphic charts without embedded text do NOT invent numerical chart values; job records `extractionStatus="PARTIAL"` and `MedicalExtractionIssue` `vision_provider_unavailable` (`chunkCount=0`) | `PASS` (honest partial reporting) |
| 7 | Embedded images containing text | `test_images_charts_and_diagrams`, `test_scanned_ocr_mixed_text_and_partial_unreadable` | OCR extracts readable labels from embedded raster images when `TesseractOCRProvider` finds text | `PASS` |
| 8 | Image-heavy medical reports | `test_images_charts_and_diagrams`, `test_scanned_ocr_mixed_text_and_partial_unreadable` | Handled within 25-page bounded batches; partial regions tracked via `MedicalExtractionIssue` | `PASS` |
| 9 | Multi-page laboratory reports | `test_simple_text_and_structured_lab_report_content`, `test_multipage_narrative_and_table_continuations`, `prod_acceptance.py` | Preserves page numbers, chunk provenance, and laboratory values across pages | `PASS` |
| 10 | Multilingual / Unicode content | `test_drawn_multipage_table_across_25_page_boundary_unicode_and_corrupt_pdf` | Preserved accents (`José García`) and UTF-8 medical markers cleanly across ingestion and chunking | `PASS` |
| 11 | Corrupted and encrypted PDFs | `test_drawn_multipage_table_across_25_page_boundary_unicode_and_corrupt_pdf`, `test_phase2_phase6_ingestion_reliability.py` | Upload rejects malformed PDF bytes with HTTP 400; direct ingestion marks `processingStatus="FAILED"` and `retryable=False` (`invalid_pdf` / `encrypted_pdf`) cleanly without infinite retry | `PASS` |
| 12 | Page limits (199, 200, 201 pages) | `test_page_count_validation_boundaries`, `test_bounded_ingestion_at_200_page_limit` | 199 & 200 pages accepted and processed in bounded batches; 201 pages rejected with HTTP 400 (`page_budget`) | `PASS` |

---

## 6. RAG & Embeddings Verification

- **Pinned RAG Engine:** `search-sphere-rag` (`rev = "f0f674ce9549139129f692b9f6812adbed64945a"`) driving `HybridRagEngine`.
- **Hosted Embeddings:** Primary Cohere `embed-english-light-v3.0` (384 dimensions), Google `gemini-embedding-001` (384-dim `outputDimensionality`) fallback; verified compatible document + query embeddings stored in PostgreSQL `pgvector` `MedicalChunkEmbedding` (`test_hosted_embeddings_pgvector.py`, live production check: `dimension=384`, `provider="cohere"`, `model="embed-english-light-v3.0"`).
- **Hybrid Retrieval & Serialization:** Dense `pgvector` cosine distance + PostgreSQL full-text (`websearch_to_tsquery`) lexical search merged via Reciprocal Rank Fusion (`RRF`), protected by a shared `asyncio.Lock` around single-`AsyncConnection` `db.execute(...)` calls in `QuickClinicVectorRetriever` and `QuickClinicLexicalRetriever`, followed by Cohere `rerank-v3.5` reranking (`test_pgvector_hybrid_rag.py`).
- **Query Classification & Rewriting:** Follow-up questions (e.g. `"What was the fasting glucose value in that same report?"`) resolve prior thread context reliably (`test_live_rag_followup_and_ungrounded_denial` and live production Step 8 `followUpHas109: true`).
- **Citations & Grounding:** Grounded answers attach `documentId`, `documentVersionId`, `chunkStableId`, `retrievalHitId`, `pageNumber`, `sourceRefs`, and role-specific `href` (`/patient/medical-documents` for Patient; `/doctor/patients/{patientId}/medical-documents` for Doctor). Response metadata explicitly distinguishes `generationMode` (`"llm"`, `"fallback_snippets"`, or `"no_evidence"`), provider, and model. Ungrounded questions (e.g. ABO blood group absent from the uploaded lab PDF) do not hallucinate facts.
- **Deletion Invalidation:** Deleting a document (`DELETE /api/patients/me/medical-documents/{id}` or `delete_my_document` HITL approval inside nested transaction) purges document chunks/embeddings and removes storage objects; subsequent RAG queries return zero hits and zero citations to the deleted document (`test_medical_rag_pipeline.py`, `test_functional_completion.py`, Playwright E2E, and live production Step 11).

---

## 7. LangGraph & Provider Verification

- **State Machine & Threading:** `build_workflow` orchestrates `model -> route -> [sequential_tool_node | approval_node | tool_limit_node | blocked_tool_node | END]` with `AsyncPostgresSaver` PostgreSQL checkpoint persistence (`checkpoints`, `checkpoint_blobs`, `checkpoint_writes`), `MAX_TOOL_CALLS_PER_TURN` guard, and deterministic message IDs (`qc_system_prompt`, `qc_memory_summary`, `qc_msg_*`) preventing checkpoint history duplication across turns.
- **Sequential Multi-Tool & Error Safety:** Multiple read-only tool calls in one turn execute sequentially on the request `AsyncConnection`; mixed read+mutating calls execute one safe mutating proposal; tool exceptions (`HTTPException(404)` etc.) convert cleanly into error `ToolMessage`s without crashing the HTTP request.
- **Live Hosted Providers Verified:**
  - Google (`gemini-3.1-flash-lite`): Live Doctor multi-tool + HITL approval + RAG answers (`_extract_ai_text` handles `list[dict]` content blocks).
  - Groq (`openai/gpt-oss-120b`): Live Patient tool calling (`search_doctors`, `get_upcoming_appointments`) with all 31 Patient tools bound.
  - Cohere (`command-a-03-2025`): Live Patient tool calling (`search_doctors`, `get_upcoming_appointments`) with all 31 Patient tools bound.
- **Provider Fallback:** `BindableFallbackChatModel` wraps provider models bound to the role's toolset and falls back across configured providers on `TimeoutError`, `ConnectionError`, `httpx` errors, and Google/Groq/Cohere rate-limit/API errors (`test_bindable_fallback_model_recovers_on_rate_limit_and_api_errors`).

---

## 8. Issues Found and Fixed During Final Completion

| Issue Discovered | Root Cause | Fix & PR |
| --- | --- | --- |
| Provider fallback factory was never wired into `AIAgentService` | `AIAgentService.__init__` ignored `get_fallback_model`; tools wouldn't stay bound across `.with_fallbacks(...)` | Added `BindableFallbackChatModel` and `_fallback_exceptions()` in `backend/app/features/ai_agent/models/fallback.py`; wired into `service.py` (PR #189) |
| Multiple tool calls in a single LLM turn crashed graph execution | `routing`/`nodes.py` raised on `len(tool_calls) > 1` or ran concurrently on one SQLAlchemy `AsyncConnection` | Implemented `sequential_tool_node` with JSON serialization & `HTTPException` -> error `ToolMessage` handling in `nodes.py`/`workflow.py` (PR #189) |
| Rejected HITL approvals left dangling LangGraph interrupts blocking future turns on the thread | `decide_and_resume_approval` skipped resuming LangGraph checkpoint on `"REJECTED"` | Resumed interrupted thread with `Command(resume=REJECTED)` under `REJECT:{approval_id}` turn and routed `ApprovalRejected` to a clean closing `ToolMessage` (PR #189) |
| Gemini `list[dict]` content blocks leaked raw repr or broke RAG extraction; `google` RAG lacked fallback loop; Doctor citations used broken `/doctor/patients/{id}` `href` | `rag/pipeline.py` called `str(msg.content)`, called a single provider, and formatted `/doctor/patients/{id}` instead of `/medical-documents` | Added `_extract_ai_text`, provider fallback loop, `generationMode` metadata, and fixed `/doctor/patients/{id}/medical-documents` `href` (PR #189) |
| Hybrid RAG `asyncio.gather` raced on a single SQLAlchemy `AsyncConnection` | `HybridRagEngine.retrieve` invoked `QuickClinicVectorRetriever` and `QuickClinicLexicalRetriever` concurrently on `self.db` | Shared per-retrieval `asyncio.Lock` in `rag/adapters.py` and `rag/retrieval.py` (PR #189) |
| Patient `delete_my_document` committed outer transaction inside `db.begin_nested()`; checkpoint turns duplicated message history | `delete_patient_document` always committed; `chat_turn` passed full DB history to checkpointed threads | Added `commit: bool = True` (`commit=False` in `patient_executor.py`); added deterministic `qc_msg_*` IDs + `aget_state` delta check in `service.py` (PR #189) |
| Corrupt PDF ingestion raised unhandled `pymupdf` error and stayed retryable; relative slot dates `"today"`/`"tomorrow"` failed | `pipeline_runner.py` didn't wrap `pymupdf.open` into non-retryable `IngestError("invalid_pdf")`; `get_doctor_available_slots` expected YYYY-MM-DD only; `send_patient_message` required `User.id` even when passed `Patient.id` | Fixed in `pipeline_runner.py`, `patient_account_tools.py`, `patient_document_tools.py`, `doctor_executor.py`, and `/api/health` `RENDER_GIT_COMMIT` reporting (PR #189) |
| Approved Patient mutations returning `datetime` (discovered in live prod acceptance on `PROPOSE_BOOKING`) triggered `409 Execution state cannot be completed` | `record_tool_call` in `telemetry.py` passed non-JSON `datetime` objects into SQLAlchemy JSONB after `complete_execution(..., success=True)` already ran inside the same `try:` in `hitl_bridge.py` | Added `_json_safe` in `telemetry.py`, separated `complete_execution` from `record_tool_call` in `hitl_bridge.py`, and added Postgres regression test (PR #190) |

---

## 9. Test Suite Results (Verified on Commit `3cb36be3d84bc0337a063f95d966b33f02023cb1`)

| Check / Suite | Environment | Exact Result | Notes |
| --- | --- | --- | --- |
| Backend Lint (`uv run --directory backend ruff check app tests`) | Local + CI | `All checks passed!` (0 errors) | — |
| Backend Test Suite (`pytest --cov=app --cov-report=term-missing -q`) | Local PostgreSQL 16 + `pgvector` (`QC_REQUIRE_POSTGRES=true`) | `939 passed, 13 skipped` (`87.29%` coverage, gate `80.0%`) | The 13 skipped tests are opt-in `@pytest.mark.live` tests that are run separately with `--run-live` below |
| Hosted RAG + Live Multi-Provider LLM Acceptance (`pytest ... --run-live --timeout=180 -v`) | Local PostgreSQL + `pgvector` + live Google, Groq, Cohere APIs | `6 passed` (`test_hosted_embeddings_pgvector.py`, `test_pgvector_hybrid_rag.py`, `test_live_llm_and_rag_acceptance.py`) | Covers hosted embeddings, pgvector indexing, hybrid + rerank, follow-up rewrite, ungrounded denial, Google Doctor HITL, Groq & Cohere Patient tool calling |
| Live Deployment Smoke Tests (`pytest tests/live --run-live -v`) | Deployed Vercel + Render (`3cb36be`) | `7 passed` | Health/readiness on both origins, unauthenticated file isolation, Socket.IO transport, login UI render |
| Frontend Type Check (`pnpm type-check`) | Local + CI | `Passed` (0 errors) | `tsc --noEmit` |
| Frontend Lint (`pnpm lint`) | Local + CI | `Passed` (0 errors) | `oxlint` 55 warnings, `eslint` pre-existing warnings only |
| Frontend Unit & Hook Coverage (`pnpm test:coverage`) | Local + CI (Vitest) | `28 test files, 112 passed` | `src/hooks/useAgentChat.ts` `82.04%`, `src/lib/ai-agent/` `81.7%` (repo overall `22.6%`) |
| Browser E2E Suite (`pnpm test:e2e`) | Isolated PostgreSQL + Chromium + Next build | `5 passed (28.3s)` | Full PDF upload -> `READY` -> Patient RAG -> Doctor RAG (citation `href` verified) -> HITL schedule approval -> delete invalidation + auth/a11y checks |
| GitHub Actions CI (`main`, Run `44132268793`) | GitHub Ubuntu + `pgvector:pg16` | `success` (`frontend`, `backend`, `browser` all green) | Ran automatically on merge of PR #190 (`3cb36be`) |

---

## 10. Production Verification Results (Live End-to-End Acceptance)

Executed through `https://quick-clinic-nine.vercel.app/api/*` (proxying to `https://quick-clinic-api-u91s.onrender.com` on commit `3cb36be3d84bc0337a063f95d966b33f02023cb1`) against Supabase (`atsicusbhiujthlshszg`), using strictly isolated synthetic users/records and zero live Razorpay charges (`OFFLINE` confirmation used purely to establish an authorized `CONFIRMED` clinical relationship for Doctor RAG).

| Journey Step | Outcome | Verified Production Evidence |
| --- | --- | --- |
| 1. Proxy & Health Revision Check | `PASS` | `GET /api/health` returned `environment="production"`, `gitCommit="3cb36be3d84bc0337a063f95d966b33f02023cb1"` |
| 2. Synthetic Patient & Doctor Signup + Login | `PASS` | `patientId=caf5a6e5dbe464868847215816b77e046`, `doctorId=c5454f1a24eb8432f872614b624682427`, HttpOnly cookie auth verified |
| 3. Doctor Read Tools (`get_my_profile`, `get_my_balance`) | `PASS` | `threadId=cfd3f80c8eb034c23bc3c40a874be3a7d`, returned accurate synthetic specialty (`GENERAL_PHYSICIAN`) and fee (`500`) |
| 4. Doctor HITL Mutation (`create_slot` Approved) | `PASS` | `approvalId=c768d2719fc7f4d92a5337d19a4523bb3` -> `status="APPROVED"`, `executionStatus="COMPLETED"`, `slotId=c3b06a5552d704d2fb6191f6ab3e2d5b5` persisted |
| 5. Doctor HITL Rejection (`apply_leave` Rejected) + Thread Recovery | `PASS` | `rejectedApprovalId=c8c86c5de63d3427e99f1c7400a4fc28b` -> `leavesCreated=0`; subsequent `get_my_consultation_slots` turn succeeded on same thread |
| 6. Patient Discovery + HITL Booking Hold (`propose_appointment_booking`) | `PASS` | `approvalId=c17c239bf072f445ba7cdec1fce70bc30` -> `BOOKING_HOLD_CREATED`, slot `HELD` with checkout handoff (never claimed paid); confirmed `OFFLINE` (`appointmentId=c880ab26cf66d48cb8cdd677b404cc28c`) |
| 7. Medical PDF Upload -> `READY` -> Hosted Embeddings | `PASS` | `documentId=cf9cf14229c3141ba946b40f3dc8bff7b`, `processingStatus="READY"`, `chunkCount=1`, `vectorCount=1`, `embeddingDimensions=384`, `provider="cohere"`, `model="embed-english-light-v3.0"` |
| 8. Patient RAG + Citations + Follow-up + Negative Guard | `PASS` | Thread `c221271c25dfd4f3db9a886fbbd08c989` answered Ferritin Alpha-9 (`84`) & Vitamin D (`26`) with `/patient/medical-documents` citation (`pageNumber=1`, `retrievalHitId=ceb72e4868d084d83b2c9585a7503b368`), answered follow-up Fasting Glucose (`109`), denied absent ABO blood group |
| 9. Authorized Doctor RAG + Clinical Citation Route | `PASS` | Answered `84` and `26` on thread `cfd3f80c8eb034c23bc3c40a874be3a7d` with citation `href="/doctor/patients/caf5a6e5dbe464868847215816b77e046/medical-documents"` |
| 10. Refresh Persistence (`GET /api/ai-agent/threads/{id}`) | `PASS` | Persisted 6 Patient messages and 12 Doctor messages across fresh requests |
| 11. Document Deletion HITL + Retrieval Invalidation | `PASS` | `deleteApprovalId=c062a5937577846d1aac1dfd216b404a7` -> `remainingDocsForId=0`, subsequent Patient RAG returned 0 citations and did not hallucinate deleted values |
| 12. Full Synthetic Cleanup Verification | `PASS` | `cleanupExactMatch=true` across all 13 checked tables (`User=15`, `Doctor=8`, `Patient=5`, `Appointment=1`, `Slot=283`, `Leave=0`, `MedicalDocument=1`, `MedicalDocumentVersion=0`, `MedicalDocumentChunk=0`, `MedicalChunkEmbedding=0`, `AgentThread=1`, `AgentApproval=4`, `AgentMessage=16` — identical before & after) |

---

## 11. Deployment & PR Summary (PRs #181–#190)

| PR # | Title | Merge Commit SHA | Merged At (UTC) |
| --- | --- | --- | --- |
| #181 | `feat(ai-agent): complete patient AI agent and shared Search Sphere RAG pipeline` | `e25c3f1652449c59ab714c700e30d16fbb0bda43` | `2026-11-14T22:34:54Z` |
| #182 | `fix(ai-agent): prevent instantly expired approvals and allow 10-minute review` | `1d0f28c8a9a82c1cf4c719021110b6b1af207411` | `2026-11-15T10:47:23Z` |
| #183 | `feat(ai-agent): medical RAG hardening, bounded ingestion, and acceptance` | `384528e550aa7a11dad294a5dfd36f4221e9dce5` | `2026-11-15T18:01:46Z` |
| #184 | `feat(ai-agent): lock formatted search-sphere-rag, 200-page boundaries, and extraction acceptance` | `35e28d5f1e6ca16c139d8ecb704e1676fedcbcf9` | `2026-11-15T19:51:22Z` |
| #185 | `feat(ai-agent): add OCR tesseract pipeline, keep-alive state machine, and E2E browser acceptance` | `dcc6cf5e8ee2af4e8cdd749278c60f9f004952b0` | `2026-11-15T21:38:48Z` |
| #186 | `fix(ai-agent): align tool contracts, durable ingestion retries, and HITL recovery` | `36c2f18535cd39c4870d881ec2b28fa6593c27e4` | `2026-11-15T23:19:47Z` |
| #187 | `fix(config): align Supabase hostname in next.config.ts and render.yaml` | `838c38e29b9c110bee8934c23d6fa2daa5d3061e` | `2026-11-16T12:32:16Z` |
| #188 | `fix(ci): update keep-alive default Render URL to quick-clinic-api-u91s` | `1893ad7783749c0a07d39c0ff7a2149f95ae2a4b` | `2026-11-16T12:39:26Z` |
| #189 | `fix(ai-agent): wire provider fallback, sequential multi-tool execution, RAG JSON/citation fixes, and HITL durability` | `e927d2eb4054d33ea7b8fe92a76da60cdc9cf9fb` | `2026-11-17T16:13:17Z` |
| #190 | `fix(ai-agent): JSON-encode HITL tool call telemetry before PostgreSQL JSONB persistence` | `3cb36be3d84bc0337a063f95d966b33f02023cb1` | `2026-11-17T17:00:58Z` |

---

## 12. Remaining Risks & Next-Phase Readiness

1. **Pure Graphic Chart / Vision Extraction (`vision=None`):** Under the free-tier hosted architecture, `DocumentPipeline` intentionally runs with `vision=None` and `TesseractOCRProvider`. Vector/graphic medical charts without embedded selectable text produce `extractionStatus="PARTIAL"` with `vision_provider_unavailable` and do not extract numerical series from visual plots (preserving strict zero-hallucination guarantees).
2. **Free-Tier LLM & Cold-Start Latency:** Live multi-turn/HITL requests observed up to ~54s under Render free-tier CPU/external provider latency, safely under the Next.js 120s `proxyTimeout`. Multi-provider rate limits recover via `BindableFallbackChatModel` (`google -> groq -> cohere`).
3. **Out-of-Scope Items Deferred to Next Phase:** Dedicated LLM evaluation suites (RAGAS/DeepEval/LangSmith datasets, LLM-as-judge), advanced guardrail frameworks, and standalone security-hardening initiatives are intentionally deferred to the upcoming evaluation and hardening phase, now unblocked by a verified functional baseline.
