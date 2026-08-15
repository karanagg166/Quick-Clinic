import { test, expect } from "vitest";
import { NextRequest } from "next/server";
import { GET as logsGET } from "@/app/api/admin/logs/route";
import { createToken } from "@/lib/auth";

test("GET /api/admin/logs - returns 401 Unauthorized when no admin token is present", async () => {
  const req = new NextRequest("http://localhost:3000/api/admin/logs");
  const res = await logsGET(req);
  expect(res.status).toBe(401);

  const data = await res.json();
  expect(data.error).toBe("Unauthorized");
});

test("GET /api/admin/logs - returns 401 if user role is not ADMIN", async () => {
  const patientToken = await createToken({
    id: "patient_test_id",
    email: "patient@example.com",
    role: "PATIENT",
  });

  const req = new NextRequest("http://localhost:3000/api/admin/logs", {
    headers: {
      cookie: `token=${patientToken}; role=PATIENT`,
    },
  });
  const res = await logsGET(req);
  expect(res.status).toBe(401);
});

test("GET /api/admin/logs - returns audit logs when requested by admin", async () => {
  const adminToken = await createToken({
    id: "admin_test_id",
    email: "admin@quickclinic.com",
    role: "ADMIN",
  });

  const req = new NextRequest("http://localhost:3000/api/admin/logs?type=audit", {
    headers: {
      cookie: `token=${adminToken}; role=ADMIN`,
    },
  });
  const res = await logsGET(req);
  expect(res.status).toBe(200);

  const data = await res.json();
  expect(data.logs).toBeDefined();
  expect(Array.isArray(data.logs)).toBe(true);
});

test("GET /api/admin/logs - returns access logs when requested by admin", async () => {
  const adminToken = await createToken({
    id: "admin_test_id",
    email: "admin@quickclinic.com",
    role: "ADMIN",
  });

  const req = new NextRequest("http://localhost:3000/api/admin/logs?type=access", {
    headers: {
      cookie: `token=${adminToken}; role=ADMIN`,
    },
  });
  const res = await logsGET(req);
  expect(res.status).toBe(200);

  const data = await res.json();
  expect(data.logs).toBeDefined();
  expect(Array.isArray(data.logs)).toBe(true);
});
