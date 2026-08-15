import { test, expect } from "vitest";
import { NextRequest } from "next/server";
import { POST as loginPOST } from "@/app/api/user/login/route";
import { POST as logoutPOST } from "@/app/api/user/logout/route";

test("POST /api/user/login - fails when email or password is missing", async () => {
  const req = new NextRequest("http://localhost:3000/api/user/login", {
    method: "POST",
    body: JSON.stringify({ email: "karan@gmail.com" }),
  });
  const res = await loginPOST(req);
  expect(res.status).toBe(400);

  const data = await res.json();
  expect(data.error).toBe("Email and password are required");
});

test("POST /api/user/login - fails for non-existent email", async () => {
  const req = new NextRequest("http://localhost:3000/api/user/login", {
    method: "POST",
    body: JSON.stringify({
      email: "nonexistent_email_12345@gmail.com",
      password: "karan166",
    }),
  });
  const res = await loginPOST(req);
  expect(res.status).toBe(400);

  const data = await res.json();
  expect(data.error).toBe("Invalid email");
});

test("POST /api/user/login - fails for incorrect password", async () => {
  const req = new NextRequest("http://localhost:3000/api/user/login", {
    method: "POST",
    body: JSON.stringify({
      email: "karan@gmail.com",
      password: "wrong_password_test",
    }),
  });
  const res = await loginPOST(req);
  expect(res.status).toBe(400);

  const data = await res.json();
  expect(data.error).toBe("Incorrect password");
});

test("POST /api/user/login - logs in successfully with valid credentials and sets cookies", async () => {
  const req = new NextRequest("http://localhost:3000/api/user/login", {
    method: "POST",
    body: JSON.stringify({
      email: "karan@gmail.com",
      password: "karan166",
    }),
  });
  const res = await loginPOST(req);
  expect(res.status).toBe(200);

  const data = await res.json();
  expect(data.message).toBe("Login successful");
  expect(data.user).toBeDefined();
  expect(data.user.email).toBe("karan@gmail.com");
  expect(data.user.role).toBe("PATIENT");

  const tokenCookie = res.cookies.get("token");
  expect(tokenCookie).toBeDefined();
  expect(tokenCookie?.value).toBeTruthy();

  const roleCookie = res.cookies.get("role");
  expect(roleCookie).toBeDefined();
  expect(roleCookie?.value).toBe("PATIENT");
});

test("POST /api/user/login - logs in doctor successfully", async () => {
  const req = new NextRequest("http://localhost:3000/api/user/login", {
    method: "POST",
    body: JSON.stringify({
      email: "priyanshu@gmail.com",
      password: "karan166",
    }),
  });
  const res = await loginPOST(req);
  expect(res.status).toBe(200);

  const data = await res.json();
  expect(data.message).toBe("Login successful");
  expect(data.user.role).toBe("DOCTOR");
  expect(data.doctorId).toBeTruthy();
});

test("POST /api/user/logout - deletes auth cookies and returns message", async () => {
  const res = await logoutPOST();
  expect(res.status).toBe(200);

  const data = await res.json();
  expect(data.message).toBe("Logged out");
  
  // Verify token cookie is cleared
  const tokenCookie = res.cookies.get("token");
  expect(tokenCookie?.value).toBe("");
});
