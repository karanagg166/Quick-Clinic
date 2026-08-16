import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import crypto from "crypto";

const mockRazorpayCreate = vi.fn();
const mockPrismaDoctorFindUnique = vi.fn();
const mockPrismaSlotFindFirst = vi.fn();
const mockPrismaPaymentCreate = vi.fn();
const mockPrismaPaymentFindUnique = vi.fn();
const mockPrismaPaymentUpdate = vi.fn();
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
      update: (...args: any[]) => mockPrismaPaymentUpdate(...args),
    },
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
      RAZORPAY_KEY_ID: "rzp_test_key_123",
      RAZORPAY_KEY_SECRET: "rzp_test_secret_456",
    };
    mockGetAuthenticatedPatient.mockResolvedValue({ id: "pat_1", userId: "user_1" });
    mockValidateSlotHold.mockResolvedValue(true);
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

    it("returns 500 when Razorpay credentials are missing in env", async () => {
      delete process.env.RAZORPAY_KEY_ID;
      mockGetAuthenticatedPatient.mockResolvedValue({ id: "pat_1", userId: "user_1" });

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
      mockPrismaSlotFindFirst.mockResolvedValue({ id: "slot_1" });

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
      mockPrismaSlotFindFirst.mockResolvedValue({ id: "slot_1" });

      const mockRazorpayOrder = {
        id: "order_rzp_999",
        amount: 50000,
        currency: "INR",
        status: "created",
      };
      mockRazorpayCreate.mockResolvedValue(mockRazorpayOrder);

      const mockSavedPayment = {
        id: "pay_db_1",
        userId: "user_1",
        amount: 50000,
        currency: "INR",
        status: "created",
        razorpayOrderId: "order_rzp_999",
      };
      mockPrismaPaymentCreate.mockResolvedValue(mockSavedPayment);

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
      expect(data.keyId).toBe("rzp_test_key_123");
      expect(data.order).toEqual(mockSavedPayment);
      expect(mockRazorpayCreate).toHaveBeenCalledWith(expect.objectContaining({
        amount: 50000,
        currency: "INR",
      }));
      expect(mockPrismaPaymentCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: "user_1",
          doctorId: "doc_1",
          slotId: "slot_1",
          holdToken,
          amount: 50000,
        }),
      });
    });
  });

  describe("POST /api/user/[userId]/payments/verifyOrder", () => {
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

    it("rejects invalid signature", async () => {
      const req = new NextRequest("http://localhost:3000/api/user/user_1/payments/verifyOrder", {
        method: "POST",
        body: JSON.stringify({
          orderId: "order_123",
          paymentId: "pay_123",
          signature: "0".repeat(64),
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
      const orderId = "order_123";
      const paymentId = "pay_123";
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
        userId: "user_1",
        status: "created",
        razorpayPaymentId: null,
        doctorId: "doc_1",
        slotId: "slot_1",
        holdToken,
      });
      mockPrismaPaymentUpdate.mockResolvedValue({
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
      expect(mockPrismaPaymentUpdate).toHaveBeenCalledWith({
        where: { razorpayOrderId: orderId },
        data: {
          status: "SUCCESS",
          razorpayPaymentId: paymentId,
        },
      });
      expect(mockFinalizeAppointmentBooking).toHaveBeenCalledWith({
        slotId: "slot_1",
        doctorId: "doc_1",
        patientId: "pat_1",
        patientUserId: "user_1",
        holdToken,
        paymentMethod: "ONLINE",
        transactionId: paymentId,
      });
    });

    it("returns 409 but keeps the verified payment recoverable when booking finalization fails", async () => {
      const orderId = "order_rzp_recover";
      const paymentId = "pay_rzp_recover";
      const signature = crypto
        .createHmac("sha256", "rzp_test_secret_456")
        .update(`${orderId}|${paymentId}`)
        .digest("hex");
      mockPrismaPaymentFindUnique.mockResolvedValue({
        userId: "user_1",
        status: "created",
        razorpayPaymentId: null,
        doctorId: "doc_1",
        slotId: "slot_1",
        holdToken,
      });
      mockFinalizeAppointmentBooking.mockResolvedValue(null);

      const response = await verifyOrderPOST(new NextRequest(
        "http://localhost:3000/api/user/user_1/payments/verifyOrder",
        {
          method: "POST",
          body: JSON.stringify({ orderId, paymentId, signature }),
        }
      ), { params: Promise.resolve({ userId: "user_1" }) });

      expect(response.status).toBe(409);
      expect(mockPrismaPaymentUpdate).toHaveBeenCalledWith({
        where: { razorpayOrderId: orderId },
        data: { status: "SUCCESS", razorpayPaymentId: paymentId },
      });
    });
  });
});
