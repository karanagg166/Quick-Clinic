# Quick-Clinic High-Level Failure Scenarios & Mitigation Guide

## 1. Overview

This document specifies the failure recovery modes, race conditions, resilience patterns, and edge case behaviors across Quick-Clinic's distributed architecture.

---

## 2. Failure Scenarios & Mitigations

### 2.1 Concurrency & Slot Contention
- **Risk:** Two patients click "Book Now" on the same available slot at the exact same millisecond.
- **Mitigation:**
  1. Redis SETNX lock `lock:slot:<slotId>` ensures only one thread acquires the hold.
  2. Postgres atomic conditional update `UPDATE "Slot" SET status = 'HOLD', "holdExpiresAt" = ..., "holdToken" = ... WHERE id = ... AND (status = 'AVAILABLE' OR ("holdExpiresAt" < NOW() AND status = 'HOLD'))` provides secondary database-level atomicity.
  3. The losing thread receives an immediate `409 Conflict: Slot is already on hold`.

### 2.2 Redis Eviction / Outage During Checkout
- **Risk:** Redis crashes or keys evict while a patient is entering credit card details in Razorpay modal.
- **Mitigation:**
  1. Postgres `Slot.holdExpiresAt` and `Slot.holdToken` retain the authoritative hold state.
  2. `ownsHold(slotId, token)` falls back to querying Postgres if Redis returns null, verifying `slot.holdToken === token` and `slot.holdExpiresAt > new Date()`.

### 2.3 Payment Verification Gateway Timeout
- **Risk:** Razorpay deducts money from patient bank account, but network drops before `verifyOrder` completes.
- **Mitigation:**
  1. The payment record is created in `PENDING` state with `orderId`.
  2. If client-side verification reconnects, `verifyOrder` is idempotent: it validates HMAC signature, updates `Payment.status = 'SUCCESS'`, and completes booking.
  3. If hold expired and slot was lost, `verifyOrder` logs critical error, records `paymentId`, and initiates an automated Razorpay refund.

### 2.4 Doctor Withdrawal Double-Spend
- **Risk:** Doctor sends two parallel withdrawal requests for the full balance.
- **Mitigation:**
  1. `POST /api/doctors/[doctorId]/withdrawals` executes inside an interactive `prisma.$transaction`.
  2. Doctor record is queried with current balance; balance is decremented immediately and withdrawal created atomically.
  3. The second transaction observes the decremented balance and fails with `400 Insufficient balance`.

### 2.5 Cron Failure & Past Unfulfilled Appointments
- **Risk:** A doctor accepts an appointment but fails to attend or mark complete.
- **Mitigation:**
  1. Daily midnight cron (`GET /api/cron/expire-appointments` with `CRON_SECRET`) queries unfulfilled past appointments.
  2. Status transitions to `EXPIRED`, slot is released to `AVAILABLE`, and online payments are automatically refunded via Razorpay.
  3. Batched execution (`take: 50`) and request timeouts (`AbortSignal.timeout(1000)`) prevent cron execution bottlenecks.

### 2.6 Socket Server Disconnect & Unread Notifications
- **Risk:** Patient is offline or disconnected when doctor confirms appointment or sends message.
- **Mitigation:**
  1. All domain events create durable PostgreSQL records (`Notification`, `ChatMessages`).
  2. Sockets serve as transient notification delivery; client UI re-fetches unread notifications and chat history from REST APIs upon reconnection.

### 2.7 Doctor Leave Application & Existing Appointments Cascade
- **Risk:** Doctor applies leave covering dates with existing confirmed or pending appointments.
- **Mitigation:**
  1. Overlapping appointments are automatically transitioned to `CANCELLED`.
  2. Covered slots are transitioned to `ON_LEAVE`.
  3. Online payments trigger automated refund processing.
  4. Durable patient notifications and audit log entries are generated immediately.
  5. Subsequent deletion of the leave restores available slots while guaranteeing that cancelled appointments never revive.

### 2.8 Concurrent Appointment Completion & Double-Crediting
- **Risk:** Rapid double-click or simultaneous completion requests for the same appointment could double-credit the doctor's balance.
- **Mitigation:**
  1. Completion execution occurs in an interactive transaction with `appointment.updateMany({ where: { id, status: { not: 'COMPLETED' } }, data: { status: 'COMPLETED' } })`.
  2. Only the single winning transaction that transitioned the status from non-`COMPLETED` increments the doctor balance by `fees * 100` paise.
  3. Subsequent replays observe `count === 0` and return HTTP 200 idempotently without crediting the doctor balance again.

