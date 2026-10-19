import { test, expect, beforeAll, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { POST as onboardingPOST } from "@/app/api/admin/onboarding/route";
import { createToken } from "@/lib/auth";
import { createTestUser, cleanupTestUsers } from "@/__tests__/helpers/user-fixtures";

let adminUser: Awaited<ReturnType<typeof createTestUser>>;
let adminToken: string;

beforeAll(async () => {
  adminUser = await createTestUser({ role: "ADMIN" });
  adminToken = await createToken({
    id: adminUser.id,
    email: adminUser.email,
    role: "ADMIN",
  });
});

afterAll(async () => {
  if (adminUser) await cleanupTestUsers([adminUser.id]);
});

test("POST /api/admin/onboarding - returns 401 Unauthorized without admin token", async () => {
  const req = new NextRequest("http://localhost:3000/api/admin/onboarding", {
    method: "POST",
    body: JSON.stringify({ userId: "123" }),
  });
  const res = await onboardingPOST(req);
  expect(res.status).toBe(401);
});

test("POST /api/admin/onboarding - returns 403 when onboarding another user id", async () => {
  const req = new NextRequest("http://localhost:3000/api/admin/onboarding", {
    method: "POST",
    headers: {
      cookie: `token=${adminToken}; role=ADMIN`,
    },
    body: JSON.stringify({ userId: "different_user_id" }),
  });
  const res = await onboardingPOST(req);
  expect(res.status).toBe(403);
});

test("POST /api/admin/onboarding - rejects invalid secret code", async () => {
  const req = new NextRequest("http://localhost:3000/api/admin/onboarding", {
    method: "POST",
    headers: {
      cookie: `token=${adminToken}; role=ADMIN`,
    },
    body: JSON.stringify({
      userId: adminUser.id,
      secretCode: "WRONG_SECRET_CODE",
      name: "Admin Tester",
      phoneNo: "1234567890",
    }),
  });
  const res = await onboardingPOST(req);
  expect(res.status).toBe(400);

  const data = await res.json();
  expect(data.error).toBe("Invalid Super Admin Code");
});

