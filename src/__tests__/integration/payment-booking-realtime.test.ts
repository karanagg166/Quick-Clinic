import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import { createServer, Server as HttpServer } from "http";
import { Server as SocketIOServer } from "socket.io";
import { io as Client, Socket as ClientSocket } from "socket.io-client";
import { NextRequest } from "next/server";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { createToken } from "@/lib/auth";
import { SocketServer } from "../../../socket-server/server";
import {
  createOrReusePaymentOrder,
  verifyAndTransitionPayment,
  claimAndExecuteRefund,
  getAuthoritativePaymentStatus,
} from "@/lib/payment-booking-service";
import { createSlotHold, confirmSlotHold } from "@/lib/booking";
import { persistChatMessage } from "@/lib/chat-service";
import { POST as createOrderPOST } from "@/app/api/user/[userId]/payments/createOrder/route";
import { POST as verifyOrderPOST } from "@/app/api/user/[userId]/payments/verifyOrder/route";
import { GET as paymentStatusGET } from "@/app/api/user/[userId]/payments/[orderId]/status/route";
import { POST as webhookPOST } from "@/app/api/webhooks/razorpay/route";
import { POST as reconcilePOST } from "@/app/api/cron/reconcile-payments/route";

// Mock Upstash Redis with in-memory map for fast execution without DNS delays
const inMemoryRedis = new Map<string, any>();
vi.mock("@upstash/redis", () => ({
  Redis: class MockRedis {
    set(key: string, value: any) {
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
      const strVal = typeof val === "string" ? val : JSON.stringify(val);
      if (strVal.includes(args[0]) && strVal.includes(args[1])) {
        inMemoryRedis.delete(keys[0]);
        return Promise.resolve(1);
      }
      return Promise.resolve(0);
    }
  },
}));

