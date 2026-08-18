import { test, expect } from "vitest";
import { NextRequest } from "next/server";
import { GET as profileGET, PATCH as profilePATCH } from "@/app/api/user/[userId]/route";
import { prisma } from "@/lib/prisma";
import { createAuthHeaders } from "@/__tests__/helpers/factories";

test("GET /api/user/[userId] - returns 404 for invalid user ID", async () => {
  const req = new NextRequest("http://localhost:3000/api/user/invalid_user_id_123");
  const res = await profileGET(req, {
    params: Promise.resolve({ userId: "invalid_user_id_123" }),
  });
  expect(res.status).toBe(404);

  const data = await res.json();
  expect(data.error).toBe("User not found");
});

test("GET /api/user/[userId] - returns user details for valid user", async () => {
  const user = await prisma.user.findFirst({
    where: { email: "karan@gmail.com" },
  });
  expect(user).toBeDefined();

  const req = new NextRequest(`http://localhost:3000/api/user/${user!.id}`);
  const res = await profileGET(req, {
    params: Promise.resolve({ userId: user!.id }),
  });
  expect(res.status).toBe(200);

  const data = await res.json();
  expect(data.id).toBe(user!.id);
  expect(data.email).toBe(user!.email);
  expect(data.name).toBe(user!.name);
});

test("PATCH /api/user/[userId] - updates user profile fields successfully", async () => {
  const user = await prisma.user.findFirst({
    where: { email: "karan@gmail.com" },
  });
  expect(user).toBeDefined();

  const originalAddress = user!.address;
  const authHeaders = await createAuthHeaders({ id: user!.id, role: user!.role });

  const req = new NextRequest(`http://localhost:3000/api/user/${user!.id}`, {
    method: "PATCH",
    headers: authHeaders,
    body: JSON.stringify({
      address: "Updated Test Address 123",
      age: 23,
    }),
  });

  const res = await profilePATCH(req, {
    params: Promise.resolve({ userId: user!.id }),
  });
  expect(res.status).toBe(200);

  const data = await res.json();
  expect(data.address).toBe("Updated Test Address 123");
  expect(data.age).toBe(23);

  // Restore original address
  const restoreReq = new NextRequest(`http://localhost:3000/api/user/${user!.id}`, {
    method: "PATCH",
    headers: authHeaders,
    body: JSON.stringify({
      address: originalAddress,
      age: 22,
    }),
  });
  await profilePATCH(restoreReq, {
    params: Promise.resolve({ userId: user!.id }),
  });
});
