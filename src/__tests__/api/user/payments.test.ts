import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import crypto from "crypto";

const mockRazorpayCreate = vi.fn();
const mockPrismaDoctorFindUnique = vi.fn();
const mockPrismaSlotFindFirst = vi.fn();
const mockPrismaPaymentCreate = vi.fn();
const mockPrismaPaymentFindUnique = vi.fn();
const mockPrismaPaymentFindFirst = vi.fn();
const mockPrismaPaymentUpdate = vi.fn();
const mockPrismaRefundCreate = vi.fn();
const mockPrismaRefundFindUnique = vi.fn();
const mockPrismaRefundUpdate = vi.fn();
const mockPrismaPatientFindUnique = vi.fn();
const mockPrismaAppointmentFindFirst = vi.fn();
const mockGetAuthenticatedPatient = vi.fn();
const mockValidateSlotHold = vi.fn();
const mockFinalizeAppointmentBooking = vi.fn();

vi.mock("razorpay", () => {
  return {
    default: class MockRazorpay {
      orders = {
        create: mockRazorpayCreate,
      };
    },
  };
});

vi.mock("@/lib/prisma", () => ({
  prisma: {
    doctor: {
      findUnique: (...args: any[]) => mockPrismaDoctorFindUnique(...args),
    },
    slot: {
      findFirst: (...args: any[]) => mockPrismaSlotFindFirst(...args),
    },
    payment: {
      create: (...args: any[]) => mockPrismaPaymentCreate(...args),
      findUnique: (...args: any[]) => mockPrismaPaymentFindUnique(...args),
      findFirst: (...args: any[]) => mockPrismaPaymentFindFirst(...args),
      update: (...args: any[]) => mockPrismaPaymentUpdate(...args),
      updateMany: (...args: any[]) => {
        mockPrismaPaymentUpdate(...args);
        return Promise.resolve({ count: 1 });
      },
    },
    refund: {
      create: (...args: any[]) => mockPrismaRefundCreate(...args),
      findUnique: (...args: any[]) => mockPrismaRefundFindUnique(...args),
      update: (...args: any[]) => mockPrismaRefundUpdate(...args),
    },
    patient: {
      findUnique: (...args: any[]) => mockPrismaPatientFindUnique(...args),
    },
    appointment: {
      findFirst: (...args: any[]) => mockPrismaAppointmentFindFirst(...args),
    },
    $transaction: (arg: any) => (typeof arg === "function" ? arg({
      refund: { update: mockPrismaRefundUpdate },
      payment: { update: mockPrismaPaymentUpdate },
    }) : Promise.all(arg)),
  },
}));

vi.mock("@/lib/request-auth", () => ({
  getAuthenticatedPatient: (...args: any[]) => mockGetAuthenticatedPatient(...args),
}));
vi.mock("@/lib/booking", () => ({
  validateSlotHold: (...args: unknown[]) => mockValidateSlotHold(...args),
}));
vi.mock("@/lib/appointment-confirmation", () => ({
  finalizeAppointmentBooking: (...args: unknown[]) => mockFinalizeAppointmentBooking(...args),
}));

import { POST as createOrderPOST } from "@/app/api/user/[userId]/payments/createOrder/route";
import { POST as verifyOrderPOST } from "@/app/api/user/[userId]/payments/verifyOrder/route";

