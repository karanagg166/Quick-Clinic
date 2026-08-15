import { test, expect } from "vitest";
import { NextRequest } from "next/server";
import { POST as createOrderPOST } from "@/app/api/user/[userId]/payments/createOrder/route";
import { POST as verifyOrderPOST } from "@/app/api/user/[userId]/payments/verifyOrder/route";

test("POST /api/user/[userId]/payments/createOrder - rejects a request without appointment details", async () => {
  const req = new NextRequest("http://localhost:3000/api/user/test_user/payments/createOrder", {
    method: "POST",
    body: JSON.stringify({}),
  });

  const res = await createOrderPOST(req, {
    params: Promise.resolve({ userId: "test_user" }),
  });
  expect(res.status).toBe(400);

  const data = await res.json();
  expect(data.message).toBe("doctorId and slotId are required");
});

test("POST /api/user/[userId]/payments/verifyOrder - rejects missing payment details", async () => {
  const req = new NextRequest("http://localhost:3000/api/user/test_user/payments/verifyOrder", {
    method: "POST",
    body: JSON.stringify({ orderId: "order_123" }),
  });

  const res = await verifyOrderPOST(req, {
    params: Promise.resolve({ userId: "test_user" }),
  });
  expect(res.status).toBe(400);

  const data = await res.json();
  expect(data.error).toBe("Missing required payment details");
});

test("POST /api/user/[userId]/payments/verifyOrder - rejects invalid signature", async () => {
  const req = new NextRequest("http://localhost:3000/api/user/test_user/payments/verifyOrder", {
    method: "POST",
    body: JSON.stringify({
      orderId: "order_123",
      paymentId: "pay_123",
      signature: "invalid_test_signature",
    }),
  });

  const res = await verifyOrderPOST(req, {
    params: Promise.resolve({ userId: "test_user" }),
  });
  expect(res.status).toBe(400);

  const data = await res.json();
  expect(data.error).toBe("Invalid signature");
});
