import crypto from "crypto";
import { prisma } from "@/lib/prisma";

export interface RazorpayPaymentDetails {
  id: string;
  entity: string;
  amount: number;
  currency: string;
  status: "created" | "authorized" | "captured" | "refunded" | "failed";
  order_id: string | null;
  invoice_id: string | null;
  international: boolean;
  method: string;
  amount_refunded: number;
  refund_status: "null" | "partial" | "full" | null;
  captured: boolean;
  description?: string;
  card_id?: string;
  bank?: string;
  wallet?: string;
  vpa?: string;
  email?: string;
  contact?: string;
  notes?: Record<string, string>;
  fee?: number;
  tax?: number;
  error_code?: string;
  error_description?: string;
  created_at: number;
}

export interface RazorpayRefundDetails {
  id: string;
  entity: string;
  amount: number;
  currency: string;
  payment_id: string;
  notes?: Record<string, string>;
  receipt?: string;
  acquirer_data?: Record<string, any>;
  created_at: number;
  batch_id?: string;
  status: "pending" | "processed" | "failed";
  speed_processed?: string;
  speed_requested?: string;
}

export interface RazorpayOrderDetails {
  id: string;
  entity: string;
  amount: number;
  amount_paid: number;
  amount_due: number;
  currency: string;
  receipt: string | null;
  status: "created" | "attempted" | "paid";
  attempts: number;
  created_at: number;
  notes?: Record<string, string>;
}

function getRazorpayCredentials() {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;

  if (!keyId || !keySecret) {
    throw new Error("Razorpay credentials missing from environment (RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET)");
  }

  return { keyId, keySecret };
}

export function isMockTestKey(keyId: string): boolean {
  if (process.env.NODE_ENV === "production") {
    if (
      process.env.RAZORPAY_MOCK_TEST_MODE === "true" ||
      keyId.startsWith("rzp_test_dummy_") ||
      keyId.startsWith("rzp_test_mock_")
    ) {
      throw new Error("Forbidden synthetic Razorpay mock configuration detected in production environment");
    }
    return false;
  }

  const isTestRunner =
    process.env.NODE_ENV === "test" ||
    process.env.VITEST === "true" ||
    process.env.PLAYWRIGHT === "true";
  if (!isTestRunner) {
    // Outside test runner, genuine test-mode credentials must call genuine provider test environment.
    // Synthetic responses are strictly forbidden outside the test runner.
    return false;
  }

  // Inside test runner, allow synthetic fixture for test keys unless live network is explicitly enabled
  if (process.env.RAZORPAY_LIVE_NETWORK === "true") {
    return false;
  }

  return (
    process.env.RAZORPAY_MOCK_TEST_MODE === "true" ||
    keyId.startsWith("rzp_test_") ||
    keyId.startsWith("mock_") ||
    keyId === "test"
  );
}

function getAuthHeader(keyId: string, keySecret: string): string {
  return "Basic " + Buffer.from(`${keyId}:${keySecret}`).toString("base64");
}

const RAZORPAY_API_BASE = "https://api.razorpay.com/v1";

/**
 * Creates an order on Razorpay with an explicit timeout.
 */
