import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { createToken } from "@/lib/auth";
import { POST as confirmPOST } from "@/app/api/appointments/confirm/route";
import { POST as webhookPOST } from "@/app/api/webhooks/razorpay/route";
import { POST as reconcilePOST } from "@/app/api/cron/reconcile-payments/route";
import { initiateCheckout, verifyAndFinalizeCheckout, expireStaleCheckouts } from "@/lib/checkout-service";
import {
  reconcileUnresolvedOrders,
  reconcileCapturedCheckouts,
  reconcilePendingRefunds,
  replayRetryableWebhookEvents,
} from "@/lib/reconciliation-service";
import * as RazorpayModule from "@/lib/razorpay";
import { isMockTestKey } from "@/lib/razorpay";

// Fast in-memory Upstash Redis mock for deterministic Redis mutex testing without remote DNS delays
const inMemoryRedis = new Map<string, any>();
vi.mock("@upstash/redis", () => ({
  Redis: class MockRedis {
    set(key: string, value: any, options?: any) {
      if (options?.nx && inMemoryRedis.has(key)) {
        return Promise.resolve(null);
      }
      inMemoryRedis.set(key, value);
      return Promise.resolve("OK");
    }
    get(key: string) {
      return Promise.resolve(inMemoryRedis.get(key) || null);
    }
    del(key: string) {
      inMemoryRedis.delete(key);
      return Promise.resolve(1);
    }
    eval(script: string, keys: string[], args: any[]) {
      const val = inMemoryRedis.get(keys[0]);
      if (!val) return Promise.resolve(0);
      if (val === args[0]) {
        inMemoryRedis.delete(keys[0]);
        return Promise.resolve(1);
      }
      return Promise.resolve(0);
    }
  },
}));

