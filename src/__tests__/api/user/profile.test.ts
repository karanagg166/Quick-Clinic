import { test, expect, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { GET as profileGET, PATCH as profilePATCH } from "@/app/api/user/[userId]/route";
import { createAuthHeaders } from "@/__tests__/helpers/factories";

import { createTestUser, cleanupTestUsers } from "@/__tests__/helpers/user-fixtures";

let user: Awaited<ReturnType<typeof createTestUser>>;
beforeEach(async () => { user = await createTestUser(); });
afterEach(async () => { if (user) await cleanupTestUsers([user.id]); });

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

});

test("PATCH /api/user/[userId] - rejects unauthenticated and other-user updates", async () => {
  const url = `http://localhost:3000/api/user/${user.id}`;
  const params = { params: Promise.resolve({ userId: user.id }) };
  const unauthorized = await profilePATCH(new NextRequest(url, { method: "PATCH", body: JSON.stringify({ age: 40 }) }), params);
  expect(unauthorized.status).toBe(401);
  const headers = await createAuthHeaders({ id: "different_test_user", role: "PATIENT" });
  const forbidden = await profilePATCH(new NextRequest(url, { method: "PATCH", headers, body: JSON.stringify({ age: 40 }) }), params);
  expect(forbidden.status).toBe(403);
});
