import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { createToken } from "@/lib/auth";
import { POST as resetPassword } from "@/app/api/user/reset-password/route";
import { GET, PUT, PATCH } from "@/app/api/patients/[patientId]/route";

// Opt in only against a disposable database, never the configured application database.
describe.runIf(process.env.RUN_AUTH_DB_INTEGRATION === "1")("Patient authorization against PostgreSQL", () => {
  const suffix = randomUUID();
  const userIds: string[] = [];
  let ownerId: string, otherId: string, adminId: string, patientId: string;
  let ownerToken: string, otherToken: string, adminToken: string;
  beforeAll(async () => {
    await prisma.location.upsert({ where: { pincode: 900001 }, update: {}, create: { pincode: 900001, city: "Test", state: "Test" } });
    for (const role of ["PATIENT", "PATIENT", "ADMIN"] as const) {
      const user = await prisma.user.create({ data: {
        name: "Security fixture", email: `${userIds.length}-${suffix}@example.test`,
        phoneNo: "0000000000", password: "unused-fixture-hash", age: 30,
        address: "Test", pinCode: 900001, role, isActive: true,
      } });
      userIds.push(user.id);
    }
    [ownerId, otherId, adminId] = userIds;
    const patient = await prisma.patient.create({ data: { userId: ownerId } });
    patientId = patient.id;
    ownerToken = await createToken({ id: ownerId, role: "PATIENT" });
    otherToken = await createToken({ id: otherId, role: "PATIENT" });
    adminToken = await createToken({ id: adminId, role: "ADMIN" });
  });
  afterAll(async () => {
    await prisma.accessLog.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.patient.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  });
  for (const [method, handler] of Object.entries({ GET, PUT, PATCH })) {
    it(`${method}: denies anonymous and cross-patient access, permits owner and admin`, async () => {
      const invoke = (token?: string) => handler(new NextRequest(`http://localhost/api/patients/${patientId}`, {
        method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), "content-type": "application/json" },
        ...(method !== "GET" ? { body: JSON.stringify({ allergies: "Fixture", userId: ownerId, role: "ADMIN" }) } : {}),
      }), { params: Promise.resolve({ patientId }) });
      expect((await invoke()).status).toBe(401);
      expect((await invoke(otherToken)).status).toBe(403);
      expect((await invoke(ownerToken)).status).toBe(200);
      expect((await invoke(adminToken)).status).toBe(200);
    });
  }
  it("omits password hashes from profile responses", async () => {
    const res = await GET(new NextRequest("http://localhost", { headers: { authorization: `Bearer ${ownerToken}` } }), { params: Promise.resolve({ patientId }) });
    const body = await res.json();
    expect(body.patient.user).not.toHaveProperty("password");
  });
  it("immediately rejects a disabled account with a previously valid JWT", async () => {
    await prisma.user.update({ where: { id: ownerId }, data: { isActive: false } });
    try {
      expect((await GET(new NextRequest("http://localhost", { headers: { authorization: `Bearer ${ownerToken}` } }), { params: Promise.resolve({ patientId }) })).status).toBe(401);
    } finally {
      await prisma.user.update({ where: { id: ownerId }, data: { isActive: true } });
    }
  });
  it("immediately rejects demoted admin and forged ADMIN claims", async () => {
    const forged = await createToken({ id: otherId, role: "ADMIN" });
    const invoke = (token: string) => GET(new NextRequest("http://localhost", { headers: { authorization: `Bearer ${token}` } }), { params: Promise.resolve({ patientId }) });
    expect((await invoke(forged)).status).toBe(401);
    await prisma.user.update({ where: { id: adminId }, data: { role: "PATIENT" } });
    expect((await invoke(adminToken)).status).toBe(401);
  });
  it("rejects a deleted user with an otherwise valid JWT", async () => {
    await prisma.user.delete({ where: { id: otherId } });
    expect((await GET(new NextRequest("http://localhost", { headers: { authorization: `Bearer ${otherToken}` } }), { params: Promise.resolve({ patientId }) })).status).toBe(401);
  });
  it("a password reset proof can be consumed only once under concurrent requests", async () => {
    const owner = await prisma.user.findUniqueOrThrow({ where: { id: ownerId } });
    await prisma.otp.create({ data: { userId: ownerId, email: owner.email, code: "synthetic-proof", expiresAt: new Date(Date.now() + 60_000) } });
    const invoke = () => resetPassword(new NextRequest("http://localhost/api/user/reset-password", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: owner.email, otp: "synthetic-proof", newPassword: "unused-fixture-password" }),
    }));
    const responses = await Promise.all([invoke(), invoke()]);
    expect(responses.map((res) => res.status).sort()).toEqual([200, 400]);
    expect(await prisma.otp.findUnique({ where: { userId: ownerId } })).toBeNull();
  });

});