describe("Unified Checkout Hardening Suite", () => {
  const cronSecret = "test_cron_secret_hardening_12345";
  const runId = `harden_${Date.now()}`;
  let patientUser: any;
  let patientRecord: any;
  let patientToken: string;
  let doctorUser: any;
  let doctorRecord: any;
  let slot: any;
  let slotDate: Date;

  beforeAll(async () => {
    process.env.CRON_SECRET = cronSecret;
    process.env.RAZORPAY_KEY_ID = "rzp_test_mock_hardening_key";
    process.env.RAZORPAY_KEY_SECRET = "rzp_test_mock_hardening_secret";
    process.env.RAZORPAY_WEBHOOK_SECRET = "rzp_test_webhook_hardening_secret";

    slotDate = new Date();
    slotDate.setDate(slotDate.getDate() + 1);
    slotDate.setHours(0, 0, 0, 0);

    // Create test patient user
    patientUser = await prisma.user.create({
      data: {
        name: "Hardening Patient",
        email: `${runId}_patient@quickclinic.test`,
        phoneNo: "9123456789",
        password: "$2b$10$hashedpasswordforexamplepurposeonly",
        age: 30,
        gender: "FEMALE",
        address: "123 Hardening St",
        role: "PATIENT",
        location: {
          connectOrCreate: {
            where: { pincode: 121004 },
            create: { pincode: 121004, city: "Faridabad", state: "Haryana" },
          },
        },
      },
    });

    patientRecord = await prisma.patient.create({
      data: { userId: patientUser.id },
    });

    patientToken = await createToken({
      id: patientUser.id,
      email: patientUser.email,
      role: patientUser.role,
    });

    // Create test doctor user
    doctorUser = await prisma.user.create({
      data: {
        name: "Dr. Hardening",
        email: `${runId}_doctor@quickclinic.test`,
        phoneNo: "9988776655",
        password: "$2b$10$hashedpasswordforexamplepurposeonly",
        age: 45,
        gender: "MALE",
        address: "456 Clinic Blvd",
        role: "DOCTOR",
        location: {
          connectOrCreate: {
            where: { pincode: 121004 },
            create: { pincode: 121004, city: "Faridabad", state: "Haryana" },
          },
        },
      },
    });

    doctorRecord = await prisma.doctor.create({
      data: {
        userId: doctorUser.id,
        specialty: "CARDIOLOGIST",
        fees: 500,
      },
    });

    // Create test slot
    const slotStartTime = new Date(slotDate.getTime() + 10 * 3600 * 1000);
    slot = await prisma.slot.create({
      data: {
        doctorId: doctorRecord.id,
        date: slotDate,
        startTime: slotStartTime,
        endTime: new Date(slotStartTime.getTime() + 30 * 60 * 1000),
        status: "AVAILABLE",
      },
    });
  });

  afterAll(async () => {
    try {
      await prisma.appointment.deleteMany({ where: { patientId: patientRecord?.id } });
      await prisma.refund.deleteMany({ where: { payment: { userId: patientUser?.id } } });
      await prisma.payment.deleteMany({ where: { userId: patientUser?.id } });
      await prisma.notificationOutbox.deleteMany({ where: { targetUserId: patientUser?.id } });
      await prisma.checkout.deleteMany({ where: { userId: patientUser?.id } });
      await prisma.slot.deleteMany({ where: { doctorId: doctorRecord?.id } });
      await prisma.doctor.deleteMany({ where: { id: doctorRecord?.id } });
      await prisma.patient.deleteMany({ where: { id: patientRecord?.id } });
      await prisma.user.deleteMany({ where: { id: { in: [patientUser?.id, doctorUser?.id].filter(Boolean) } } });
      await prisma.webhookEvent.deleteMany({ where: { providerEventId: { startsWith: runId } } });
    } catch {
      // ignore cleanup errors
    }
  });

  describe("1. Legacy Payment-Verification Bypass Closure", () => {
    it("rejects arbitrary transactionId on /api/appointments/confirm without verified payment", async () => {
      // Patient holds a slot
      const holdToken = crypto.randomUUID();
      await prisma.slot.update({
        where: { id: slot.id },
        data: {
          status: "HELD",
          holdExpiresAt: new Date(Date.now() + 600_000),
          holdToken,
          heldByPatientId: patientRecord.id,
        },
      });

      // Attempt to confirm online appointment using arbitrary unverified transactionId
      const req = new NextRequest("http://localhost:3000/api/appointments/confirm", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${patientToken}`,
        },
        body: JSON.stringify({
          slotId: slot.id,
          doctorId: doctorRecord.id,
          holdToken,
          paymentMethod: "ONLINE",
          transactionId: "forged_client_txn_99999",
        }),
      });

      const res = await confirmPOST(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBeDefined();

      // Ensure no appointment was created
      const appt = await prisma.appointment.findFirst({
        where: { slotId: slot.id, patientId: patientRecord.id },
      });
      expect(appt).toBeNull();
    });
  });

  describe("2. Production Test Isolation Guard", () => {
    it("strictly refuses mock test mode when NODE_ENV is production", () => {
      const originalEnv = process.env.NODE_ENV;
      try {
        process.env.NODE_ENV = "production";
        expect(() => isMockTestKey("rzp_test_dummy_key_12345")).toThrow(
          /Forbidden synthetic Razorpay mock configuration/
        );
      } finally {
        process.env.NODE_ENV = originalEnv;
      }
    });
  });

  describe("3. Expiry and Cleanup Mutual Consistency", () => {
    it("cleanup does not overwrite a checkout that commits confirmation first", async () => {
      // Create fresh slot for this test
      const slotStartTime = new Date(slotDate.getTime() + 13 * 3600 * 1000);
      const cleanupSlot = await prisma.slot.create({
        data: {
          doctorId: doctorRecord.id,
          date: slotDate,
          startTime: slotStartTime,
          endTime: new Date(slotStartTime.getTime() + 30 * 60 * 1000),
          status: "AVAILABLE",
        },
      });

      // 1. Initiate checkout
      const initResult = await initiateCheckout({
        userId: patientUser.id,
        patientId: patientRecord.id,
        doctorId: doctorRecord.id,
        slotId: cleanupSlot.id,
        paymentMethod: "ONLINE",
        idempotencyKey: `idem_cleanup_race_${runId}`,
      });
      expect(initResult.ok).toBe(true);

      const checkout = await prisma.checkout.findUniqueOrThrow({
        where: { id: initResult.checkoutId },
      });

      // 2. Set expiresAt to past
      await prisma.checkout.update({
        where: { id: checkout.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      // 3. Concurrent confirmation commits first
      await prisma.checkout.update({
        where: { id: checkout.id },
        data: { status: "CONFIRMED" },
      });

      // 4. Stale cleanup runs
      const cleanedCount = await expireStaleCheckouts();

      // Ensure the confirmed checkout was NOT expired by stale cleanup!
      const refreshed = await prisma.checkout.findUniqueOrThrow({
        where: { id: checkout.id },
      });
      expect(refreshed.status).toBe("CONFIRMED");
    });

    it("late payment on expired checkout triggers refund compensation without reclaiming slot", async () => {
      // Create fresh slot for this test
      const slotStartTime = new Date(slotDate.getTime() + 11 * 3600 * 1000);
      const testSlot = await prisma.slot.create({
        data: {
          doctorId: doctorRecord.id,
          date: slotDate,
          startTime: slotStartTime,
          endTime: new Date(slotStartTime.getTime() + 30 * 60 * 1000),
          status: "AVAILABLE",
        },
      });

      const initResult = await initiateCheckout({
        userId: patientUser.id,
        patientId: patientRecord.id,
        doctorId: doctorRecord.id,
        slotId: testSlot.id,
        paymentMethod: "ONLINE",
        idempotencyKey: `idem_expired_late_${runId}`,
      });
      expect(initResult.ok).toBe(true);

      // Force checkout to EXPIRED in the past
      await prisma.checkout.update({
        where: { id: initResult.checkoutId },
        data: {
          status: "EXPIRED",
          expiresAt: new Date(Date.now() - 5000),
        },
      });

      // Attempt to finalize late payment
      const verifyResult = await verifyAndFinalizeCheckout({
        userId: patientUser.id,
        checkoutId: initResult.checkoutId,
        orderId: initResult.orderId!,
        paymentId: `pay_late_${runId}`,
        source: "CHECKOUT",
      });

      // Must reject confirmation with 409 and execute refund compensation
      expect(verifyResult.success).toBe(false);
      expect(verifyResult.statusCode).toBe(409);
      expect(verifyResult.status).toBe("SLOT_UNAVAILABLE_REFUNDED");
      expect(verifyResult.refundStatus).toBeDefined();

      // Slot must NOT be booked
      const slotAfter = await prisma.slot.findUniqueOrThrow({ where: { id: testSlot.id } });
      expect(slotAfter.status).not.toBe("BOOKED");

      // Exactly one refund record created with stable idempotency key
      const refunds = await prisma.refund.findMany({
        where: { paymentId: initResult.checkoutId },
      });
      const payment = await prisma.payment.findUnique({
        where: { razorpayOrderId: initResult.orderId! },
      });
      const paymentRefunds = payment
        ? await prisma.refund.findMany({ where: { paymentId: payment.id } })
        : [];
      expect(paymentRefunds.length).toBe(1);
      expect(paymentRefunds[0].idempotencyKey).toBe(`refund_checkout_${initResult.checkoutId}`);
    });
  });

  describe("4. Webhook Early Arrival & Replay", () => {
    it("early webhook before order linkage remains recoverable in RECEIVED status and replays successfully", async () => {
      const earlyOrderId = `order_early_${runId}`;
      const earlyPaymentId = `pay_early_${runId}`;
      const providerEventId = `${runId}_early_evt`;

      const webhookPayload = {
        event: "payment.captured",
        payload: {
          payment: {
            entity: {
              id: earlyPaymentId,
              order_id: earlyOrderId,
              status: "captured",
              amount: 50000,
            },
          },
        },
      };

      const rawBody = JSON.stringify(webhookPayload);
      const signature = crypto
        .createHmac("sha256", process.env.RAZORPAY_WEBHOOK_SECRET!)
        .update(rawBody)
        .digest("hex");

      // 1. Post webhook BEFORE checkout/payment linkage exists
      const earlyReq = new NextRequest("http://localhost:3000/api/webhooks/razorpay", {
        method: "POST",
        headers: {
          "x-razorpay-signature": signature,
          "x-razorpay-event-id": providerEventId,
          "Content-Type": "application/json",
        },
        body: rawBody,
      });

      const earlyRes = await webhookPOST(earlyReq);
      expect(earlyRes.status).toBe(200);
      const earlyData = await earlyRes.json();
      expect(earlyData.pendingLinkage).toBe(true);

      // Verify event was saved with RECEIVED status (NOT PROCESSED)
      const stored = await prisma.webhookEvent.findUniqueOrThrow({
        where: { providerEventId },
      });
      expect(stored.status).toBe("RECEIVED");

      // 2. Now create the slot, checkout, and payment linkage
      const slotStartTime = new Date(slotDate.getTime() + 12 * 3600 * 1000);
      const linkedSlot = await prisma.slot.create({
        data: {
          doctorId: doctorRecord.id,
          date: slotDate,
          startTime: slotStartTime,
          endTime: new Date(slotStartTime.getTime() + 30 * 60 * 1000),
          status: "AVAILABLE",
        },
      });

      const initResult = await initiateCheckout({
        userId: patientUser.id,
        patientId: patientRecord.id,
        doctorId: doctorRecord.id,
        slotId: linkedSlot.id,
        paymentMethod: "ONLINE",
        idempotencyKey: `idem_linked_${runId}`,
      });
      expect(initResult.ok).toBe(true);

      // Update the checkout to point to this early order ID
      await prisma.checkout.update({
        where: { id: initResult.checkoutId },
        data: { razorpayOrderId: earlyOrderId },
      });
      await prisma.payment.updateMany({
        where: { checkout: { id: initResult.checkoutId } },
        data: { razorpayOrderId: earlyOrderId, razorpayPaymentId: earlyPaymentId },
      });

      // 3. Mark the webhook event receivedAt and nextAttemptAt in the past to trigger reconciliation replay
      await prisma.webhookEvent.update({
        where: { id: stored.id },
        data: {
          receivedAt: new Date(Date.now() - 120_000),
          nextAttemptAt: new Date(Date.now() - 1000),
        },
      });

      const replayOutcome = await replayRetryableWebhookEvents(10);
      expect(replayOutcome.replayed).toBeGreaterThanOrEqual(1);

      // Webhook event should now be PROCESSED
      const updatedEvent = await prisma.webhookEvent.findUniqueOrThrow({
        where: { id: stored.id },
      });
      expect(updatedEvent.status).toBe("PROCESSED");

      // Checkout should be CONFIRMED
      const confirmedCheckout = await prisma.checkout.findUniqueOrThrow({
        where: { id: initResult.checkoutId },
      });
      expect(confirmedCheckout.status).toBe("CONFIRMED");
    });
  });

  describe("5. Reconcile Payments Route Protection", () => {
    it("fails closed when authorization is missing or invalid", async () => {
      const unauthorizedReq = new NextRequest("http://localhost:3000/api/cron/reconcile-payments", {
        method: "POST",
        headers: {
          Authorization: "Bearer wrong_secret",
        },
      });

      const res = await reconcilePOST(unauthorizedReq);
      expect(res.status).toBe(401);
    });

    it("succeeds when valid authorization is provided", async () => {
      const authorizedReq = new NextRequest("http://localhost:3000/api/cron/reconcile-payments", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${cronSecret}`,
        },
      });

      const res = await reconcilePOST(authorizedReq);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.results).toBeDefined();
    });
  });

  describe("6. Gap A: Lost Provider Order Reference Recovery (reconcileUnresolvedOrders)", () => {
    it("recovers lost order by receipt, validates invariants, and links order to checkout and payment", async () => {
      const slotStartTime = new Date(slotDate.getTime() + 14 * 3600 * 1000);
      const testSlot = await prisma.slot.create({
        data: {
          doctorId: doctorRecord.id,
          date: slotDate,
          startTime: slotStartTime,
          endTime: new Date(slotStartTime.getTime() + 30 * 60 * 1000),
          status: "AVAILABLE",
        },
      });

      const providerRef = `rec_gapA_${runId}_${Math.random().toString(36).slice(2, 7)}`;
      const checkout = await prisma.checkout.create({
        data: {
          userId: patientUser.id,
          patientId: patientRecord.id,
          doctorId: doctorRecord.id,
          slotId: testSlot.id,
          holdToken: crypto.randomUUID(),
          amount: 50000,
          currency: "INR",
          paymentMethod: "ONLINE",
          idempotencyKey: `idem_gapA_${runId}`,
          status: "PENDING_ORDER",
          providerReference: providerRef,
          razorpayOrderId: null,
          expiresAt: new Date(Date.now() + 600_000),
          nextAttemptAt: null,
        },
      });

      await prisma.$executeRawUnsafe(
        `UPDATE "Checkout" SET "updatedAt" = NOW() - INTERVAL '30 seconds' WHERE id = '${checkout.id}'`
      );

      const outcome = await reconcileUnresolvedOrders(10);
      expect(outcome.reconciled).toBeGreaterThanOrEqual(1);

      const recoveredCheckout = await prisma.checkout.findUniqueOrThrow({
        where: { id: checkout.id },
      });
      expect(recoveredCheckout.razorpayOrderId).toBeDefined();
      expect(recoveredCheckout.razorpayOrderId).not.toBeNull();
      expect(recoveredCheckout.status).toBe("READY_FOR_PAYMENT");
      expect(recoveredCheckout.paymentId).toBeDefined();

      const linkedPayment = await prisma.payment.findUnique({
        where: { razorpayOrderId: recoveredCheckout.razorpayOrderId! },
      });
      expect(linkedPayment).toBeDefined();
      expect(linkedPayment?.amount).toBe(50000);
    });

    it("marks checkout MANUAL_REVIEW if recovered provider order fails invariant validation", async () => {
      const slotStartTime = new Date(slotDate.getTime() + 15 * 3600 * 1000);
      const testSlot = await prisma.slot.create({
        data: {
          doctorId: doctorRecord.id,
          date: slotDate,
          startTime: slotStartTime,
          endTime: new Date(slotStartTime.getTime() + 30 * 60 * 1000),
          status: "AVAILABLE",
        },
      });

      const providerRef = `rec_mismatch_${runId}_${Math.random().toString(36).slice(2, 7)}`;
      const checkout = await prisma.checkout.create({
        data: {
          userId: patientUser.id,
          patientId: patientRecord.id,
          doctorId: doctorRecord.id,
          slotId: testSlot.id,
          holdToken: crypto.randomUUID(),
          amount: 50000,
          currency: "INR",
          paymentMethod: "ONLINE",
          idempotencyKey: `idem_mismatch_${runId}`,
          status: "PENDING_ORDER",
          providerReference: providerRef,
          razorpayOrderId: null,
          expiresAt: new Date(Date.now() + 600_000),
          nextAttemptAt: null,
        },
      });

      await prisma.$executeRawUnsafe(
        `UPDATE "Checkout" SET "updatedAt" = NOW() - INTERVAL '30 seconds' WHERE id = '${checkout.id}'`
      );

      // Mock provider returning a mismatched order (wrong currency)
      const spy = vi.spyOn(RazorpayModule, "fetchRazorpayOrderByReceipt").mockResolvedValueOnce({
        id: `order_mismatch_${runId}`,
        entity: "order",
        amount: 50000,
        amount_paid: 0,
        amount_due: 50000,
        currency: "USD", // Invariant violation: USD instead of INR
        receipt: providerRef,
        status: "created",
        attempts: 0,
        created_at: Math.floor(Date.now() / 1000),
        notes: {
          checkoutId: checkout.id,
          userId: checkout.userId,
        },
      });

      try {
        const outcome = await reconcileUnresolvedOrders(10);
        expect(outcome.errors.length).toBeGreaterThanOrEqual(1);

        const flaggedCheckout = await prisma.checkout.findUniqueOrThrow({
          where: { id: checkout.id },
        });
        expect(flaggedCheckout.status).toBe("MANUAL_REVIEW");
        expect(flaggedCheckout.lastError).toContain("invariant validation");
      } finally {
        spy.mockRestore();
      }
    });
  });

  describe("7. Gap B & Crash-Before-Refund Recovery (reconcileCapturedCheckouts)", () => {
    it("discovers captured payment on expired checkout without prior refund row and triggers refund compensation without reclaiming slot", async () => {
      const slotStartTime = new Date(slotDate.getTime() + 16 * 3600 * 1000);
      const testSlot = await prisma.slot.create({
        data: {
          doctorId: doctorRecord.id,
          date: slotDate,
          startTime: slotStartTime,
          endTime: new Date(slotStartTime.getTime() + 30 * 60 * 1000),
          status: "AVAILABLE",
        },
      });

      const orderId = `order_captured_gapB_${runId}`;
      const checkout = await prisma.checkout.create({
        data: {
          userId: patientUser.id,
          patientId: patientRecord.id,
          doctorId: doctorRecord.id,
          slotId: testSlot.id,
          holdToken: crypto.randomUUID(),
          amount: 50000,
          currency: "INR",
          paymentMethod: "ONLINE",
          idempotencyKey: `idem_gapB_${runId}`,
          status: "EXPIRED",
          providerReference: `rec_gapB_exp_${runId}`,
          razorpayOrderId: orderId,
          expiresAt: new Date(Date.now() - 60_000),
          nextAttemptAt: null,
        },
      });

      const payment = await prisma.payment.create({
        data: {
          userId: patientUser.id,
          doctorId: doctorRecord.id,
          slotId: testSlot.id,
          holdToken: checkout.holdToken,
          amount: 50000,
          currency: "INR",
          status: "CREATED",
          razorpayOrderId: orderId,
          idempotencyKey: `pay_${checkout.idempotencyKey}`,
          nextAttemptAt: null,
        },
      });

      await prisma.checkout.update({
        where: { id: checkout.id },
        data: { paymentId: payment.id },
      });

      await prisma.$executeRawUnsafe(
        `UPDATE "Checkout" SET "updatedAt" = NOW() - INTERVAL '30 seconds' WHERE id = '${checkout.id}'`
      );
      await prisma.$executeRawUnsafe(
        `UPDATE "Payment" SET "updatedAt" = NOW() - INTERVAL '30 seconds' WHERE id = '${payment.id}'`
      );

      // No refund row exists prior to reconciliation (simulating crash before refund intent)
      const existingRefunds = await prisma.refund.findMany({
        where: { paymentId: payment.id },
      });
      expect(existingRefunds.length).toBe(0);

      const outcome = await reconcileCapturedCheckouts(10);
      expect(outcome.reconciled).toBeGreaterThanOrEqual(1);

      // Verify slot was NOT reclaimed/booked
      const slotAfter = await prisma.slot.findUniqueOrThrow({ where: { id: testSlot.id } });
      expect(slotAfter.status).not.toBe("BOOKED");

      // Verify payment was marked REFUNDED and capture evidence recorded
      const updatedPayment = await prisma.payment.findUniqueOrThrow({
        where: { id: payment.id },
      });
      expect(updatedPayment.status).toBe("REFUNDED");
      expect(updatedPayment.razorpayPaymentId).toBeDefined();

      // Verify refund record was durably created with stable idempotency key
      const refunds = await prisma.refund.findMany({
        where: { paymentId: payment.id },
      });
      expect(refunds.length).toBe(1);
      expect(refunds[0].idempotencyKey).toBe(`refund_checkout_${checkout.id}`);
      expect(refunds[0].status).toBe("PROCESSED");
    });
  });

  describe("8. Lost Provider Refund Response Recovery (reconcilePendingRefunds)", () => {
    it("reconciles refund where provider processed refund but local write was lost/pending", async () => {
      const slotStartTime = new Date(slotDate.getTime() + 17 * 3600 * 1000);
      const testSlot = await prisma.slot.create({
        data: {
          doctorId: doctorRecord.id,
          date: slotDate,
          startTime: slotStartTime,
          endTime: new Date(slotStartTime.getTime() + 30 * 60 * 1000),
          status: "AVAILABLE",
        },
      });

      const payment = await prisma.payment.create({
        data: {
          userId: patientUser.id,
          doctorId: doctorRecord.id,
          slotId: testSlot.id,
          holdToken: crypto.randomUUID(),
          amount: 50000,
          currency: "INR",
          status: "REFUND_PENDING",
          razorpayOrderId: `order_lost_refund_${runId}`,
          razorpayPaymentId: `pay_lost_refund_${runId}`,
          idempotencyKey: `pay_lost_rfnd_${runId}`,
        },
      });

      const refund = await prisma.refund.create({
        data: {
          paymentId: payment.id,
          amount: 50000,
          status: "PENDING",
          reason: "Cancellation compensation",
          idempotencyKey: `rfnd_lost_idem_${runId}`,
          razorpayRefundId: `rfnd_prov_processed_${runId}`,
          nextAttemptAt: null,
        },
      });

      await prisma.$executeRawUnsafe(
        `UPDATE "Refund" SET "updatedAt" = NOW() - INTERVAL '60 seconds' WHERE id = '${refund.id}'`
      );

      const outcome = await reconcilePendingRefunds(10);
      expect(outcome.reconciled).toBeGreaterThanOrEqual(1);

      const updatedRefund = await prisma.refund.findUniqueOrThrow({
        where: { id: refund.id },
      });
      expect(updatedRefund.status).toBe("PROCESSED");

      const updatedPayment = await prisma.payment.findUniqueOrThrow({
        where: { id: payment.id },
      });
      expect(updatedPayment.status).toBe("REFUNDED");
    });
  });

  describe("9. Stale Webhook Downgrade Guards", () => {
    it("prevents stale payment.failed webhook from overwriting a CONFIRMED checkout or SUCCESS payment", async () => {
      const slotStartTime = new Date(slotDate.getTime() + 18 * 3600 * 1000);
      const testSlot = await prisma.slot.create({
        data: {
          doctorId: doctorRecord.id,
          date: slotDate,
          startTime: slotStartTime,
          endTime: new Date(slotStartTime.getTime() + 30 * 60 * 1000),
          status: "AVAILABLE",
        },
      });

      const initResult = await initiateCheckout({
        userId: patientUser.id,
        patientId: patientRecord.id,
        doctorId: doctorRecord.id,
        slotId: testSlot.id,
        paymentMethod: "ONLINE",
        idempotencyKey: `idem_stale_fail_${runId}`,
      });
      expect(initResult.ok).toBe(true);

      // Finalize checkout as CONFIRMED
      const finalizeRes = await verifyAndFinalizeCheckout({
        userId: patientUser.id,
        checkoutId: initResult.checkoutId,
        orderId: initResult.orderId!,
        paymentId: `pay_success_${runId}`,
        source: "CHECKOUT",
      });
      expect(finalizeRes.success).toBe(true);

      // Now simulate a late arriving payment.failed webhook for this order
      const failedPayload = {
        event: "payment.failed",
        payload: {
          payment: {
            entity: {
              id: `pay_failed_late_${runId}`,
              order_id: initResult.orderId!,
              status: "failed",
              amount: 50000,
              error_description: "Card network unavailable",
            },
          },
        },
      };

      const rawBody = JSON.stringify(failedPayload);
      const signature = crypto
        .createHmac("sha256", process.env.RAZORPAY_WEBHOOK_SECRET!)
        .update(rawBody)
        .digest("hex");

      const lateReq = new NextRequest("http://localhost:3000/api/webhooks/razorpay", {
        method: "POST",
        headers: {
          "x-razorpay-signature": signature,
          "x-razorpay-event-id": `${runId}_stale_failed_evt`,
          "Content-Type": "application/json",
        },
        body: rawBody,
      });

      const lateRes = await webhookPOST(lateReq);
      expect(lateRes.status).toBe(200);

      // Verify payment is STILL SUCCESS and checkout is STILL CONFIRMED
      const checkoutAfter = await prisma.checkout.findUniqueOrThrow({
        where: { id: initResult.checkoutId },
      });
      expect(checkoutAfter.status).toBe("CONFIRMED");

      const paymentAfter = await prisma.payment.findUniqueOrThrow({
        where: { razorpayOrderId: initResult.orderId! },
      });
      expect(paymentAfter.status).toBe("SUCCESS");
    });
  });

  describe("10. Atomic Leases and Safe Background Worker Concurrency", () => {
    it("active lease prevents competing worker from claiming, and expired lease is reclaimed safely", async () => {
      const slotStartTime = new Date(slotDate.getTime() + 19 * 3600 * 1000);
      const testSlot = await prisma.slot.create({
        data: {
          doctorId: doctorRecord.id,
          date: slotDate,
          startTime: slotStartTime,
          endTime: new Date(slotStartTime.getTime() + 30 * 60 * 1000),
          status: "AVAILABLE",
        },
      });

      const checkout = await prisma.checkout.create({
        data: {
          userId: patientUser.id,
          patientId: patientRecord.id,
          doctorId: doctorRecord.id,
          slotId: testSlot.id,
          holdToken: crypto.randomUUID(),
          amount: 50000,
          currency: "INR",
          paymentMethod: "ONLINE",
          idempotencyKey: `idem_lease_${runId}`,
          status: "UNRESOLVED",
          providerReference: `rec_lease_${runId}`,
          razorpayOrderId: null,
          expiresAt: new Date(Date.now() + 600_000),
          leaseOwner: "worker_alpha",
          leaseExpiresAt: new Date(Date.now() + 60_000), // active lease
        },
      });

      const workerBeta = "worker_beta";
      const now = new Date();

      // Worker Beta attempts to claim checkout while Worker Alpha holds an active lease
      const claimAttempt1 = await prisma.checkout.updateMany({
        where: {
          id: checkout.id,
          status: "UNRESOLVED",
          OR: [
            { leaseExpiresAt: null },
            { leaseExpiresAt: { lte: now } },
          ],
        },
        data: {
          leaseOwner: workerBeta,
          leaseExpiresAt: new Date(Date.now() + 30_000),
        },
      });
      expect(claimAttempt1.count).toBe(0); // Blocked by active lease

      // Now simulate lease expiry for Worker Alpha
      await prisma.checkout.update({
        where: { id: checkout.id },
        data: { leaseExpiresAt: new Date(Date.now() - 1000) },
      });

      // Worker Beta attempts claim again
      const claimAttempt2 = await prisma.checkout.updateMany({
        where: {
          id: checkout.id,
          status: "UNRESOLVED",
          OR: [
            { leaseExpiresAt: null },
            { leaseExpiresAt: { lte: new Date() } },
          ],
        },
        data: {
          leaseOwner: workerBeta,
          leaseExpiresAt: new Date(Date.now() + 30_000),
        },
      });
      expect(claimAttempt2.count).toBe(1); // Successfully reclaimed!

      const claimedCheckout = await prisma.checkout.findUniqueOrThrow({
        where: { id: checkout.id },
      });
      expect(claimedCheckout.leaseOwner).toBe(workerBeta);
    });
  });

  describe("11. Outbox Atomic Lease Coordination", () => {
    it("lease prevents competing worker from claiming an in-flight outbox dispatch", async () => {
      const eventId = `apt:outbox_test_${runId}:CONFIRMED:patient`;
      const outbox = await prisma.notificationOutbox.create({
        data: {
          eventId,
          channel: "SOCKET_NOTIFICATION",
          targetUserId: patientUser.id,
          payload: { test: true },
          status: "PENDING",
          leaseOwner: "direct_worker_1",
          leaseExpiresAt: new Date(Date.now() + 30_000), // Active lease
        },
      });

      const now = new Date();
      // Competing scheduled worker attempts to claim
      const scheduledClaim = await prisma.notificationOutbox.updateMany({
        where: {
          id: outbox.id,
          status: "PENDING",
          OR: [
            { leaseExpiresAt: null },
            { leaseExpiresAt: { lte: now } },
          ],
        },
        data: {
          status: "PROCESSING",
          leaseOwner: "scheduled_worker_2",
          leaseExpiresAt: new Date(Date.now() + 30_000),
        },
      });
      expect(scheduledClaim.count).toBe(0); // Protected by lease!
    });
  });
});
