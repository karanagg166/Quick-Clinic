import { test, expect } from "vitest";
import { NextRequest } from "next/server";
import { POST as onboardingPOST } from "@/app/api/admin/onboarding/route";
import { createToken } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

test("POST /api/admin/onboarding - returns 401 Unauthorized without admin token", async () => {
  const req = new NextRequest("http://localhost:3000/api/admin/onboarding", {
    method: "POST",
    body: JSON.stringify({ userId: "123" }),
  });
  const res = await onboardingPOST(req);
  expect(res.status).toBe(401);
});

test("POST /api/admin/onboarding - returns 403 when onboarding another user id", async () => {
  const adminToken = await createToken({
    id: "admin_id_1",
    email: "admin@quickclinic.com",
    role: "ADMIN",
  });

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
  const adminUser = await prisma.user.findFirst({
    where: { role: "ADMIN" },
  });
  expect(adminUser).toBeDefined();

  await prisma.admin.upsert({
    where: { userId: adminUser!.id },
    update: {},
    create: { userId: adminUser!.id },
  });

  const adminToken = await createToken({
    id: adminUser!.id,
    email: adminUser!.email,
    role: "ADMIN",
  });

  const req = new NextRequest("http://localhost:3000/api/admin/onboarding", {
    method: "POST",
    headers: {
      cookie: `token=${adminToken}; role=ADMIN`,
    },
    body: JSON.stringify({
      userId: adminUser!.id,
      secretCode: "WRONG_SECRET_CODE",
      name: adminUser!.name,
      phoneNo: adminUser!.phoneNo,
    }),
  });
  const res = await onboardingPOST(req);
  expect(res.status).toBe(400);

  const data = await res.json();
  expect(data.error).toBe("Invalid Super Admin Code");
});
