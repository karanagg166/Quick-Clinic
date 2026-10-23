# Quick-Clinic Test Inventory & Quality Verification Matrix

> **Project**: Quick-Clinic (`https://github.com/karanagg166/Quick-Clinic`)  
> **Production URL**: `https://quick-clinic-nine.vercel.app`  
> **Socket Server**: `https://quickclinic-socket-server.onrender.com`  
> **Architecture**: Next.js 16 (App Router) + Prisma ORM + PostgreSQL (Supabase) + Node.js Socket.IO Server (Render) + Upstash Redis + Razorpay + Search-Sphere RAG  
> **Verified Baseline**: 188 Vitest Test Suites (186 Passed, 2 Skipped, 1,225 Tests Passed) + Playwright E2E Suite

---

## 1. Architecture & Testing Topology

Quick-Clinic operates with a dual-deployment topology:
- **Next.js Web Application (`quick-clinic-nine.vercel.app`)**: Serves doctor discovery, patient portals, appointment scheduling, checkout flows, medical document uploads, and admin dashboards via Vercel Serverless.
- **Socket.IO Server (`quickclinic-socket-server.onrender.com`)**: Standalone Node.js WebSocket process hosted on Render Singapore providing real-time chat, video consultation signaling, and live appointment notifications.
- **Database & Storage**: PostgreSQL hosted on Supabase; Upstash Redis for rate limiting and lock distribution; Cloudinary for avatars; private Supabase Storage for medical documents.
- **External Services**: Razorpay for payment order creation and webhook reconciliation; Search-Sphere for semantic retrieval and clinical question answering over patient documents.

---

## 2. Test Execution Inventory by Level

### Level 1: Unit Tests (`src/__tests__/unit/`, `src/__tests__/lib/`)
Pure logic, date-time transformations, financial calculations, signature verification, and input validation.

| Feature Area | Source Module | Test Suite | Verified Invariants |
| :--- | :--- | :--- | :--- |
| **Canonical UTC Conversions** | `src/lib/dateUtils.ts` | `phase79-date-utils.test.ts`, `appointment-time-consistency.spec.ts` | **PR #156 Invariant**: Converts local clinic dates & times to strict UTC instants (`localDateAndTimeToUtc`); guarantees cross-timezone slot consistency; preserves legacy slot string fallbacks (`isLegacySlot`). |
| **Payment Signature Verification** | `src/lib/razorpay.ts` | `phase14-razorpay-signature.test.ts` | HMAC-SHA256 signature verification over `order_id|payment_id`; timing-safe comparison; tamper rejection. |
| **Doctor Earnings Calculation** | `src/lib/earnings.ts` | `phase13-doctor-earnings.test.ts` | 80/20 platform fee split, integer paise precision (no floating point drift), tax withholding assertions. |
| **Leave Date Overlap Detection** | `src/lib/doctorSchedule.ts`| `part2-phase2-doctor-deep.test.ts` | Closed-interval collision detection; DST boundary resistance; multi-day leaves. |
| **Health Liveness Route** | `src/app/api/health/route.ts` | `src/__tests__/api/health.test.ts` | Returns HTTP 200 with `status: ok` and service metadata without side-effects or DB dependencies. |

---

### Level 2: Component Tests (`src/__tests__/frontend/components/`)
React 19 component rendering, accessibility, form validation, and user interaction states.

| Component Group | Component Path | Test Suite | Test Assertions |
| :--- | :--- | :--- | :--- |
| **Doctor Profile & Cards** | `components/features/DoctorCard.tsx` | `doctorCard.test.tsx` | Specialization badge rendering, consultation fee formatting, rating calculation, book CTA state. |
| **Appointment Booking Modal** | `components/features/BookingModal.tsx` | `bookingModal.test.tsx` | Slot picker grid, UTC time display, hold countdown timer, disabled occupied slots. |
| **Medical Document Uploader** | `components/features/DocumentUpload.tsx` | `documentUpload.test.tsx` | File size limits (15MB), MIME type whitelist (PDF/PNG/JPEG), progress bar, error alerts. |
| **Design System Components** | `components/ui/*` | `button.test.tsx`, `card.test.tsx`, `input.test.tsx`, `badge.test.tsx` | Keyboard focus, ARIA attributes, variant styles, disabled state interactions. |

---

### Level 3: API & Endpoint Tests (`src/__tests__/api/`)
Next.js App Router API handlers, request parsing, authentication checks, and database transactions.

