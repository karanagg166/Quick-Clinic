// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { processOnlinePayment } from "@/lib/processOnlinePayment";

describe("processOnlinePayment Frontend Helper", () => {
  const originalFetch = global.fetch;
  const holdToken = "123e4567-e89b-12d3-a456-426614174000";

  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = "";
    delete (window as any).Razorpay;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("fails when createOrder API returns an error", async () => {
    // Mock existing script so loadRazorpayScript succeeds immediately
    (window as any).Razorpay = vi.fn();

    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ message: "Slot hold expired" }),
    });

    const result = await processOnlinePayment({
      doctorId: "doc_1",
      holdToken,
      slotId: "slot_1",
      userId: "user_1",
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("Slot hold expired");
    expect(result.transactionId).toBeNull();
  });

  it("successfully opens Razorpay modal, calls verifyOrder, and resolves with transactionId", async () => {
    let razorpayOptionsPassed: any = null;
    const mockOpen = vi.fn();
    const mockOn = vi.fn();

    (window as any).Razorpay = vi.fn().mockImplementation((options: any) => {
      razorpayOptionsPassed = options;
      return {
        open: mockOpen,
        on: mockOn,
      };
    });

    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          keyId: "rzp_test_key_123",
          order: {
            amount: 50000,
            currency: "INR",
            razorpayOrderId: "order_rzp_123",
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          message: "Order verified successfully",
          transactionId: "pay_rzp_999",
          appointment: { id: "appointment_1", status: "CONFIRMED" },
        }),
      });

    const paymentPromise = processOnlinePayment({
      doctorId: "doc_1",
      holdToken,
      slotId: "slot_1",
      userId: "user_1",
      userEmail: "patient@gmail.com",
      userName: "Karan",
      userPhone: "+91 9876543210",
    });

    // Allow promise tick to reach Razorpay initialization
    await new Promise((r) => setTimeout(r, 10));

    expect(mockOpen).toHaveBeenCalled();
    expect(razorpayOptionsPassed).toBeDefined();
    expect(razorpayOptionsPassed.key).toBe("rzp_test_key_123");
    expect(razorpayOptionsPassed.order_id).toBe("order_rzp_123");
    expect(razorpayOptionsPassed.prefill).toEqual({
      name: "Karan",
      email: "patient@gmail.com",
      contact: "9876543210",
    });

    // Simulate successful payment callback from Razorpay
    await razorpayOptionsPassed.handler({
      razorpay_order_id: "order_rzp_123",
      razorpay_payment_id: "pay_rzp_999",
      razorpay_signature: "valid_signature_abc",
    });

    const result = await paymentPromise;
    expect(result.success).toBe(true);
    expect(result.transactionId).toBe("pay_rzp_999");
    expect(result.appointmentId).toBe("appointment_1");
    expect(result.paymentCaptured).toBe(true);
  });

  it("returns the captured payment ID when server-side booking finalization fails", async () => {
    let razorpayOptionsPassed: any = null;
    (window as any).Razorpay = vi.fn().mockImplementation((options: any) => {
      razorpayOptionsPassed = options;
      return { open: vi.fn(), on: vi.fn() };
    });
    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          keyId: "rzp_test_key_123",
          order: { razorpayOrderId: "order_rzp_123", currency: "INR" },
        }),
      })
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: "Appointment could not be finalized" }),
      });

    const paymentPromise = processOnlinePayment({
      doctorId: "doc_1",
      holdToken,
      slotId: "slot_1",
      userId: "user_1",
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    await razorpayOptionsPassed.handler({
      razorpay_order_id: "order_rzp_123",
      razorpay_payment_id: "pay_rzp_captured",
      razorpay_signature: "a".repeat(64),
    });

    const result = await paymentPromise;
    expect(result).toMatchObject({
      success: false,
      transactionId: "pay_rzp_captured",
      paymentCaptured: true,
    });
    expect(result.error).toContain("Payment was captured");
  });

  it("handles payment.failed event from Razorpay", async () => {
    let failureCallback: any = null;
    const mockOpen = vi.fn();
    const mockOn = vi.fn().mockImplementation((event: string, callback: any) => {
      if (event === "payment.failed") {
        failureCallback = callback;
      }
    });

    (window as any).Razorpay = vi.fn().mockImplementation(() => ({
      open: mockOpen,
      on: mockOn,
    }));

    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        keyId: "rzp_test_key_123",
        order: { amount: 50000, currency: "INR", razorpayOrderId: "order_rzp_123" },
      }),
    });

    const paymentPromise = processOnlinePayment({
      doctorId: "doc_1",
      holdToken,
      slotId: "slot_1",
      userId: "user_1",
    });

    await new Promise((r) => setTimeout(r, 10));

    expect(failureCallback).toBeDefined();
    failureCallback({
      error: {
        description: "Payment declined by issuing bank",
      },
    });

    const result = await paymentPromise;
    expect(result.success).toBe(false);
    expect(result.error).toBe("Payment declined by issuing bank");
    expect(result.transactionId).toBeNull();
  });

  it("handles user dismissing/closing payment modal", async () => {
    let razorpayOptionsPassed: any = null;
    (window as any).Razorpay = vi.fn().mockImplementation((options: any) => {
      razorpayOptionsPassed = options;
      return {
        open: vi.fn(),
        on: vi.fn(),
      };
    });

    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        keyId: "rzp_test_key_123",
        order: { amount: 50000, currency: "INR", razorpayOrderId: "order_rzp_123" },
      }),
    });

    const paymentPromise = processOnlinePayment({
      doctorId: "doc_1",
      holdToken,
      slotId: "slot_1",
      userId: "user_1",
    });

    await new Promise((r) => setTimeout(r, 10));

    // Simulate modal close
    razorpayOptionsPassed.modal.ondismiss();

    const result = await paymentPromise;
    expect(result.success).toBe(false);
    expect(result.error).toBe("Payment was cancelled.");
    expect(result.transactionId).toBeNull();
  });
});
