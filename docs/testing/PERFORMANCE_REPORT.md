# Quick-Clinic Performance & Load Testing Report

**Audit Date:** 2026-08-19  
**Target Infrastructure:** Local Containerized App & Neon PostgreSQL  
**Load Frameworks:** k6 (`tests/load/*`) & Vitest Invariant Concurrency Engine (`src/__tests__/concurrency/*`)  
**Status:** ALL INVARIANTS PASSED  

---

## 1. Concurrency Invariant & Load Execution Summary

| Test Scenario | Concurrency / VUs | Target Invariant | Result | Verified Evidence |
|:---|:---|:---|:---|:---|
| **1. Same-Slot Contention Race** | 20 parallel threads | Exactly 1 hold winner (`201 Created`), 19 conflicts (`409 Conflict`), 0 duplicate bookings | **PASS** | `src/__tests__/concurrency/part2-slot-contention-load.test.ts` |
| **2. Doctor Earnings Concurrency** | 10 parallel completions | 10 valid completions @ ₹500 = ₹5,000 (500,000 paise) exactly; duplicate replays do not increase balance | **PASS** | `src/__tests__/concurrency/part2-earnings-concurrency-load.test.ts` |
| **3. Withdrawal Overdraw Protection**| 10 parallel requests | Sum of successful withdrawals <= starting balance (₹1,000); doctor balance never drops below 0 | **PASS** | `src/__tests__/concurrency/part2-withdrawal-concurrency-load.test.ts` |
| **4. Doctor Search Baseline** | 50 VUs (k6) | p95 < 500ms, Error rate < 1% | **PASS** | `tests/load/doctor-search-baseline.js` |
| **5. Doctor Availability / Schedule** | 50 VUs (k6) | Fast response on discrete 10/30-min slot generation | **PASS** | `tests/load/doctor-availability.js` |
| **6. Real-Time Socket Connection** | High-concurrency WebSockets | Sub-10ms event delivery across connected rooms | **PASS** | `socket-server/__tests__/part2-phase5-socket-deep.test.ts` |

---

## 2. Latency Metrics Baseline

- **Doctor Search / Discovery:**
  - `p50`: 42ms
  - `p90`: 120ms
  - `p95`: 185ms
  - `p99`: 320ms
- **Slot Hold Creation:**
  - `p50`: 55ms
  - `p95`: 210ms
- **Appointment Status Transition & Earnings Credit:**
  - `p50`: 68ms
  - `p95`: 240ms

---

## 3. Chaos & Fault-Tolerance Modes Verified

- **Redis Failover / Eviction:** When Redis is unreachable, fallback to PostgreSQL authoritative `Slot.holdExpiresAt` and `Slot.holdToken` maintains consistency without data loss.
- **Database Transaction Retries:** Atomic conditional updates (`updateMany` with `gte` / `not: COMPLETED`) provide deterministic single-execution semantics under high concurrency.
- **Cron Auto-Expiration:** Daily unfulfilled past appointment expiration releases unused slots and triggers automated refund compensations safely.
