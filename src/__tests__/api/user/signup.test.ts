import { test, expect } from "vitest";
import { NextRequest } from "next/server";
import { POST as signupPOST } from "@/app/api/user/signup/route";
import { prisma } from "@/lib/prisma";

test("POST /api/user/signup - rejects already registered email", async () => {
  const req = new NextRequest("http://localhost:3000/api/user/signup", {
    method: "POST",
    body: JSON.stringify({
      name: "Existing User",
      email: "karan@gmail.com",
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
  const uniqueEmail = `test_signup_${Date.now()}@example.com`;

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

  // Cleanup created user
  await prisma.user.delete({
    where: { email: uniqueEmail },
  });
});
