import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { NextRequest } from "next/server";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { createToken } from "@/lib/auth";
import { POST as confirmPOST } from "@/app/api/appointments/confirm/route";
import { POST as webhookPOST } from "@/app/api/webhooks/razorpay/route";
import { POST as reconcilePOST } from "@/app/api/cron/reconcile-payments/route";
import { initiateCheckout, verifyAndFinalizeCheckout, expireStaleCheckouts } from "@/lib/checkout-service";
import { replayRetryableWebhookEvents } from "@/lib/reconciliation-service";
import { isMockTestKey } from "@/lib/razorpay";

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

      // 3. Mark the webhook event receivedAt in the past to trigger reconciliation replay
      await prisma.webhookEvent.update({
        where: { id: stored.id },
        data: { receivedAt: new Date(Date.now() - 120_000) },
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
});