export async function createRazorpayOrder(params: {
  amount: number;
  currency: string;
  receipt: string;
  notes?: Record<string, string>;
  timeoutMs?: number;
}): Promise<RazorpayOrderDetails> {
  const { keyId, keySecret } = getRazorpayCredentials();

  if (isMockTestKey(keyId)) {
    return {
      id: `order_mock_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      entity: "order",
      amount: Number(params.amount),
      amount_paid: 0,
      amount_due: Number(params.amount),
      currency: params.currency,
      receipt: params.receipt,
      status: "created",
      attempts: 0,
      created_at: Math.floor(Date.now() / 1000),
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), params.timeoutMs ?? 10000);

  try {
    const res = await fetch(`${RAZORPAY_API_BASE}/orders`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: getAuthHeader(keyId, keySecret),
      },
      body: JSON.stringify({
        amount: params.amount,
        currency: params.currency,
        receipt: params.receipt,
        notes: params.notes,
      }),
      signal: controller.signal,
    });

    const body = await res.json();
    if (!res.ok) {
      throw new Error(body?.error?.description || `Razorpay order creation failed with status ${res.status}`);
    }

    return body as RazorpayOrderDetails;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetches authoritative payment details directly from Razorpay.
 */
export async function fetchRazorpayPayment(
  paymentId: string,
  timeoutMs: number = 10000,
  expectedOrderId?: string
): Promise<RazorpayPaymentDetails> {
  const { keyId, keySecret } = getRazorpayCredentials();

  if (isMockTestKey(keyId)) {
    if (paymentId.includes("timeout")) {
      const err = new Error("Simulated provider timeout");
      (err as any).name = "AbortError";
      throw err;
    }

    const orderIdToReturn = expectedOrderId || "order_mock";
    let amountToReturn = 150000;
    let currencyToReturn = "INR";

    if (expectedOrderId) {
      const [storedPayment, storedCheckout] = await Promise.all([
        prisma.payment?.findUnique ? prisma.payment.findUnique({ where: { razorpayOrderId: expectedOrderId } }).catch(() => null) : null,
        prisma.checkout?.findUnique ? prisma.checkout.findUnique({ where: { razorpayOrderId: expectedOrderId } }).catch(() => null) : null,
      ]);
      if (storedPayment) {
        amountToReturn = storedPayment.amount;
        currencyToReturn = storedPayment.currency;
      } else if (storedCheckout) {
        amountToReturn = storedCheckout.amount;
        currencyToReturn = storedCheckout.currency;
      }
    }

    if (paymentId.includes("auth")) {
      return {
        id: paymentId,
        entity: "payment",
        amount: amountToReturn,
        currency: currencyToReturn,
        status: "authorized",
        order_id: expectedOrderId || "order_mock",
        invoice_id: null,
        international: false,
        method: "upi",
        amount_refunded: 0,
        refund_status: null,
        captured: false,
        created_at: Math.floor(Date.now() / 1000),
      };
    }

    if (paymentId.includes("fail")) {
      return {
        id: paymentId,
        entity: "payment",
        amount: amountToReturn,
        currency: currencyToReturn,
        status: "failed",
        order_id: expectedOrderId || "order_mock",
        invoice_id: null,
        international: false,
        method: "card",
        amount_refunded: 0,
        refund_status: null,
        captured: false,
        error_description: "Card was declined by bank",
        created_at: Math.floor(Date.now() / 1000),
      };
    }

    if (paymentId.includes("refund")) {
      return {
        id: paymentId,
        entity: "payment",
        amount: amountToReturn,
        currency: currencyToReturn,
        status: "refunded",
        order_id: expectedOrderId || "order_mock",
        invoice_id: null,
        international: false,
        method: "netbanking",
        amount_refunded: amountToReturn,
        refund_status: "full",
        captured: true,
        created_at: Math.floor(Date.now() / 1000),
      };
    }

    return {
      id: paymentId,
      entity: "payment",
      amount: paymentId.includes("wrongamt") ? 99999 : amountToReturn,
      currency: paymentId.includes("wrongcurr") ? "USD" : currencyToReturn,
      status: "captured",
      order_id: paymentId.includes("wrongorder") ? "order_wrong_mismatch" : orderIdToReturn,
      invoice_id: null,
      international: false,
      method: "card",
      amount_refunded: 0,
      refund_status: null,
      captured: true,
      created_at: Math.floor(Date.now() / 1000),
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${RAZORPAY_API_BASE}/payments/${encodeURIComponent(paymentId)}`, {
      method: "GET",
      headers: {
        Authorization: getAuthHeader(keyId, keySecret),
      },
      signal: controller.signal,
    });

    const body = await res.json();
    if (!res.ok) {
      throw new Error(body?.error?.description || `Razorpay fetch payment failed with status ${res.status}`);
    }

    return body as RazorpayPaymentDetails;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Creates a refund with standard Razorpay idempotency support via X-Refund-Idempotency header.
 */
export async function createRazorpayRefund(params: {
  paymentId: string;
  amount: number;
  idempotencyKey: string;
  notes?: Record<string, string>;
  receipt?: string;
  timeoutMs?: number;
}): Promise<RazorpayRefundDetails> {
  const { keyId, keySecret } = getRazorpayCredentials();

  if (isMockTestKey(keyId)) {
    if (params.paymentId.includes("refund_timeout")) {
      const err = new Error("Provider request timeout");
      (err as any).name = "AbortError";
      throw err;
    }

    if (params.paymentId.includes("refund_fail")) {
      throw new Error("Provider rejected refund: account balance insufficient");
    }

    try {
      const RazorpayMod = await import("razorpay");
      const RazorpayCtor = (RazorpayMod as any).default || RazorpayMod;
      if (typeof RazorpayCtor === "function") {
        const instance = new RazorpayCtor({
          key_id: keyId || "rzp_test_mock",
          key_secret: keySecret || "rzp_test_secret",
        });
        if (typeof instance?.payments?.refund === "function") {
          const sdkRes = await instance.payments.refund(params.paymentId, {
            amount: params.amount,
            notes: params.notes,
            receipt: params.receipt,
          });
          if (sdkRes?.id) {
            return {
              id: sdkRes.id,
              entity: "refund",
              amount: Number(sdkRes.amount || params.amount),
              currency: sdkRes.currency || "INR",
              payment_id: params.paymentId,
              status: sdkRes.status === "processed" ? "processed" : "pending",
              created_at: Math.floor(Date.now() / 1000),
            };
          }
        }
      }
    } catch {
      // Ignore SDK load failure in test environment
    }

    return {
      id: `rfnd_mock_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      entity: "refund",
      amount: Number(params.amount),
      currency: "INR",
      payment_id: params.paymentId,
      status: params.paymentId.includes("refund_pending") ? "pending" : "processed",
      created_at: Math.floor(Date.now() / 1000),
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), params.timeoutMs ?? 10000);

  try {
    const res = await fetch(
      `${RAZORPAY_API_BASE}/payments/${encodeURIComponent(params.paymentId)}/refund`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: getAuthHeader(keyId, keySecret),
          "X-Refund-Idempotency": params.idempotencyKey,
        },
        body: JSON.stringify({
          amount: params.amount,
          notes: params.notes,
          receipt: params.receipt,
        }),
        signal: controller.signal,
      }
    );

    const body = await res.json();
    if (!res.ok) {
      const desc = body?.error?.description || `Razorpay refund failed with status ${res.status}`;
      const err = new Error(desc) as Error & { code?: string; status?: number; data?: any };
      err.code = body?.error?.code;
      err.status = res.status;
      err.data = body;
      throw err;
    }

    return body as RazorpayRefundDetails;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetches refund details from Razorpay for reconciliation.
 */
export async function fetchRazorpayRefund(
  paymentId: string,
  refundId: string,
  timeoutMs: number = 10000
): Promise<RazorpayRefundDetails> {
  const { keyId, keySecret } = getRazorpayCredentials();

  if (isMockTestKey(keyId)) {
    return {
      id: refundId,
      entity: "refund",
      amount: 150000,
      currency: "INR",
      payment_id: paymentId,
      status: refundId.includes("fail") ? "failed" : "processed",
      created_at: Math.floor(Date.now() / 1000),
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(
      `${RAZORPAY_API_BASE}/payments/${encodeURIComponent(paymentId)}/refunds/${encodeURIComponent(refundId)}`,
      {
        method: "GET",
        headers: {
          Authorization: getAuthHeader(keyId, keySecret),
        },
        signal: controller.signal,
      }
    );

    const body = await res.json();
    if (!res.ok) {
      throw new Error(body?.error?.description || `Razorpay fetch refund failed with status ${res.status}`);
    }

    return body as RazorpayRefundDetails;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetches all payments associated with an order directly from Razorpay.
 * Used by reconciliation to discover captured payments for unconfirmed checkouts.
 */
export async function fetchRazorpayOrderPayments(
  orderId: string,
  timeoutMs: number = 10000
): Promise<RazorpayPaymentDetails[]> {
  const { keyId, keySecret } = getRazorpayCredentials();

  if (isMockTestKey(keyId)) {
    const stored = await prisma.payment.findUnique({
      where: { razorpayOrderId: orderId },
    }).catch(() => null);

    if (stored && stored.razorpayPaymentId) {
      return [
        {
          id: stored.razorpayPaymentId,
          entity: "payment",
          amount: stored.amount,
          currency: stored.currency,
          status: "captured",
          order_id: orderId,
          invoice_id: null,
          international: false,
          method: "card",
          amount_refunded: 0,
          refund_status: null,
          captured: true,
          created_at: Math.floor(Date.now() / 1000),
        },
      ];
    }

    if (orderId.includes("captured")) {
      return [
        {
          id: `pay_mock_captured_${orderId.slice(-8)}`,
          entity: "payment",
          amount: stored?.amount || 50000,
          currency: stored?.currency || "INR",
          status: "captured",
          order_id: orderId,
          invoice_id: null,
          international: false,
          method: "card",
          amount_refunded: 0,
          refund_status: null,
          captured: true,
          created_at: Math.floor(Date.now() / 1000),
        },
      ];
    }
    return [];
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${RAZORPAY_API_BASE}/orders/${encodeURIComponent(orderId)}/payments`, {
      method: "GET",
      headers: {
        Authorization: getAuthHeader(keyId, keySecret),
      },
      signal: controller.signal,
    });

    const body = await res.json();
    if (!res.ok) {
      throw new Error(body?.error?.description || `Razorpay fetch order payments failed with status ${res.status}`);
    }

    const items = Array.isArray(body?.items) ? body.items : [];
    return items as RazorpayPaymentDetails[];
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetches an order from Razorpay by receipt identity.
 * Used by reconciliation to recover orders created when response or local write was lost.
 */
export async function fetchRazorpayOrderByReceipt(
  receipt: string,
  timeoutMs: number = 10000
): Promise<RazorpayOrderDetails | null> {
  const { keyId, keySecret } = getRazorpayCredentials();

  if (isMockTestKey(keyId)) {
    if (receipt.includes("notfound")) {
      return null;
    }

    const chk = await prisma.checkout.findFirst({
      where: { providerReference: receipt },
    }).catch(() => null);

    if (chk) {
      return {
        id: chk.razorpayOrderId || `order_mock_rec_${chk.id.slice(-8)}`,
        entity: "order",
        amount: chk.amount,
        amount_paid: 0,
        amount_due: chk.amount,
        currency: chk.currency,
        receipt,
        status: "created",
        attempts: 0,
        created_at: Math.floor(Date.now() / 1000),
        notes: {
          checkoutId: chk.id,
          userId: chk.userId,
          doctorId: chk.doctorId,
          slotId: chk.slotId,
        },
      };
    }
    return null;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${RAZORPAY_API_BASE}/orders?receipt=${encodeURIComponent(receipt)}&count=1`, {
      method: "GET",
      headers: {
        Authorization: getAuthHeader(keyId, keySecret),
      },
      signal: controller.signal,
    });

    const body = await res.json();
    if (!res.ok) {
      throw new Error(body?.error?.description || `Razorpay fetch order by receipt failed with status ${res.status}`);
    }

    const items = Array.isArray(body?.items) ? body.items : [];
    return (items[0] as RazorpayOrderDetails) || null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Validates checkout signature: HMAC-SHA256(orderId + "|" + paymentId, secret) === signature
 */
export function verifyCheckoutSignature(params: {
  orderId: string;
  paymentId: string;
  signature: string;
  secret?: string;
}): boolean {
  const secret = params.secret || process.env.RAZORPAY_KEY_SECRET;
  if (!secret) return false;

  try {
    const expected = crypto
      .createHmac("sha256", secret)
      .update(`${params.orderId}|${params.paymentId}`)
      .digest("hex");

    const expectedBuf = Buffer.from(expected, "hex");
    const receivedBuf = Buffer.from(params.signature, "hex");

    if (expectedBuf.length !== receivedBuf.length) {
      return false;
    }

    return crypto.timingSafeEqual(expectedBuf, receivedBuf);
  } catch {
    return false;
  }
}

/**
 * Validates Razorpay Webhook signature: HMAC-SHA256(rawBody, secret) === signature
 */
export function verifyWebhookSignature(params: {
  rawBody: string;
  signature: string;
  secret?: string;
}): boolean {
  const secret =
    params.secret ||
    process.env.RAZORPAY_WEBHOOK_SECRET ||
    process.env.RAZORPAY_KEY_SECRET;
  if (!secret) return false;

  try {
    const expected = crypto
      .createHmac("sha256", secret)
      .update(params.rawBody)
      .digest("hex");

    const expectedBuf = Buffer.from(expected, "hex");
    const receivedBuf = Buffer.from(params.signature, "hex");

    if (expectedBuf.length !== receivedBuf.length) {
      return false;
    }

    return crypto.timingSafeEqual(expectedBuf, receivedBuf);
  } catch {
    return false;
  }
}
