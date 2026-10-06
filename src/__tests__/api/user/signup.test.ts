import { test, expect, beforeAll, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { POST as signupPOST } from "@/app/api/user/signup/route";
import { prisma } from "@/lib/prisma";

import { buildUserPayload } from "@/__tests__/helpers/factories";
import { createTestUser, cleanupTestUsers } from "@/__tests__/helpers/user-fixtures";

let existingUser: Awaited<ReturnType<typeof createTestUser>>;
const createdEmails: string[] = [];
beforeAll(async () => {
  existingUser = await createTestUser();
  createdEmails.push(existingUser.email);
});
afterAll(async () => {
  const users = await prisma.user.findMany({ where: { email: { in: createdEmails } }, select: { id: true } });
  await cleanupTestUsers(users.map(user => user.id));
});

test("POST /api/user/signup - rejects already registered email", async () => {
  const req = new NextRequest("http://localhost:3000/api/user/signup", {
    method: "POST",
    body: JSON.stringify({
      name: "Existing User",
      email: existingUser.email,
      phoneNo: "7838222130",
      age: 22,
      city: "Faridabad",
      state: "Haryana",
      pinCode: 121004,
      password: "karan166",
      address: "Flat 1, Example St",
      role: "PATIENT",
      gender: "MALE",
    }),
  });

  const res = await signupPOST(req);
  expect(res.status).toBe(400);

  const data = await res.json();
  expect(data.error).toBe("User already exists");
});

test("POST /api/user/signup - registers new user successfully and sets cookies", async () => {
  const uniqueEmail = buildUserPayload().email;
  createdEmails.push(uniqueEmail);

  const req = new NextRequest("http://localhost:3000/api/user/signup", {
    method: "POST",
    body: JSON.stringify({
      name: "Test New User",
      email: uniqueEmail,
      phoneNo: "9988776655",
      age: 25,
      city: "Bangalore",
      state: "Karnataka",
      pinCode: 560001,
      password: "karan166",
      address: "123 Tech Park",
      role: "PATIENT",
      gender: "FEMALE",
    }),
  });

  const res = await signupPOST(req);
  expect(res.status).toBe(201);

  const data = await res.json();
  expect(data.message).toBe("User created successfully");
  expect(data.user.email).toBe(uniqueEmail);

  // Check auth cookies
  const tokenCookie = res.cookies.get("token");
  expect(tokenCookie).toBeDefined();


});