describe("Payment API Endpoints", () => {
  const originalEnv = process.env;
  const holdToken = "123e4567-e89b-12d3-a456-426614174000";

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = {
      ...originalEnv,
      RAZORPAY_KEY_ID: "rzp_test_dummy_key_123",
      RAZORPAY_KEY_SECRET: "rzp_test_secret_456",
    };
    mockGetAuthenticatedPatient.mockResolvedValue({ id: "pat_1", userId: "user_1" });
    mockValidateSlotHold.mockResolvedValue(true);
    mockPrismaPaymentFindUnique.mockResolvedValue(null);
    mockPrismaPaymentFindFirst.mockResolvedValue(null);
    mockPrismaPatientFindUnique.mockResolvedValue({ id: "pat_1", userId: "user_1" });
    mockPrismaAppointmentFindFirst.mockResolvedValue(null);
    mockPrismaRefundFindUnique.mockResolvedValue(null);
  });

  describe("POST /api/user/[userId]/payments/createOrder", () => {
    it("rejects request when doctorId or slotId are missing", async () => {
      const req = new NextRequest("http://localhost:3000/api/user/user_1/payments/createOrder", {
        method: "POST",
        body: JSON.stringify({ doctorId: "doc_1" }),
      });

      const res = await createOrderPOST(req, {
        params: Promise.resolve({ userId: "user_1" }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.message).toBe("doctorId, slotId, and a valid holdToken are required");
    });

    it("rejects unauthenticated request or userId mismatch", async () => {
      mockGetAuthenticatedPatient.mockResolvedValue(null);

      const req = new NextRequest("http://localhost:3000/api/user/user_1/payments/createOrder", {
        method: "POST",
        body: JSON.stringify({ doctorId: "doc_1", slotId: "slot_1", holdToken }),
      });

      const res = await createOrderPOST(req, {
        params: Promise.resolve({ userId: "user_1" }),
      });

      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.message).toBe("Authentication required");
    });

    it("rejects when hold token is not a valid UUID format", async () => {
      const req = new NextRequest("http://localhost:3000/api/user/user_1/payments/createOrder", {
        method: "POST",
        body: JSON.stringify({ doctorId: "doc_1", slotId: "slot_1", holdToken: "not-a-uuid" }),
      });

      const res = await createOrderPOST(req, {
        params: Promise.resolve({ userId: "user_1" }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.message).toBe("doctorId, slotId, and a valid holdToken are required");
    });

    it("returns 500 when Razorpay credentials are missing in env", async () => {
      delete process.env.RAZORPAY_KEY_ID;
      delete process.env.RAZORPAY_KEY_SECRET;

      const req = new NextRequest("http://localhost:3000/api/user/user_1/payments/createOrder", {
        method: "POST",
        body: JSON.stringify({ doctorId: "doc_1", slotId: "slot_1", holdToken }),
      });

      const res = await createOrderPOST(req, {
        params: Promise.resolve({ userId: "user_1" }),
      });

      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data.message).toBe("Razorpay credentials missing");
    });

    it("returns 409 when slot hold is expired or not held by patient", async () => {
      mockGetAuthenticatedPatient.mockResolvedValue({ id: "pat_1", userId: "user_1" });
      mockPrismaDoctorFindUnique.mockResolvedValue({ fees: 500 });
      mockPrismaSlotFindFirst.mockResolvedValue(null);

      const req = new NextRequest("http://localhost:3000/api/user/user_1/payments/createOrder", {
        method: "POST",
        body: JSON.stringify({ doctorId: "doc_1", slotId: "slot_1", holdToken }),
      });

      const res = await createOrderPOST(req, {
        params: Promise.resolve({ userId: "user_1" }),
      });

      expect(res.status).toBe(409);
      const data = await res.json();
      expect(data.message).toContain("expired");
    });

    it("returns 400 when doctor fee is invalid (< 100 paise / 1 INR)", async () => {
      mockGetAuthenticatedPatient.mockResolvedValue({ id: "pat_1", userId: "user_1" });
      mockPrismaDoctorFindUnique.mockResolvedValue({ fees: 0 });
      mockPrismaSlotFindFirst.mockResolvedValue({ id: "slot_1", startTime: new Date(Date.now() + 3600000) });

      const req = new NextRequest("http://localhost:3000/api/user/user_1/payments/createOrder", {
        method: "POST",
        body: JSON.stringify({ doctorId: "doc_1", slotId: "slot_1", holdToken }),
      });

      const res = await createOrderPOST(req, {
        params: Promise.resolve({ userId: "user_1" }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.message).toContain("valid consultation fee");
    });

    it("successfully creates Razorpay order and saves payment record in DB", async () => {
      mockGetAuthenticatedPatient.mockResolvedValue({ id: "pat_1", userId: "user_1" });
      mockPrismaDoctorFindUnique.mockResolvedValue({ fees: 500 });
      mockPrismaSlotFindFirst.mockResolvedValue({ id: "slot_1", startTime: new Date(Date.now() + 3600000) });

      mockPrismaPaymentCreate.mockImplementation(async ({ data }: any) => ({
        id: "payment_1",
        ...data,
      }));

      const req = new NextRequest("http://localhost:3000/api/user/user_1/payments/createOrder", {
        method: "POST",
        body: JSON.stringify({ doctorId: "doc_1", slotId: "slot_1", holdToken }),
      });

      const res = await createOrderPOST(req, {
        params: Promise.resolve({ userId: "user_1" }),
      });

      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.keyId).toBe("rzp_test_dummy_key_123");
      expect(mockPrismaPaymentCreate).toHaveBeenCalled();
    });
  });

  describe("POST /api/user/[userId]/payments/verifyOrder", () => {
    it("rejects unauthenticated request or userId mismatch", async () => {
      mockGetAuthenticatedPatient.mockResolvedValue(null);

      const req = new NextRequest("http://localhost:3000/api/user/user_1/payments/verifyOrder", {
        method: "POST",
        body: JSON.stringify({
          orderId: "order_123",
          paymentId: "pay_123",
          signature: "a".repeat(64),
        }),
      });

      const res = await verifyOrderPOST(req, {
        params: Promise.resolve({ userId: "user_1" }),
      });

      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.error).toBe("Authentication required");
    });

    it("rejects missing payment details", async () => {
      const req = new NextRequest("http://localhost:3000/api/user/user_1/payments/verifyOrder", {
        method: "POST",
        body: JSON.stringify({ orderId: "order_123" }),
      });

      const res = await verifyOrderPOST(req, {
        params: Promise.resolve({ userId: "user_1" }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe("Missing required payment details");
    });

    it("rejects invalid signature format (not 64-char hex)", async () => {
      const req = new NextRequest("http://localhost:3000/api/user/user_1/payments/verifyOrder", {
        method: "POST",
        body: JSON.stringify({
          orderId: "order_123",
          paymentId: "pay_123",
          signature: "invalid-signature",
        }),
      });

      const res = await verifyOrderPOST(req, {
        params: Promise.resolve({ userId: "user_1" }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe("Missing required payment details");
    });

    it("rejects invalid signature", async () => {
      const req = new NextRequest("http://localhost:3000/api/user/user_1/payments/verifyOrder", {
        method: "POST",
        body: JSON.stringify({
          orderId: "order_123",
          paymentId: "pay_123",
          signature: "b".repeat(64),
        }),
      });

      const res = await verifyOrderPOST(req, {
        params: Promise.resolve({ userId: "user_1" }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe("Invalid signature");
    });

    it("returns 404 when payment order is not found or belongs to another user", async () => {
      const orderId = "order_rzp_999";
      const paymentId = "pay_rzp_888";
      const validSignature = crypto
        .createHmac("sha256", "rzp_test_secret_456")
        .update(`${orderId}|${paymentId}`)
        .digest("hex");

      mockPrismaPaymentFindUnique.mockResolvedValue(null);

      const req = new NextRequest("http://localhost:3000/api/user/user_1/payments/verifyOrder", {
        method: "POST",
        body: JSON.stringify({
          orderId,
          paymentId,
          signature: validSignature,
        }),
      });

      const res = await verifyOrderPOST(req, {
        params: Promise.resolve({ userId: "user_1" }),
      });

      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error).toBe("Payment order not found");
    });

    it("successfully verifies valid signature and updates payment status in database", async () => {
      const orderId = "order_rzp_999";
      const paymentId = "pay_rzp_888";
      const validSignature = crypto
        .createHmac("sha256", "rzp_test_secret_456")
        .update(`${orderId}|${paymentId}`)
        .digest("hex");

      mockPrismaPaymentFindUnique.mockResolvedValue({
        id: "pay_db_1",
        userId: "user_1",
        status: "created",
        amount: 50000,
        currency: "INR",
        razorpayPaymentId: null,
        razorpayOrderId: orderId,
        doctorId: "doc_1",
        slotId: "slot_1",
        holdToken,
        refunds: [],
      });
      mockPrismaPaymentUpdate.mockResolvedValue({
        id: "pay_db_1",
        razorpayOrderId: orderId,
        status: "SUCCESS",
        razorpayPaymentId: paymentId,
      });
      mockFinalizeAppointmentBooking.mockResolvedValue({
        id: "appointment_1",
        status: "CONFIRMED",
      });

      const req = new NextRequest("http://localhost:3000/api/user/user_1/payments/verifyOrder", {
        method: "POST",
        body: JSON.stringify({
          orderId,
          paymentId,
          signature: validSignature,
        }),
      });

      const res = await verifyOrderPOST(req, {
        params: Promise.resolve({ userId: "user_1" }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.message).toBe("Payment verified and appointment confirmed");
      expect(data.transactionId).toBe(paymentId);
      expect(data.appointment.id).toBe("appointment_1");
      expect(mockPrismaPaymentUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: "SUCCESS",
            razorpayPaymentId: paymentId,
          }),
        })
      );
      expect(mockFinalizeAppointmentBooking).toHaveBeenCalledWith(
        expect.objectContaining({
          slotId: "slot_1",
          doctorId: "doc_1",
          patientId: "pat_1",
          patientUserId: "user_1",
          paymentMethod: "ONLINE",
        })
      );
    });

    it("returns 409 but keeps the verified payment recoverable when booking finalization fails", async () => {
      const orderId = "order_rzp_recover";
      const paymentId = "pay_rzp_recover";
      const signature = crypto
        .createHmac("sha256", "rzp_test_secret_456")
        .update(`${orderId}|${paymentId}`)
        .digest("hex");

      mockPrismaPaymentFindUnique.mockResolvedValue({
        id: "pay_db_recover",
        userId: "user_1",
        status: "created",
        amount: 50000,
        currency: "INR",
        razorpayPaymentId: null,
        razorpayOrderId: orderId,
        doctorId: "doc_1",
        slotId: "slot_1",
        holdToken,
        refunds: [],
      });
      mockFinalizeAppointmentBooking.mockResolvedValue(null);
      mockPrismaRefundCreate.mockResolvedValue({
        id: "refund_1",
        status: "PENDING",
      });

      const response = await verifyOrderPOST(new NextRequest(
        "http://localhost:3000/api/user/user_1/payments/verifyOrder",
        {
          method: "POST",
          body: JSON.stringify({ orderId, paymentId, signature }),
        }
      ), { params: Promise.resolve({ userId: "user_1" }) });

      expect(response.status).toBe(409);
      expect(mockPrismaPaymentUpdate).toHaveBeenCalled();
    });
  });
});
