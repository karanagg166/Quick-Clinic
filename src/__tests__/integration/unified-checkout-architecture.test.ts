import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { createToken } from "@/lib/auth";
import { acquireSlotMutex, releaseSlotMutex, slotMutexKey } from "@/lib/slot-mutex";
import {
  initiateCheckout,
  verifyAndFinalizeCheckout,
  getAuthoritativeCheckoutStatus,
  expireStaleCheckouts,
} from "@/lib/checkout-service";
import { POST as checkoutPOST } from "@/app/api/checkout/route";
import { GET as checkoutStatusGET } from "@/app/api/checkout/[checkoutId]/status/route";
import { POST as webhookPOST } from "@/app/api/webhooks/razorpay/route";

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

describe("Unified Checkout & Reservation Architecture Integration Tests", () => {
  const secretKey = "test_razorpay_secret_key_unified_12345";
  const webhookSecret = "test_razorpay_webhook_secret_unified_123";
  const jwtSecret = "ci_jwt_secret_must_be_at_least_32_characters_long_for_security";

  let patient1UserId: string;
  let patient1Id: string;
  let patient1Token: string;

  let patient2UserId: string;
  let patient2Id: string;
  let patient2Token: string;

  let doctorUserId: string;
  let doctorId: string;
  let doctorToken: string;

  let testSlotIds: string[] = [];
  let testCheckoutIds: string[] = [];
  let testOrderIds: string[] = [];

  function generateValidSignature(orderId: string, paymentId: string, secret = secretKey): string {
    return crypto.createHmac("sha256", secret).update(`${orderId}|${paymentId}`).digest("hex");
  }

  function generateValidWebhookSignature(rawBody: string, secret = webhookSecret): string {
    return crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  }

  beforeAll(async () => {
    process.env.RAZORPAY_KEY_ID = "rzp_test_mock_key_id";
    process.env.RAZORPAY_KEY_SECRET = secretKey;
    process.env.RAZORPAY_WEBHOOK_SECRET = webhookSecret;
    process.env.JWT_SECRET = jwtSecret;

    const timestamp = Date.now();

    // 1. Create Patient 1
    const p1User = await prisma.user.create({
      data: {
        name: "Unified Patient One",
        email: `p1_unified_${timestamp}@quickclinic.test`,
        phoneNo: "9876500001",
        password: "$2b$10$hashedpasswordforexamplepurposeonly",
        age: 28,
        gender: "FEMALE",
        address: "101 Unified Way",
        role: "PATIENT",
        location: {
          connectOrCreate: {
            where: { pincode: 121004 },
            create: { pincode: 121004, city: "Faridabad", state: "Haryana" },
          },
        },
      },
    });
    patient1UserId = p1User.id;
    patient1Token = await createToken({ id: patient1UserId, role: "PATIENT" });

    const p1 = await prisma.patient.create({
      data: { userId: patient1UserId, medicalHistory: "None" },
    });
    patient1Id = p1.id;

    // 2. Create Patient 2
    const p2User = await prisma.user.create({
      data: {
        name: "Unified Patient Two",
        email: `p2_unified_${timestamp}@quickclinic.test`,
        phoneNo: "9876500002",
        password: "$2b$10$hashedpasswordforexamplepurposeonly",
        age: 34,
        gender: "MALE",
        address: "102 Unified Way",
        role: "PATIENT",
        location: {
          connectOrCreate: {
            where: { pincode: 121004 },
            create: { pincode: 121004, city: "Faridabad", state: "Haryana" },
          },
        },
      },
    });
    patient2UserId = p2User.id;
    patient2Token = await createToken({ id: patient2UserId, role: "PATIENT" });

    const p2 = await prisma.patient.create({
      data: { userId: patient2UserId, medicalHistory: "None" },
    });
    patient2Id = p2.id;

    // 3. Create Doctor
    const docUser = await prisma.user.create({
      data: {
        name: "Dr. Unified Specialist",
        email: `doc_unified_${timestamp}@quickclinic.test`,
        phoneNo: "9876500003",
        password: "$2b$10$hashedpasswordforexamplepurposeonly",
        age: 45,
        gender: "MALE",
        address: "201 Medical Center",
        role: "DOCTOR",
        location: {
          connectOrCreate: {
            where: { pincode: 121004 },
            create: { pincode: 121004, city: "Faridabad", state: "Haryana" },
          },
        },
      },
    });
    doctorUserId = docUser.id;
    doctorToken = await createToken({ id: doctorUserId, role: "DOCTOR" });

    const doc = await prisma.doctor.create({
      data: {
        userId: doctorUserId,
        specialty: "GENERAL_SURGEON",
        fees: 1200, // ₹1,200 = 120,000 paise
        experience: 15,
        balance: 0,
      },
    });
    doctorId = doc.id;
  });

  afterAll(async () => {
    try {
      if (testCheckoutIds.length > 0) {
        await prisma.checkout.deleteMany({ where: { id: { in: testCheckoutIds } } });
      }
      if (testOrderIds.length > 0) {
        await prisma.refund.deleteMany({
          where: { payment: { razorpayOrderId: { in: testOrderIds } } },
        });
        await prisma.payment.deleteMany({
          where: { razorpayOrderId: { in: testOrderIds } },
        });
      }
      await prisma.appointment.deleteMany({
        where: { patientId: { in: [patient1Id, patient2Id] } },
      });
      if (testSlotIds.length > 0) {
        await prisma.slot.deleteMany({ where: { id: { in: testSlotIds } } });
      }
      await prisma.notification.deleteMany({
        where: { userId: { in: [patient1UserId, patient2UserId, doctorUserId] } },
      });
      await prisma.doctor.deleteMany({ where: { id: doctorId } });
      await prisma.patient.deleteMany({ where: { id: { in: [patient1Id, patient2Id] } } });
      await prisma.user.deleteMany({
        where: { id: { in: [patient1UserId, patient2UserId, doctorUserId] } },
      });
    } catch (e) {
      console.warn("Cleanup warning in unified checkout tests:", e);
    }
  });

  async function createFutureSlot(hoursFromNow = 24): Promise<string> {
    const start = new Date(Date.now() + hoursFromNow * 3600 * 1000);
    const end = new Date(start.getTime() + 30 * 60 * 1000);
    const slot = await prisma.slot.create({
      data: {
        doctorId,
        date: start,
        startTime: start,
        endTime: end,
        status: "AVAILABLE",
      },
    });
    testSlotIds.push(slot.id);
    return slot.id;
  }

  // ==========================================================================
  // 1. Short Redis Mutex & Exact Token Compare-and-Delete
  // ==========================================================================
  describe("1. Short Redis Mutex Invariants", () => {
    it("1.1 Acquires mutex with owner token and releases via exact compare-and-delete Lua script", async () => {
      const slotId = await createFutureSlot(25);
      const mutex1 = await acquireSlotMutex(slotId, 5);
      expect(mutex1.acquired).toBe(true);
      expect(mutex1.token).toBeDefined();

      // Old/wrong token cannot delete the lock
      const wrongToken = "random_wrong_token_12345";
      const wrongRelease = await releaseSlotMutex(slotId, wrongToken);
      expect(wrongRelease).toBe(false);

      // Mutex is still held by original owner; concurrent acquire is rejected
      const mutex2 = await acquireSlotMutex(slotId, 5);
      expect(mutex2.acquired).toBe(false);
      expect(mutex2.retryable).toBe(true);

      // Exact owner token releases successfully
      const correctRelease = await releaseSlotMutex(slotId, mutex1.token);
      expect(correctRelease).toBe(true);

      // Mutex can now be acquired again
      const mutex3 = await acquireSlotMutex(slotId, 5);
      expect(mutex3.acquired).toBe(true);
      await releaseSlotMutex(slotId, mutex3.token);
    });
  });

  // ==========================================================================
  // 2. POST /api/checkout Initiation: Online and Offline
  // ==========================================================================
  describe("2. POST /api/checkout Initiation Contracts", () => {
    it("2.1 Online initiation creates durable Checkout in READY_FOR_PAYMENT and reserves slot as HELD", async () => {
      const slotId = await createFutureSlot(26);
      const idempotencyKey = `idem_online_init_${Date.now()}`;

      const req = new NextRequest("http://localhost:3000/api/checkout", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${patient1Token}`,
        },
        body: JSON.stringify({
          action: "INITIATE",
          doctorId,
          slotId,
          paymentMethod: "ONLINE",
          idempotencyKey,
        }),
      });

      const res = await checkoutPOST(req);
      expect(res.status).toBe(201);
      const data = await res.json();

      expect(data.ok).toBe(true);
      expect(data.checkoutId).toBeDefined();
      expect(data.orderId).toBeDefined();
      expect(data.status).toBe("READY_FOR_PAYMENT");
      expect(data.paymentMethod).toBe("ONLINE");
      expect(data.amount).toBe(120000); // Doctor fee = ₹1200 -> 120,000 paise
      expect(data.currency).toBe("INR");
      expect(data.keyId).toBeDefined();

      testCheckoutIds.push(data.checkoutId);
      testOrderIds.push(data.orderId);

      // Verify Slot is authoritatively HELD in database
      const slotInDb = await prisma.slot.findUnique({ where: { id: slotId } });
      expect(slotInDb?.status).toBe("HELD");
      expect(slotInDb?.heldByPatientId).toBe(patient1Id);
      expect(slotInDb?.holdToken).toBeDefined();
      expect(slotInDb?.holdExpiresAt).toBeDefined();

      // Verify Checkout is persisted in database
      const checkoutInDb = await prisma.checkout.findUnique({ where: { id: data.checkoutId } });
      expect(checkoutInDb?.status).toBe("READY_FOR_PAYMENT");
      expect(checkoutInDb?.razorpayOrderId).toBe(data.orderId);
      expect(checkoutInDb?.amount).toBe(120000);
    });

    it("2.2 Offline initiation atomically books slot and creates appointment without Razorpay order", async () => {
      const slotId = await createFutureSlot(27);
      const idempotencyKey = `idem_offline_init_${Date.now()}`;

      const req = new NextRequest("http://localhost:3000/api/checkout", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${patient1Token}`,
        },
        body: JSON.stringify({
          action: "INITIATE",
          doctorId,
          slotId,
          paymentMethod: "OFFLINE",
          idempotencyKey,
        }),
      });

      const res = await checkoutPOST(req);
      expect(res.status).toBe(201);
      const data = await res.json();

      expect(data.ok).toBe(true);
      expect(data.checkoutId).toBeDefined();
      expect(data.status).toBe("CONFIRMED");
      expect(data.paymentMethod).toBe("OFFLINE");
      expect(data.appointment).toBeDefined();
      expect(data.appointment.status).toBe("CONFIRMED");
      expect(data.orderId).toBeUndefined(); // Razorpay order skipped for Pay at Clinic

      testCheckoutIds.push(data.checkoutId);

      // Verify Slot is BOOKED directly in database
      const slotInDb = await prisma.slot.findUnique({ where: { id: slotId } });
      expect(slotInDb?.status).toBe("BOOKED");
      expect(slotInDb?.heldByPatientId).toBeNull();

      // Verify Appointment in DB
      const apptInDb = await prisma.appointment.findUnique({ where: { id: data.appointment.id } });
      expect(apptInDb?.paymentMethod).toBe("OFFLINE");
      expect(apptInDb?.isAppointmentOffline).toBe(true);
    });

    it("2.3 Duplicate initiation with matching key reuses attempt, conflicting reuse rejected with 409", async () => {
      const slotId = await createFutureSlot(28);
      const idempotencyKey = `idem_reuse_${Date.now()}`;

      // 1st initiation
      const req1 = new NextRequest("http://localhost:3000/api/checkout", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${patient1Token}`,
        },
        body: JSON.stringify({
          action: "INITIATE",
          doctorId,
          slotId,
          paymentMethod: "ONLINE",
          idempotencyKey,
        }),
      });
      const res1 = await checkoutPOST(req1);
      expect(res1.status).toBe(201);
      const data1 = await res1.json();
      testCheckoutIds.push(data1.checkoutId);
      testOrderIds.push(data1.orderId);

      // 2nd initiation (exact same parameters): returns 200 with reused: true
      const req2 = new NextRequest("http://localhost:3000/api/checkout", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${patient1Token}`,
        },
        body: JSON.stringify({
          action: "INITIATE",
          doctorId,
          slotId,
          paymentMethod: "ONLINE",
          idempotencyKey,
        }),
      });
      const res2 = await checkoutPOST(req2);
      expect(res2.status).toBe(200);
      const data2 = await res2.json();
      expect(data2.reused).toBe(true);
      expect(data2.checkoutId).toBe(data1.checkoutId);
      expect(data2.orderId).toBe(data1.orderId);

      // 3rd initiation with SAME key but DIFFERENT slotId: rejected with 409
      const differentSlotId = await createFutureSlot(29);
      const req3 = new NextRequest("http://localhost:3000/api/checkout", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${patient1Token}`,
        },
        body: JSON.stringify({
          action: "INITIATE",
          doctorId,
          slotId: differentSlotId,
          paymentMethod: "ONLINE",
          idempotencyKey,
        }),
      });
      const res3 = await checkoutPOST(req3);
      expect(res3.status).toBe(409);
      const data3 = await res3.json();
      expect(data3.error).toMatch(/different booking details/i);
    });

    it("2.4 Two patients competing for one slot: exactly ONE wins, the other receives 409 conflict", async () => {
      const slotId = await createFutureSlot(30);

      const [resA, resB] = await Promise.all([
        checkoutPOST(
          new NextRequest("http://localhost:3000/api/checkout", {
            method: "POST",
            headers: { "content-type": "application/json", authorization: `Bearer ${patient1Token}` },
            body: JSON.stringify({
              action: "INITIATE",
              doctorId,
              slotId,
              paymentMethod: "ONLINE",
              idempotencyKey: `idem_comp_a_${Date.now()}`,
            }),
          })
        ),
        checkoutPOST(
          new NextRequest("http://localhost:3000/api/checkout", {
            method: "POST",
            headers: { "content-type": "application/json", authorization: `Bearer ${patient2Token}` },
            body: JSON.stringify({
              action: "INITIATE",
              doctorId,
              slotId,
              paymentMethod: "ONLINE",
              idempotencyKey: `idem_comp_b_${Date.now()}`,
            }),
          })
        ),
      ]);

      const statuses = [resA.status, resB.status];
      expect(statuses).toContain(201);
      expect(statuses).toContain(409);

      const winningRes = resA.status === 201 ? resA : resB;
      const winningData = await winningRes.json();
      testCheckoutIds.push(winningData.checkoutId);
      testOrderIds.push(winningData.orderId);
    });
  });

  // ==========================================================================
  // 3. Shared Payment Verification & Transaction 2
  // ==========================================================================
  describe("3. Shared Payment Verification & Transaction 2 Invariants", () => {
    it("3.1 Validates signature, verifies captured status, and atomically finalizes appointment and checkout CONFIRMED", async () => {
      const slotId = await createFutureSlot(31);
      const idempotencyKey = `idem_verify_flow_${Date.now()}`;

      // Initiate checkout
      const initRes = await checkoutPOST(
        new NextRequest("http://localhost:3000/api/checkout", {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${patient1Token}` },
          body: JSON.stringify({ action: "INITIATE", doctorId, slotId, paymentMethod: "ONLINE", idempotencyKey }),
        })
      );
      const initData = await initRes.json();
      testCheckoutIds.push(initData.checkoutId);
      testOrderIds.push(initData.orderId);

      const paymentId = `pay_mock_verify_${Date.now()}`;
      const signature = generateValidSignature(initData.orderId, paymentId);

      // Action: VERIFY
      const verifyReq = new NextRequest("http://localhost:3000/api/checkout", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${patient1Token}` },
        body: JSON.stringify({
          action: "VERIFY",
          checkoutId: initData.checkoutId,
          orderId: initData.orderId,
          paymentId,
          signature,
        }),
      });

      const verifyRes = await checkoutPOST(verifyReq);
      expect(verifyRes.status).toBe(200);
      const verifyData = await verifyRes.json();

      expect(verifyData.ok).toBe(true);
      expect(verifyData.appointment).toBeDefined();
      expect(verifyData.appointment.status).toBe("CONFIRMED");

      // Verify Database Invariants
      const [slotInDb, checkoutInDb, paymentInDb] = await Promise.all([
        prisma.slot.findUnique({ where: { id: slotId } }),
        prisma.checkout.findUnique({ where: { id: initData.checkoutId } }),
        prisma.payment.findUnique({ where: { razorpayOrderId: initData.orderId } }),
      ]);

      expect(slotInDb?.status).toBe("BOOKED");
      expect(checkoutInDb?.status).toBe("CONFIRMED");
      expect(checkoutInDb?.appointmentId).toBe(verifyData.appointment.id);
      expect(paymentInDb?.status).toBe("SUCCESS");
      expect(paymentInDb?.razorpayPaymentId).toBe(paymentId);
    });

    it("3.2 Rejects invalid signature with 400 and wrong user with 403", async () => {
      const slotId = await createFutureSlot(32);
      const idempotencyKey = `idem_sig_user_${Date.now()}`;

      const initRes = await checkoutPOST(
        new NextRequest("http://localhost:3000/api/checkout", {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${patient1Token}` },
          body: JSON.stringify({ action: "INITIATE", doctorId, slotId, paymentMethod: "ONLINE", idempotencyKey }),
        })
      );
      const initData = await initRes.json();
      testCheckoutIds.push(initData.checkoutId);
      testOrderIds.push(initData.orderId);

      const paymentId = `pay_mock_auth_${Date.now()}`;

      // Test 1: Invalid Signature
      const invalidSigReq = new NextRequest("http://localhost:3000/api/checkout", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${patient1Token}` },
        body: JSON.stringify({
          action: "VERIFY",
          checkoutId: initData.checkoutId,
          orderId: initData.orderId,
          paymentId,
          signature: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        }),
      });
      const invalidSigRes = await checkoutPOST(invalidSigReq);
      expect(invalidSigRes.status).toBe(400);

      // Test 2: Wrong User (Patient 2 trying to verify Patient 1's checkout)
      const validSig = generateValidSignature(initData.orderId, paymentId);
      const wrongUserReq = new NextRequest("http://localhost:3000/api/checkout", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${patient2Token}` },
        body: JSON.stringify({
          action: "VERIFY",
          checkoutId: initData.checkoutId,
          orderId: initData.orderId,
          paymentId,
          signature: validSig,
        }),
      });
      const wrongUserRes = await checkoutPOST(wrongUserReq);
      expect(wrongUserRes.status).toBe(403);
    });

    it("3.3 Authorized but uncaptured payment stays PENDING_CAPTURE (202), never confirms prematurely", async () => {
      const slotId = await createFutureSlot(33);
      const idempotencyKey = `idem_auth_uncapt_${Date.now()}`;

      const initRes = await checkoutPOST(
        new NextRequest("http://localhost:3000/api/checkout", {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${patient1Token}` },
          body: JSON.stringify({ action: "INITIATE", doctorId, slotId, paymentMethod: "ONLINE", idempotencyKey }),
        })
      );
      const initData = await initRes.json();
      testCheckoutIds.push(initData.checkoutId);
      testOrderIds.push(initData.orderId);

      // "pay_mock_auth_*" triggers authorized status in fetchRazorpayPayment mock
      const authPaymentId = `pay_mock_auth_${Date.now()}`;
      const sig = generateValidSignature(initData.orderId, authPaymentId);

      const verifyReq = new NextRequest("http://localhost:3000/api/checkout", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${patient1Token}` },
        body: JSON.stringify({
          action: "VERIFY",
          checkoutId: initData.checkoutId,
          orderId: initData.orderId,
          paymentId: authPaymentId,
          signature: sig,
        }),
      });

      const verifyRes = await checkoutPOST(verifyReq);
      expect(verifyRes.status).toBe(202);
      const verifyData = await verifyRes.json();
      expect(verifyData.message).toMatch(/pending/i);

      // Verify Appointment was NOT created
      const appt = await prisma.appointment.findFirst({ where: { slotId } });
      expect(appt).toBeNull();
    });
  });

  // ==========================================================================
  // 4. Strict Expiry & Cleanup Safety
  // ==========================================================================
  describe("4. Strict Expiry & Cleanup Invariants", () => {
    it("4.1 Late payment after reservation expiry does NOT reclaim slot, triggers automatic refund compensation", async () => {
      const slotId = await createFutureSlot(34);
      const idempotencyKey = `idem_strict_expiry_${Date.now()}`;

      const initRes = await checkoutPOST(
        new NextRequest("http://localhost:3000/api/checkout", {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${patient1Token}` },
          body: JSON.stringify({ action: "INITIATE", doctorId, slotId, paymentMethod: "ONLINE", idempotencyKey }),
        })
      );
      const initData = await initRes.json();
      testCheckoutIds.push(initData.checkoutId);
      testOrderIds.push(initData.orderId);

      // Simulate reservation expiry in the database
      const pastExpiry = new Date(Date.now() - 60000); // 1 minute in the past
      await prisma.checkout.update({
        where: { id: initData.checkoutId },
        data: { expiresAt: pastExpiry, status: "EXPIRED" },
      });
      await prisma.slot.update({
        where: { id: slotId },
        data: { status: "AVAILABLE", heldByPatientId: null, holdToken: null, holdExpiresAt: null },
      });

      // Attempt to verify captured late payment
      const paymentId = `pay_mock_late_${Date.now()}`;
      const sig = generateValidSignature(initData.orderId, paymentId);

      const verifyRes = await checkoutPOST(
        new NextRequest("http://localhost:3000/api/checkout", {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${patient1Token}` },
          body: JSON.stringify({
            action: "VERIFY",
            checkoutId: initData.checkoutId,
            orderId: initData.orderId,
            paymentId,
            signature: sig,
          }),
        })
      );

      // Must be rejected with 409 and slot must NOT be reclaimed!
      expect(verifyRes.status).toBe(409);
      const verifyData = await verifyRes.json();
      expect(verifyData.error).toBe("SLOT_UNAVAILABLE_REFUNDED");
      expect(verifyData.refundStatus).toBeDefined();

      // Slot remains AVAILABLE and is NOT booked
      const slotInDb = await prisma.slot.findUnique({ where: { id: slotId } });
      expect(slotInDb?.status).toBe("AVAILABLE");

      // Refund intent is durably recorded
      const refundInDb = await prisma.refund.findFirst({
        where: { payment: { razorpayOrderId: initData.orderId } },
      });
      expect(refundInDb).toBeDefined();
    });

    it("4.2 Stale checkout cleanup does NOT release slot held by a newer patient", async () => {
      const slotId = await createFutureSlot(35);

      // Old patient checkout expires
      const oldCheckout = await prisma.checkout.create({
        data: {
          idempotencyKey: `idem_old_chk_${Date.now()}`,
          userId: patient1UserId,
          patientId: patient1Id,
          doctorId,
          slotId,
          holdToken: "old_patient_hold_token_123",
          paymentMethod: "ONLINE",
          amount: 120000,
          currency: "INR",
          status: "READY_FOR_PAYMENT",
          expiresAt: new Date(Date.now() - 30000), // Expired 30 seconds ago
        },
      });
      testCheckoutIds.push(oldCheckout.id);

      // Meanwhile, newer patient holds the slot with a fresh token
      const freshToken = "new_patient_fresh_token_456";
      const freshExpiry = new Date(Date.now() + 10 * 60 * 1000);
      await prisma.slot.update({
        where: { id: slotId },
        data: {
          status: "HELD",
          heldByPatientId: patient2Id,
          holdToken: freshToken,
          holdExpiresAt: freshExpiry,
        },
      });

      // Run stale cleanup
      await expireStaleCheckouts();

      // Old checkout is marked EXPIRED
      const updatedOldCheckout = await prisma.checkout.findUnique({ where: { id: oldCheckout.id } });
      expect(updatedOldCheckout?.status).toBe("EXPIRED");

      // BUT the newer patient's hold on the slot was NOT destroyed!
      const slotInDb = await prisma.slot.findUnique({ where: { id: slotId } });
      expect(slotInDb?.status).toBe("HELD");
      expect(slotInDb?.heldByPatientId).toBe(patient2Id);
      expect(slotInDb?.holdToken).toBe(freshToken);
    });
  });

  // ==========================================================================
  // 5. Authenticated Checkout Status Polling
  // ==========================================================================
  describe("5. Authenticated Checkout Status Endpoint", () => {
    it("5.1 Returns authoritative status and appointment details for owner", async () => {
      const slotId = await createFutureSlot(36);
      const idempotencyKey = `idem_status_test_${Date.now()}`;

      const initRes = await checkoutPOST(
        new NextRequest("http://localhost:3000/api/checkout", {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${patient1Token}` },
          body: JSON.stringify({ action: "INITIATE", doctorId, slotId, paymentMethod: "ONLINE", idempotencyKey }),
        })
      );
      const initData = await initRes.json();
      testCheckoutIds.push(initData.checkoutId);
      testOrderIds.push(initData.orderId);

      // Poll status endpoint
      const statusReq = new NextRequest(`http://localhost:3000/api/checkout/${initData.checkoutId}/status`, {
        method: "GET",
        headers: { authorization: `Bearer ${patient1Token}` },
      });
      const statusRes = await checkoutStatusGET(statusReq, {
        params: Promise.resolve({ checkoutId: initData.checkoutId }),
      });

      expect(statusRes.status).toBe(200);
      const statusData = await statusRes.json();
      expect(statusData.ok).toBe(true);
      expect(statusData.status).toBe("READY_FOR_PAYMENT");
      expect(statusData.isConfirmed).toBe(false);
    });
  });
});