| API Domain | Route Path | Test Suite | Key Behaviors Verified |
| :--- | :--- | :--- | :--- |
| **Slot Hold & Lock** | `/api/appointments/hold` | `phase21-appointment-hold.test.ts` | Monopolistic 10-minute hold lock; TTL expiration in Redis/DB; conflict 409 rejection. |
| **Razorpay Checkout** | `/api/user/[id]/payments/createOrder` | `phase22-payment-order.test.ts` | Order creation with idempotency key, amount in paise, currency INR, metadata linkage. |
| **Razorpay Webhooks** | `/api/webhooks/razorpay` | `phase23-payment-webhook.test.ts` | Webhook signature check, duplicate event idempotency, auto-capture transition to CONFIRMED. |
| **Appointment Completion** | `/api/doctors/[id]/appointments/[id]` | `phase24-appointment-completion.test.ts` | Status transition to COMPLETED, credit doctor earnings, generate receipt. |
| **Doctor Leave Management**| `/api/doctors/[id]/leave` | `doctor-leave-and-patient-history.test.ts`| Creates leave window, auto-cancels overlapping bookings, refunds patients, notifies via Socket. |
| **Admin Analytics** | `/api/admin/analytics` | `part2-phase6-admin-deep.test.ts` | Platform GMV aggregation, active doctor ratios, withdrawal queue metrics. |

---

### Level 4: Feature & Integration Tests (`src/__tests__/integration/`)
Full multi-system integration: Database + Cache + Payments + Sockets + External Services.

| Integration Suite | Test File | Verified End-to-End Invariants |
| :--- | :--- | :--- |
| **Payment Booking Realtime** | `integration/payment-booking-realtime.test.ts` | Patient selects slot -> holds lock -> creates Razorpay order -> completes payment -> appointment state updates -> Socket.IO emits appointment confirmation to doctor and patient. |
| **Unified Checkout Hardening** | `integration/unified-checkout-hardening.test.ts` | Handles payment failure, gateway timeout, user abandonment, hold expiry auto-release, and retry flow. |
| **Medical Records Pipeline** | `src/__tests__/api/patients/me/medical-documents/` | Patient uploads PDF -> stored in Supabase Storage -> registered in DB -> dispatched to Search-Sphere for indexing. |

---

### Level 5: Contract & External Integration Tests
Verifies schema compatibility and protocol guarantees with upstream/downstream services.

| Interface Contract | Test File | Contract Guarantees |
| :--- | :--- | :--- |
| **Quick-Clinic <-> Search-Sphere**| `src/__tests__/contracts/search-sphere-contract.test.ts` | Authenticates with `Bearer ss_live_*` or `QUICK_CLINIC_SERVICE_SECRET`; passes `X-Patient-ID`, `X-Tenant-ID`; consumes `/internal/medical-documents/ingest` and `/internal/medical-rag/chat` SSE responses. |
| **Socket.IO Event Protocol** | `socket-server/__tests__/` | Client authentication via JWT; room scoping `appointment:{id}`, `doctor:{id}`; handles disconnect, reconnect, and presence heartbeats. |
| **Razorpay Webhook Contract** | `src/__tests__/contracts/razorpay-webhook-contract.test.ts` | Matches exact Razorpay webhook schema (`payment.captured`, `payment.failed`, `refund.processed`). |

---

### Level 6: Concurrency & Stress Tests (`src/__tests__/concurrency/`)
Race conditions, distributed locking, and double-spend defenses.

| Test Focus | Test Suite | Concurrency Assertion |
| :--- | :--- | :--- |
| **Double Booking Race Condition**| `part2b-scale100-concurrency.test.ts` | 100 concurrent hold requests for the same slot: **exactly 1 succeeds (200)**, 99 receive conflict (409); 0 duplicate appointments in DB. |
| **Doctor Earnings Concurrency** | `part2-earnings-concurrency-load.test.ts` | 10 parallel appointment completions @ ₹500: credited exactly 500,000 paise with duplicate idempotency. |

---

### Level 7: End-to-End Tests (`e2e/`)
Browser-level user journeys executed via Playwright against running web application.

- `e2e/appointment-time-consistency.spec.ts`: Validates that an appointment booked across Indian Standard Time (IST), UTC, and US Eastern (EST) displays the exact identical chronological instant across doctor and patient dashboards.
- `e2e/doctor-consultation-flow.spec.ts`: Patient login -> search doctor -> book slot -> checkout -> enter consultation room.

---

## 3. Health Monitoring & Keep-Alive Integration

- **Web Endpoint**: `https://quick-clinic-nine.vercel.app/api/health` (Fast JSON liveness probe).
- **Socket.IO Endpoint**: `https://quickclinic-socket-server.onrender.com/health` and `/ready` (Process liveness + Socket server readiness).
- **Scheduled Monitor**: Monitored every 10 minutes via GitHub Actions (`cron: "7,17,27,37,47,57 * * * *"`) with cold-start backoff to keep Render free tier responsive.