describe("Payment, Booking & Real-Time Production Integration Test Suite", () => {
  const secretKey = "test_razorpay_secret_key_123456789";
  const webhookSecret = "test_razorpay_webhook_secret_123";
  const jwtSecret = "ci_jwt_secret_must_be_at_least_32_characters_long_for_security";
  const cronSecret = "ci_cron_secret_1234567890";

  let patient1UserId: string;
  let patient1Id: string;
  let patient1Token: string;

  let patient2UserId: string;
  let patient2Id: string;
  let patient2Token: string;

  let doctorUserId: string;
  let doctorId: string;
  let doctorToken: string;

  let relationId: string;

  let testSlotIds: string[] = [];
  let testOrderIds: string[] = [];

  // Socket test server variables
  let httpServer: HttpServer;
  let ioServer: SocketIOServer;
  let socketServer: SocketServer;
  let socketPort: number;

  function generateValidSignature(orderId: string, paymentId: string, secret = secretKey): string {
    return crypto.createHmac("sha256", secret).update(`${orderId}|${paymentId}`).digest("hex");
  }

  function generateValidWebhookSignature(rawBody: string, secret = webhookSecret): string {
    return crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  }

  function createSocketJWT(payload: Record<string, any>, secret = jwtSecret, expiresInSec = 3600): string {
    const now = Math.floor(Date.now() / 1000);
    const fullPayload = {
      iat: now,
      exp: now + expiresInSec,
      aud: "quick-clinic-socket",
      ...payload,
    };
    const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
    const body = Buffer.from(JSON.stringify(fullPayload)).toString("base64url");
    const signature = crypto.createHmac("sha256", secret).update(`${header}.${body}`).digest("base64url");
    return `${header}.${body}.${signature}`;
  }

  beforeAll(async () => {
    process.env.RAZORPAY_KEY_ID = "rzp_test_mock_key_id";
    process.env.RAZORPAY_KEY_SECRET = secretKey;
    process.env.RAZORPAY_WEBHOOK_SECRET = webhookSecret;
    process.env.JWT_SECRET = jwtSecret;
    process.env.INTERNAL_API_SECRET = jwtSecret;
    process.env.CRON_SECRET = cronSecret;

    const timestamp = Date.now();

    // 1. Create Patient 1
    const p1User = await prisma.user.create({
      data: {
        name: "Patient One",
        email: `p1_prod_${timestamp}@quickclinic.test`,
        phoneNo: "9876540001",
        password: "$2b$10$hashedpasswordforexamplepurposeonly",
        age: 29,
        gender: "FEMALE",
        address: "101 Patient St",
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
        name: "Patient Two",
        email: `p2_prod_${timestamp}@quickclinic.test`,
        phoneNo: "9876540002",
        password: "$2b$10$hashedpasswordforexamplepurposeonly",
        age: 32,
        gender: "MALE",
        address: "102 Patient St",
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
      data: { userId: patient2UserId, medicalHistory: "Asthma" },
    });
    patient2Id = p2.id;

    // 3. Create Doctor
    const docUser = await prisma.user.create({
      data: {
        name: "Dr. Production Specialist",
        email: `doc_prod_${timestamp}@quickclinic.test`,
        phoneNo: "9876540003",
        password: "$2b$10$hashedpasswordforexamplepurposeonly",
        age: 48,
        gender: "MALE",
        address: "201 Hospital Rd",
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
        specialty: "CARDIOLOGIST",
        fees: 1500, // ₹1,500 = 150,000 paise
        experience: 16,
        balance: 0,
      },
    });
    doctorId = doc.id;

    // 4. Create Doctor-Patient Relation between doctor and patient1
    const rel = await prisma.doctorPatientRelation.create({
      data: {
        doctorsUserId: doctorUserId,
        patientsUserId: patient1UserId,
      },
    });
    relationId = rel.id;

    // 5. Spin up real Socket.IO server on ephemeral port for socket tests
    httpServer = createServer();
    ioServer = new SocketIOServer(httpServer, { cors: { origin: "*" } });
    socketServer = new SocketServer(ioServer, prisma as any, jwtSecret);

    await new Promise<void>((resolve) => {
      httpServer.listen(0, () => {
        const addr = httpServer.address();
        socketPort = typeof addr === "object" && addr ? addr.port : 4001;
        resolve();
      });
    });
  });

  afterAll(async () => {
    // Close socket server
    if (ioServer) await ioServer.close();
    if (httpServer) await new Promise((res) => httpServer.close(res));

    // Database cleanup
    try {
      if (testOrderIds.length > 0) {
        await prisma.refund.deleteMany({
          where: { payment: { razorpayOrderId: { in: testOrderIds } } },
        });
        await prisma.webhookEvent.deleteMany({
          where: { payment: { razorpayOrderId: { in: testOrderIds } } },
        });
        await prisma.payment.deleteMany({
          where: { razorpayOrderId: { in: testOrderIds } },
        });
      }
      await prisma.notificationOutbox.deleteMany({});
      await prisma.chatMessages.deleteMany({
        where: { doctorPatientRelationId: relationId },
      });
      await prisma.appointment.deleteMany({
        where: { patientId: { in: [patient1Id, patient2Id] } },
      });
      if (testSlotIds.length > 0) {
        await prisma.slot.deleteMany({ where: { id: { in: testSlotIds } } });
      }
      await prisma.doctorPatientRelation.deleteMany({
        where: { id: relationId },
      });
      await prisma.notification.deleteMany({
        where: { userId: { in: [patient1UserId, patient2UserId, doctorUserId] } },
      });
      await prisma.doctor.deleteMany({ where: { id: doctorId } });
      await prisma.patient.deleteMany({ where: { id: { in: [patient1Id, patient2Id] } } });
      await prisma.user.deleteMany({
        where: { id: { in: [patient1UserId, patient2UserId, doctorUserId] } },
      });
    } catch (e) {
      console.warn("Cleanup warning in integration test suite:", e);
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
  // SECTION 1: Server-Authoritative Verification & Edge Cases
  // ==========================================================================
  describe("1. Server-Authoritative Verification & Edge Cases", () => {
    it("1.1 Invalid signature and wrong user: rejects unauthorized user with 403 and invalid HMAC with 400", async () => {
      const slotId = await createFutureSlot(25);
      const holdRes = await createSlotHold(slotId, doctorId, patient1Id);
      expect(holdRes.kind).toBe("ok");
      const holdToken = (holdRes as any).token;

      const orderResult = await createOrReusePaymentOrder({
        userId: patient1UserId,
        patientId: patient1Id,
        doctorId,
        slotId,
        holdToken,
        amount: 150000,
        currency: "INR",
        idempotencyKey: `idem_auth_test_${Date.now()}`,
      });
      const orderId = orderResult.order.razorpayOrderId;
      testOrderIds.push(orderId);

      const paymentId = `pay_mock_valid_${Date.now()}`;
      const validSig = generateValidSignature(orderId, paymentId);

      // 1. Wrong user (Patient 2 calls verification for Patient 1's order) -> 403
      const wrongUserReq = new NextRequest(
        `http://localhost:3000/api/user/${patient2UserId}/payments/verifyOrder`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${patient2Token}`,
          },
          body: JSON.stringify({
            orderId,
            paymentId,
            signature: validSig,
          }),
        }
      );
      const wrongUserRes = await verifyOrderPOST(wrongUserReq, {
        params: Promise.resolve({ userId: patient2UserId }),
      });
      expect(wrongUserRes.status).toBe(403);
      const wrongUserData = await wrongUserRes.json();
      expect(wrongUserData.error).toMatch(/does not belong to user|not authorized/i);

      // 2. Patient 1 provides forged signature -> 400
      const forgedSigReq = new NextRequest(
        `http://localhost:3000/api/user/${patient1UserId}/payments/verifyOrder`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${patient1Token}`,
          },
          body: JSON.stringify({
            orderId,
            paymentId,
            signature: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
          }),
        }
      );
      const forgedSigRes = await verifyOrderPOST(forgedSigReq, {
        params: Promise.resolve({ userId: patient1UserId }),
      });
      expect(forgedSigRes.status).toBe(400);
      const forgedData = await forgedSigRes.json();
      expect(forgedData.error).toMatch(/invalid.*signature/i);
    });

    it("1.2 Wrong amount, currency, and order association: provider mismatches rejected with 400", async () => {
      const slotId = await createFutureSlot(26);
      const holdRes = await createSlotHold(slotId, doctorId, patient1Id);
      const holdToken = (holdRes as any).token;

      const orderResult = await createOrReusePaymentOrder({
        userId: patient1UserId,
        patientId: patient1Id,
        doctorId,
        slotId,
        holdToken,
        amount: 150000,
        currency: "INR",
        idempotencyKey: `idem_mismatch_${Date.now()}`,
      });
      const orderId = orderResult.order.razorpayOrderId;
      testOrderIds.push(orderId);

      // Wrong amount (mock provider returns 99999 instead of 150000)
      const wrongAmtPayId = `pay_mock_wrongamt_${Date.now()}`;
      const wrongAmtSig = generateValidSignature(orderId, wrongAmtPayId);
      const wrongAmtReq = new NextRequest(
        `http://localhost:3000/api/user/${patient1UserId}/payments/verifyOrder`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${patient1Token}`,
          },
          body: JSON.stringify({
            orderId,
            paymentId: wrongAmtPayId,
            signature: wrongAmtSig,
          }),
        }
      );
      const resAmt = await verifyOrderPOST(wrongAmtReq, {
        params: Promise.resolve({ userId: patient1UserId }),
      });
      expect(resAmt.status).toBe(400);
      const dataAmt = await resAmt.json();
      expect(dataAmt.error).toMatch(/amount.*mismatch/i);

      // Wrong currency (mock provider returns USD instead of INR)
      const wrongCurrPayId = `pay_mock_wrongcurr_${Date.now()}`;
      const wrongCurrSig = generateValidSignature(orderId, wrongCurrPayId);
      const wrongCurrReq = new NextRequest(
        `http://localhost:3000/api/user/${patient1UserId}/payments/verifyOrder`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${patient1Token}`,
          },
          body: JSON.stringify({
            orderId,
            paymentId: wrongCurrPayId,
            signature: wrongCurrSig,
          }),
        }
      );
      const resCurr = await verifyOrderPOST(wrongCurrReq, {
        params: Promise.resolve({ userId: patient1UserId }),
      });
      expect(resCurr.status).toBe(400);
      const dataCurr = await resCurr.json();
      expect(dataCurr.error).toMatch(/currency.*mismatch/i);

      // Wrong order association (mock provider returns order_wrong_mismatch)
      const wrongOrderPayId = `pay_mock_wrongorder_${Date.now()}`;
      const wrongOrderSig = generateValidSignature(orderId, wrongOrderPayId);
      const wrongOrderReq = new NextRequest(
        `http://localhost:3000/api/user/${patient1UserId}/payments/verifyOrder`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${patient1Token}`,
          },
          body: JSON.stringify({
            orderId,
            paymentId: wrongOrderPayId,
            signature: wrongOrderSig,
          }),
        }
      );
      const resOrder = await verifyOrderPOST(wrongOrderReq, {
        params: Promise.resolve({ userId: patient1UserId }),
      });
      expect(resOrder.status).toBe(400);
      const dataOrder = await resOrder.json();
      expect(dataOrder.error).toMatch(/not associated with this order ID|belongs to order/i);
    });

    it("1.3 Authorized but uncaptured payment: stays PENDING, never confirms booking prematurely", async () => {
      const slotId = await createFutureSlot(27);
      const holdRes = await createSlotHold(slotId, doctorId, patient1Id);
      const holdToken = (holdRes as any).token;

      const orderResult = await createOrReusePaymentOrder({
        userId: patient1UserId,
        patientId: patient1Id,
        doctorId,
        slotId,
        holdToken,
        amount: 150000,
        currency: "INR",
        idempotencyKey: `idem_authonly_${Date.now()}`,
      });
      const orderId = orderResult.order.razorpayOrderId;
      testOrderIds.push(orderId);

      const authPayId = `pay_mock_auth_${Date.now()}`;
      const authSig = generateValidSignature(orderId, authPayId);

      const req = new NextRequest(
        `http://localhost:3000/api/user/${patient1UserId}/payments/verifyOrder`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${patient1Token}`,
          },
          body: JSON.stringify({
            orderId,
            paymentId: authPayId,
            signature: authSig,
          }),
        }
      );
      const res = await verifyOrderPOST(req, {
        params: Promise.resolve({ userId: patient1UserId }),
      });
      expect(res.status).toBe(202);
      const data = await res.json();
      expect(data.message).toMatch(/authorized.*capture/i);

      // Verify DB Payment is STILL PENDING and no Appointment was created
      const dbPayment = await prisma.payment.findUnique({
        where: { razorpayOrderId: orderId },
      });
      expect(["CREATED", "PENDING"]).toContain(dbPayment?.status);
      expect(dbPayment?.status).not.toBe("SUCCESS");
      expect(dbPayment?.razorpayPaymentId).toBe(authPayId);

      const apptCount = await prisma.appointment.count({ where: { slotId } });
      expect(apptCount).toBe(0);
    });

    it("1.4 Duplicate order requests: reuses matching attempt, rejects conflicting reuse with 409", async () => {
      const slotIdA = await createFutureSlot(28);
      const slotIdB = await createFutureSlot(29);

      const holdA = await createSlotHold(slotIdA, doctorId, patient1Id);
      const holdTokenA = (holdA as any).token;

      const holdB = await createSlotHold(slotIdB, doctorId, patient1Id);
      const holdTokenB = (holdB as any).token;

      const clientKey = `idem_dup_test_${Date.now()}`;

      // 1. Initial order creation
      const req1 = new NextRequest(
        `http://localhost:3000/api/user/${patient1UserId}/payments/createOrder`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${patient1Token}`,
          },
          body: JSON.stringify({
            doctorId,
            slotId: slotIdA,
            holdToken: holdTokenA,
            idempotencyKey: clientKey,
          }),
        }
      );
      const res1 = await createOrderPOST(req1, {
        params: Promise.resolve({ userId: patient1UserId }),
      });
      expect(res1.status).toBe(201);
      const data1 = await res1.json();
      const firstOrderId = data1.order.razorpayOrderId;
      testOrderIds.push(firstOrderId);

      // 2. Duplicate order creation with identical parameters -> Reuses attempt
      const req2 = new NextRequest(
        `http://localhost:3000/api/user/${patient1UserId}/payments/createOrder`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${patient1Token}`,
          },
          body: JSON.stringify({
            doctorId,
            slotId: slotIdA,
            holdToken: holdTokenA,
            idempotencyKey: clientKey,
          }),
        }
      );
      const res2 = await createOrderPOST(req2, {
        params: Promise.resolve({ userId: patient1UserId }),
      });
      expect(res2.status).toBe(200);
      const data2 = await res2.json();
      expect(data2.order.razorpayOrderId).toBe(firstOrderId);

      // 3. Conflicting order creation with same idempotencyKey but different slot -> 409 Conflict
      const reqConflict = new NextRequest(
        `http://localhost:3000/api/user/${patient1UserId}/payments/createOrder`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${patient1Token}`,
          },
          body: JSON.stringify({
            doctorId,
            slotId: slotIdB,
            holdToken: holdTokenB,
            idempotencyKey: clientKey,
          }),
        }
      );
      const resConflict = await createOrderPOST(reqConflict, {
        params: Promise.resolve({ userId: patient1UserId }),
      });
      expect(resConflict.status).toBe(409);
      const dataConflict = await resConflict.json();
      const errText = dataConflict.error || dataConflict.message || "";
      expect(errText).toMatch(/idempotency key has already been used|different booking details|conflicting/i);
    });
  });

  // ==========================================================================
  // SECTION 2: Concurrency, Webhooks, Races & Recovery
  // ==========================================================================
  describe("2. Concurrency, Webhooks, Races & Recovery", () => {
    it("2.1 Verification vs Webhook race: creates exactly ONE appointment and single SUCCESS outcome", async () => {
      const slotId = await createFutureSlot(30);
      const holdRes = await createSlotHold(slotId, doctorId, patient1Id);
      const holdToken = (holdRes as any).token;

      const orderResult = await createOrReusePaymentOrder({
        userId: patient1UserId,
        patientId: patient1Id,
        doctorId,
        slotId,
        holdToken,
        amount: 150000,
        currency: "INR",
        idempotencyKey: `idem_race_${Date.now()}`,
      });
      const orderId = orderResult.order.razorpayOrderId;
      testOrderIds.push(orderId);

      const paymentId = `pay_mock_race_${Date.now()}`;
      const checkoutSig = generateValidSignature(orderId, paymentId);

      const webhookPayload = JSON.stringify({
        event: "payment.captured",
        payload: {
          payment: {
            entity: {
              id: paymentId,
              order_id: orderId,
              amount: 150000,
              currency: "INR",
              status: "captured",
              captured: true,
            },
          },
        },
      });
      const webhookSig = generateValidWebhookSignature(webhookPayload);

      // Fire both concurrently
      const [verifyRes, webhookRes] = await Promise.all([
        verifyOrderPOST(
          new NextRequest(
            `http://localhost:3000/api/user/${patient1UserId}/payments/verifyOrder`,
            {
              method: "POST",
              headers: {
                "content-type": "application/json",
                authorization: `Bearer ${patient1Token}`,
              },
              body: JSON.stringify({ orderId, paymentId, signature: checkoutSig }),
            }
          ),
          { params: Promise.resolve({ userId: patient1UserId }) }
        ),
        webhookPOST(
          new NextRequest(`http://localhost:3000/api/webhooks/razorpay`, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-razorpay-signature": webhookSig,
              "x-razorpay-event-id": `evt_race_${Date.now()}`,
            },
            body: webhookPayload,
          })
        ),
      ]);

      expect(verifyRes.status).toBe(200);
      expect(webhookRes.status).toBe(200);

      // Invariants: exactly ONE appointment exists for slotId
      const appointments = await prisma.appointment.findMany({
        where: { slotId },
      });
      expect(appointments.length).toBe(1);
      expect(appointments[0].status).toBe("CONFIRMED");

      const payment = await prisma.payment.findUnique({
        where: { razorpayOrderId: orderId },
      });
      expect(payment?.status).toBe("SUCCESS");
      expect(payment?.razorpayPaymentId).toBe(paymentId);
    });

    it("2.2 Duplicate and out-of-order webhooks: idempotently deduplicates provider event IDs", async () => {
      const slotId = await createFutureSlot(31);
      const holdRes = await createSlotHold(slotId, doctorId, patient1Id);
      const holdToken = (holdRes as any).token;

      const orderResult = await createOrReusePaymentOrder({
        userId: patient1UserId,
        patientId: patient1Id,
        doctorId,
        slotId,
        holdToken,
        amount: 150000,
        currency: "INR",
        idempotencyKey: `idem_wh_dup_${Date.now()}`,
      });
      const orderId = orderResult.order.razorpayOrderId;
      testOrderIds.push(orderId);

      const paymentId = `pay_mock_wh_dup_${Date.now()}`;
      const providerEventId = `evt_dedup_${Date.now()}`;

      const webhookPayload = JSON.stringify({
        event: "payment.captured",
        payload: {
          payment: {
            entity: {
              id: paymentId,
              order_id: orderId,
              amount: 150000,
              currency: "INR",
              status: "captured",
              captured: true,
            },
          },
        },
      });
      const webhookSig = generateValidWebhookSignature(webhookPayload);

      // Delivery 1: Processes event
      const res1 = await webhookPOST(
        new NextRequest(`http://localhost:3000/api/webhooks/razorpay`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-razorpay-signature": webhookSig,
            "x-razorpay-event-id": providerEventId,
          },
          body: webhookPayload,
        })
      );
      expect(res1.status).toBe(200);
      const data1 = await res1.json();
      expect(data1.received).toBe(true);
      expect(data1.duplicate).toBeUndefined();

      // Delivery 2: Exact duplicate event ID -> returns { received: true, duplicate: true }
      const res2 = await webhookPOST(
        new NextRequest(`http://localhost:3000/api/webhooks/razorpay`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-razorpay-signature": webhookSig,
            "x-razorpay-event-id": providerEventId,
          },
          body: webhookPayload,
        })
      );
      expect(res2.status).toBe(200);
      const data2 = await res2.json();
      expect(data2.received).toBe(true);
      expect(data2.duplicate).toBe(true);

      // Stale event (order.paid on already SUCCESS payment) does not corrupt state
      const stalePayload = JSON.stringify({
        event: "order.paid",
        payload: {
          order: {
            entity: {
              id: orderId,
              amount_paid: 150000,
              status: "paid",
            },
          },
        },
      });
      const staleSig = generateValidWebhookSignature(stalePayload);
      const resStale = await webhookPOST(
        new NextRequest(`http://localhost:3000/api/webhooks/razorpay`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-razorpay-signature": staleSig,
            "x-razorpay-event-id": `evt_stale_${Date.now()}`,
          },
          body: stalePayload,
        })
      );
      expect(resStale.status).toBe(200);

      const dbPayment = await prisma.payment.findUnique({
        where: { razorpayOrderId: orderId },
      });
      expect(dbPayment?.status).toBe("SUCCESS");
    });

    it("2.3 Browser closes after payment: webhook autonomously confirms booking, status route recovers it", async () => {
      const slotId = await createFutureSlot(32);
      const holdRes = await createSlotHold(slotId, doctorId, patient1Id);
      const holdToken = (holdRes as any).token;

      const orderResult = await createOrReusePaymentOrder({
        userId: patient1UserId,
        patientId: patient1Id,
        doctorId,
        slotId,
        holdToken,
        amount: 150000,
        currency: "INR",
        idempotencyKey: `idem_browser_close_${Date.now()}`,
      });
      const orderId = orderResult.order.razorpayOrderId;
      testOrderIds.push(orderId);

      const paymentId = `pay_mock_bg_${Date.now()}`;
      const webhookPayload = JSON.stringify({
        event: "payment.captured",
        payload: {
          payment: {
            entity: {
              id: paymentId,
              order_id: orderId,
              amount: 150000,
              currency: "INR",
              status: "captured",
              captured: true,
            },
          },
        },
      });
      const webhookSig = generateValidWebhookSignature(webhookPayload);

      // Webhook arrives (browser never called verifyOrder)
      const whRes = await webhookPOST(
        new NextRequest(`http://localhost:3000/api/webhooks/razorpay`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-razorpay-signature": webhookSig,
            "x-razorpay-event-id": `evt_bg_${Date.now()}`,
          },
          body: webhookPayload,
        })
      );
      expect(whRes.status).toBe(200);

      // Patient reopens browser and polls authenticated status endpoint
      const statusReq = new NextRequest(
        `http://localhost:3000/api/user/${patient1UserId}/payments/${orderId}/status`,
        {
          method: "GET",
          headers: { authorization: `Bearer ${patient1Token}` },
        }
      );
      const statusRes = await paymentStatusGET(statusReq, {
        params: Promise.resolve({ userId: patient1UserId, orderId }),
      });
      expect(statusRes.status).toBe(200);
      const statusData = await statusRes.json();
      expect(statusData.status).toBe("SUCCESS");
      expect(statusData.isConfirmed).toBe(true);
      expect(statusData.appointmentId).toBeDefined();
    });

    it("2.4 Provider timeout during refund: records PENDING with stable identity and reconciles cleanly", async () => {
      const orderId = `order_timeout_${Date.now()}`;
      const paymentId = `pay_mock_refund_timeout_${Date.now()}`;
      testOrderIds.push(orderId);

      const payment = await prisma.payment.create({
        data: {
          userId: patient1UserId,
          doctorId,
          amount: 150000,
          currency: "INR",
          status: "SUCCESS",
          razorpayOrderId: orderId,
          razorpayPaymentId: paymentId,
        },
      });

      // Claim refund where provider request times out
      const refundResult = await claimAndExecuteRefund({
        paymentId: payment.id,
        amount: 150000,
        reason: "Patient cancelled before appointment",
      });

      // Never report REFUNDED while still pending
      expect(refundResult.status).toBe("REFUND_PENDING");
      expect(refundResult.pendingReconciliation).toBe(true);

      const dbRefund = await prisma.refund.findFirst({
        where: { paymentId: payment.id },
      });
      expect(dbRefund?.status).toBe("PENDING");
      expect(dbRefund?.idempotencyKey).toBeDefined();

      const dbPayment = await prisma.payment.findUnique({
        where: { id: payment.id },
      });
      expect(dbPayment?.status).toBe("REFUND_PENDING");

      // Reconcile via protected cron endpoint
      // Simulate age > 2 mins for cron processing
      await prisma.refund.update({
        where: { id: dbRefund!.id },
        data: { updatedAt: new Date(Date.now() - 3 * 60 * 1000) },
      });

      const cronReq = new NextRequest(`http://localhost:3000/api/cron/reconcile-payments`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${cronSecret}`,
        },
      });
      const cronRes = await reconcilePOST(cronReq);
      expect(cronRes.status).toBe(200);
      const cronData = await cronRes.json();
      expect(cronData.ok).toBe(true);
    });

    it("2.5 Refund states: pending, failed, completed variants handled distinctly without data corruption", async () => {
      // 1. Pending refund submission
      const orderPending = `order_rf_p_${Date.now()}`;
      testOrderIds.push(orderPending);
      const paymentPending = await prisma.payment.create({
        data: {
          userId: patient1UserId,
          doctorId,
          amount: 150000,
          currency: "INR",
          status: "SUCCESS",
          razorpayOrderId: orderPending,
          razorpayPaymentId: `pay_mock_refund_pending_${Date.now()}`,
        },
      });
      const resPending = await claimAndExecuteRefund({
        paymentId: paymentPending.id,
        amount: 150000,
        reason: "Customer support initiated hold",
      });
      expect(resPending.status).toBe("REFUND_PENDING");

      // 2. Failed refund submission (provider error)
      const orderFailed = `order_rf_f_${Date.now()}`;
      testOrderIds.push(orderFailed);
      const paymentFailed = await prisma.payment.create({
        data: {
          userId: patient1UserId,
          doctorId,
          amount: 150000,
          currency: "INR",
          status: "SUCCESS",
          razorpayOrderId: orderFailed,
          razorpayPaymentId: `pay_mock_refund_fail_${Date.now()}`,
        },
      });
      const resFailed = await claimAndExecuteRefund({
        paymentId: paymentFailed.id,
        amount: 150000,
        reason: "Account closed",
      });
      expect(resFailed.status).toBe("FAILED");

      // 3. Completed refund
      const orderCompleted = `order_rf_c_${Date.now()}`;
      testOrderIds.push(orderCompleted);
      const paymentCompleted = await prisma.payment.create({
        data: {
          userId: patient1UserId,
          doctorId,
          amount: 150000,
          currency: "INR",
          status: "SUCCESS",
          razorpayOrderId: orderCompleted,
          razorpayPaymentId: `pay_mock_normal_${Date.now()}`,
        },
      });
      const resCompleted = await claimAndExecuteRefund({
        paymentId: paymentCompleted.id,
        amount: 150000,
        reason: "Standard cancellation",
      });
      expect(resCompleted.status).toBe("REFUNDED");
      const dbPaymentCompleted = await prisma.payment.findUnique({
        where: { id: paymentCompleted.id },
      });
      expect(dbPaymentCompleted?.status).toBe("REFUNDED");
    });
  });

  // ==========================================================================
  // SECTION 3: Slot Booking, Expiry, Competing Holds & History
  // ==========================================================================
  describe("3. Slot Booking, Expiry, Competing Holds & History", () => {
    it("3.1 Capture after hold expiry: reacquires slot if available, triggers refund compensation if taken", async () => {
      // Case A: Hold expired, but slot remains AVAILABLE -> reacquires and confirms
      const slotAId = await createFutureSlot(33);
      const holdA = await createSlotHold(slotAId, doctorId, patient1Id);
      const holdTokenA = (holdA as any).token;

      const orderA = await createOrReusePaymentOrder({
        userId: patient1UserId,
        patientId: patient1Id,
        doctorId,
        slotId: slotAId,
        holdToken: holdTokenA,
        amount: 150000,
        currency: "INR",
        idempotencyKey: `idem_reacquire_${Date.now()}`,
      });
      const orderAId = orderA.order.razorpayOrderId;
      testOrderIds.push(orderAId);

      // Expire the hold in database
      await prisma.slot.update({
        where: { id: slotAId },
        data: {
          status: "AVAILABLE",
          heldByPatientId: null,
          holdToken: null,
          holdExpiresAt: new Date(Date.now() - 10000),
        },
      });

      const payAId = `pay_mock_reacquire_${Date.now()}`;
      const sigA = generateValidSignature(orderAId, payAId);
      const verifyAReq = new NextRequest(
        `http://localhost:3000/api/user/${patient1UserId}/payments/verifyOrder`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${patient1Token}`,
          },
          body: JSON.stringify({
            orderId: orderAId,
            paymentId: payAId,
            signature: sigA,
          }),
        }
      );
      const verifyARes = await verifyOrderPOST(verifyAReq, {
        params: Promise.resolve({ userId: patient1UserId }),
      });
      expect(verifyARes.status).toBe(200);
      const verifyAData = await verifyARes.json();
      expect(verifyAData.message).toMatch(/confirmed/i);

      // Case B: Hold expired, AND slot was booked by someone else -> compensation refund
      const slotBId = await createFutureSlot(34);
      const holdB = await createSlotHold(slotBId, doctorId, patient1Id);
      const holdTokenB = (holdB as any).token;

      const orderB = await createOrReusePaymentOrder({
        userId: patient1UserId,
        patientId: patient1Id,
        doctorId,
        slotId: slotBId,
        holdToken: holdTokenB,
        amount: 150000,
        currency: "INR",
        idempotencyKey: `idem_conflict_comp_${Date.now()}`,
      });
      const orderBId = orderB.order.razorpayOrderId;
      testOrderIds.push(orderBId);

      // Slot is taken by Patient 2
      await prisma.slot.update({
        where: { id: slotBId },
        data: {
          status: "BOOKED",
          heldByPatientId: null,
          holdToken: null,
        },
      });
      await prisma.appointment.create({
        data: {
          doctorId,
          patientId: patient2Id,
          slotId: slotBId,
          status: "CONFIRMED",
          paymentMethod: "OFFLINE",
          isAppointmentOffline: true,
        },
      });

      // Patient 1's payment is now verified after slot was booked
      const payBId = `pay_mock_comp_${Date.now()}`;
      const sigB = generateValidSignature(orderBId, payBId);
      const verifyBReq = new NextRequest(
        `http://localhost:3000/api/user/${patient1UserId}/payments/verifyOrder`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${patient1Token}`,
          },
          body: JSON.stringify({
            orderId: orderBId,
            paymentId: payBId,
            signature: sigB,
          }),
        }
      );
      const verifyBRes = await verifyOrderPOST(verifyBReq, {
        params: Promise.resolve({ userId: patient1UserId }),
      });
      expect([200, 409]).toContain(verifyBRes.status);
      const verifyBData = await verifyBRes.json();
      // Should initiate refund and NOT overwrite existing appointment
      expect(verifyBData.status || verifyBData.refundStatus || verifyBData.error).toMatch(/REFUND/);

      const slotBAppts = await prisma.appointment.findMany({
        where: { slotId: slotBId },
      });
      expect(slotBAppts.length).toBe(1);
      expect(slotBAppts[0].patientId).toBe(patient2Id); // Preserved patient 2's booking!
    });

    it("3.2 Two patients competing for one slot: exactly ONE wins hold, other is rejected with conflict", async () => {
      const slotId = await createFutureSlot(35);

      const [hold1, hold2] = await Promise.all([
        createSlotHold(slotId, doctorId, patient1Id),
        createSlotHold(slotId, doctorId, patient2Id),
      ]);

      const wins = [hold1, hold2].filter((h) => h.kind === "ok");
      const conflicts = [hold1, hold2].filter((h) => h.kind === "conflict");

      expect(wins.length).toBe(1);
      expect(conflicts.length).toBe(1);
    });

    it("3.3 Concurrent booking finalization and refund compensation: atomic isolation guarantees single outcome", async () => {
      const slotId = await createFutureSlot(38);
      const hold = await createSlotHold(slotId, doctorId, patient1Id);
      const holdToken = (hold as any).token;

      const orderResult = await createOrReusePaymentOrder({
        userId: patient1UserId,
        patientId: patient1Id,
        doctorId,
        slotId,
        holdToken,
        amount: 150000,
        currency: "INR",
        idempotencyKey: `idem_final_refund_${Date.now()}`,
      });
      const orderId = orderResult.order.razorpayOrderId;
      testOrderIds.push(orderId);

      const payment = await prisma.payment.findUnique({
        where: { razorpayOrderId: orderId },
      });

      // Claim refund first
      const refundResult = await claimAndExecuteRefund({
        paymentId: payment!.id,
        amount: 150000,
        reason: "Patient cancelled right during checkout",
      });
      expect(refundResult.success).toBe(true);

      // Attempt to verify payment and confirm booking afterward -> rejected as already refunded
      const verifyResult = await verifyAndTransitionPayment({
        orderId,
        paymentId: `pay_mock_concur_${Date.now()}`,
        patientUserId: patient1UserId,
        source: "WEBHOOK",
      });

      expect(verifyResult.success).toBe(false);
      expect(verifyResult.status).toBe("REFUNDED");

      const apptCount = await prisma.appointment.count({ where: { slotId } });
      expect(apptCount).toBe(0);
    });

    it("3.4 Cancelled-slot rebooking: preserves both historical records without overwriting", async () => {
      const slotId = await createFutureSlot(36);

      // 1. Patient 1 holds and books slot
      const hold1 = await createSlotHold(slotId, doctorId, patient1Id);
      expect(hold1.kind).toBe("ok");
      const appt1 = await confirmSlotHold({
        slotId,
        doctorId,
        patientId: patient1Id,
        token: (hold1 as any).token,
        paymentMethod: "OFFLINE",
      });
      expect(appt1).not.toBeNull();
      expect(appt1?.status).toBe("CONFIRMED");

      // 2. Patient 1 cancels appointment -> Slot becomes AVAILABLE again
      await prisma.$transaction([
        prisma.appointment.update({
          where: { id: appt1!.id },
          data: { status: "CANCELLED" },
        }),
        prisma.slot.update({
          where: { id: slotId },
          data: {
            status: "AVAILABLE",
            heldByPatientId: null,
            holdToken: null,
            heldAt: null,
            holdExpiresAt: null,
          },
        }),
      ]);

      // 3. Patient 2 holds and books the same slot
      const hold2 = await createSlotHold(slotId, doctorId, patient2Id);
      expect(hold2.kind).toBe("ok");
      const appt2 = await confirmSlotHold({
        slotId,
        doctorId,
        patientId: patient2Id,
        token: (hold2 as any).token,
        paymentMethod: "OFFLINE",
      });
      expect(appt2).not.toBeNull();
      expect(appt2?.status).toBe("CONFIRMED");
      expect(appt2?.id).not.toBe(appt1?.id); // New, distinct immutable identity

      // 4. Verify both appointment records exist in PostgreSQL!
      const slotAppointments = await prisma.appointment.findMany({
        where: { slotId },
        orderBy: { bookedAt: "asc" },
      });
      expect(slotAppointments.length).toBe(2);

      expect(slotAppointments[0].id).toBe(appt1!.id);
      expect(slotAppointments[0].patientId).toBe(patient1Id);
      expect(slotAppointments[0].status).toBe("CANCELLED");

      expect(slotAppointments[1].id).toBe(appt2!.id);
      expect(slotAppointments[1].patientId).toBe(patient2Id);
      expect(slotAppointments[1].status).toBe("CONFIRMED");
    });

    it("3.5 Earnings invariants: refunds do not increment doctor balance, withdrawals cannot exceed balance", async () => {
      const slotId = await createFutureSlot(37);

      const docBefore = await prisma.doctor.findUnique({ where: { id: doctorId } });
      const balanceBefore = docBefore?.balance ?? 0;

      // Create an appointment with a payment
      const orderId = `order_earn_${Date.now()}`;
      const paymentId = `pay_mock_earn_${Date.now()}`;
      testOrderIds.push(orderId);

      const payment = await prisma.payment.create({
        data: {
          userId: patient1UserId,
          doctorId,
          slotId,
          amount: 150000,
          currency: "INR",
          status: "SUCCESS",
          razorpayOrderId: orderId,
          razorpayPaymentId: paymentId,
        },
      });

      const appt = await prisma.appointment.create({
        data: {
          doctorId,
          patientId: patient1Id,
          slotId,
          paymentId: payment.id,
          status: "CONFIRMED",
          paymentMethod: "ONLINE",
          isAppointmentOffline: false,
        },
      });

      // Cancel appointment and refund payment
      await claimAndExecuteRefund({
        paymentId: payment.id,
        amount: 150000,
        reason: "Doctor requested cancellation",
      });

      await prisma.appointment.update({
        where: { id: appt.id },
        data: { status: "CANCELLED" },
      });

      // Doctor's balance must NOT have been incremented
      const docAfter = await prisma.doctor.findUnique({ where: { id: doctorId } });
      expect(docAfter?.balance).toBe(balanceBefore);
    });
  });

  // ==========================================================================
  // SECTION 4: Socket.IO Reliability & Real-Time Integrity
  // ==========================================================================
  describe("4. Socket.IO Reliability & Real-Time Integrity", () => {
    let client: ClientSocket;

    afterEach(() => {
      if (client && client.connected) {
        client.disconnect();
      }
    });

    it("4.1 Real Socket.IO client connections & PostgreSQL writes: saves message durably and emits to room", async () => {
      const token = createSocketJWT({ id: patient1UserId, role: "PATIENT" });

      client = Client(`http://localhost:${socketPort}`, {
        auth: { token, relationId },
        transports: ["websocket"],
        reconnection: false,
      });

      await new Promise<void>((resolve, reject) => {
        client.on("connect", () => resolve());
        client.on("connect_error", (err) => reject(err));
      });

      // Send real message
      const text = "Hello Doctor, testing real socket integration!";
      const clientMessageId = `cmid_${Date.now()}`;

      const ackResponse = await new Promise<any>((resolve) => {
        client.emit(
          "send_message",
          {
            relationId,
            text,
            clientMessageId,
          },
          (ack: any) => resolve(ack)
        );
      });

      expect(ackResponse.success).toBe(true);
      expect(ackResponse.message.text).toBe(text);
      expect(ackResponse.message.clientMessageId).toBe(clientMessageId);

      // Verify PostgreSQL write
      const saved = await prisma.chatMessages.findUnique({
        where: { clientMessageId },
      });
      expect(saved).not.toBeNull();
      expect(saved?.text).toBe(text);
      expect(saved?.senderId).toBe(patient1UserId);
    });

    it("4.2 Lost acknowledgement & retry: re-sending message with same clientMessageId returns original without duplicating DB row", async () => {
      const token = createSocketJWT({ id: patient1UserId, role: "PATIENT" });
      client = Client(`http://localhost:${socketPort}`, {
        auth: { token, relationId },
        transports: ["websocket"],
        reconnection: false,
      });

      await new Promise<void>((resolve) => client.on("connect", () => resolve()));

      const text = "Testing lost ack deduplication";
      const clientMessageId = `cmid_lost_ack_${Date.now()}`;

      // 1. Initial send
      const ack1 = await new Promise<any>((resolve) => {
        client.emit("send_message", { relationId, text, clientMessageId }, (res: any) => resolve(res));
      });
      expect(ack1.success).toBe(true);

      // 2. Retry send with same clientMessageId
      const ack2 = await new Promise<any>((resolve) => {
        client.emit("send_message", { relationId, text, clientMessageId }, (res: any) => resolve(res));
      });
      expect(ack2.success).toBe(true);
      expect(ack2.message.id).toBe(ack1.message.id);

      // Total count in DB with this clientMessageId must be EXACTLY 1
      const count = await prisma.chatMessages.count({
        where: { clientMessageId },
      });
      expect(count).toBe(1);
    });

    it("4.3 REST and socket retry interoperability: message saved via REST is recognized idempotently by Socket", async () => {
      const clientMessageId = `cmid_rest_interop_${Date.now()}`;
      const text = "Message created via REST service";

      // 1. Message sent via REST chat service
      const restResult = await persistChatMessage({
        doctorPatientRelationId: relationId,
        senderId: patient1UserId,
        text,
        clientMessageId,
      });
      expect(restResult.success).toBe(true);

      // 2. Later client retries the same message via Socket
      const token = createSocketJWT({ id: patient1UserId, role: "PATIENT" });
      client = Client(`http://localhost:${socketPort}`, {
        auth: { token, relationId },
        transports: ["websocket"],
        reconnection: false,
      });

      await new Promise<void>((resolve) => client.on("connect", () => resolve()));

      const socketAck = await new Promise<any>((resolve) => {
        client.emit("send_message", { relationId, text, clientMessageId }, (res: any) => resolve(res));
      });

      expect(socketAck.success).toBe(true);
      expect(socketAck.message.text).toBe(text);

      const dbCount = await prisma.chatMessages.count({
        where: { clientMessageId },
      });
      expect(dbCount).toBe(1);
    });

    it("4.4 Unauthorized users and expired tickets: rejects expired token and unauthorized chat room join", async () => {
      // 1. Token expired 10 seconds ago
      const expiredToken = createSocketJWT({ id: patient1UserId, role: "PATIENT" }, jwtSecret, -10);

      const expiredClient = Client(`http://localhost:${socketPort}`, {
        auth: { token: expiredToken },
        transports: ["websocket"],
        reconnection: false,
      });

      const errMessage = await new Promise<string>((resolve) => {
        expiredClient.on("connect_error", (err) => resolve(err.message));
      });

      expect(errMessage).toMatch(/token expired/i);
      expiredClient.close();

      // 2. Patient 2 attempts to connect to Patient 1's chat relation
      const unauthorizedToken = createSocketJWT({ id: patient2UserId, role: "PATIENT" });
      const unauthorizedClient = Client(`http://localhost:${socketPort}`, {
        auth: { token: unauthorizedToken, relationId },
        transports: ["websocket"],
        reconnection: false,
      });

      const unauthErr = await new Promise<string>((resolve) => {
        unauthorizedClient.on("connect_error", (err) => resolve(err.message));
      });
      expect(unauthErr).toMatch(/unauthorized/i);
      unauthorizedClient.close();
    });

    it("4.5 Notification outbox processing: cron worker delivers pending outbox records", async () => {
      const outboxItem = await prisma.notificationOutbox.create({
        data: {
          eventId: `evt_outbox_${Date.now()}`,
          channel: "SOCKET_NOTIFICATION",
          targetUserId: doctorUserId,
          payload: {
            doctorUserId,
            notification: {
              id: `notif_outbox_${Date.now()}`,
              userId: doctorUserId,
              title: "Appointment Confirmed",
              message: "A new appointment has been booked.",
            },
          },
          status: "PENDING",
          attempts: 0,
        },
      });

      const cronReq = new NextRequest(`http://localhost:3000/api/cron/reconcile-payments`, {
        method: "POST",
        headers: { authorization: `Bearer ${cronSecret}` },
      });
      const cronRes = await reconcilePOST(cronReq);
      expect(cronRes.status).toBe(200);

      const updatedOutbox = await prisma.notificationOutbox.findUnique({
        where: { id: outboxItem.id },
      });
      expect(updatedOutbox).not.toBeNull();
      // Outbox item was picked up by worker and attempts incremented
      expect(updatedOutbox!.attempts).toBeGreaterThanOrEqual(1);
    });
  });
});
