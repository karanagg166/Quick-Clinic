import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { GET as listDoctors } from "@/app/api/doctors/route";
import { GET as getDoctor } from "@/app/api/doctors/[doctorId]/route";
import { createSlotHold, confirmSlotHold } from "@/lib/booking";
import { createOrReusePaymentOrder } from "@/lib/payment-booking-service";
import { initiateCheckout } from "@/lib/checkout-service";
import { createTestUser, cleanupTestUsers } from "@/__tests__/helpers/user-fixtures";
import * as paymentProvider from "@/lib/razorpay";

vi.mock("@upstash/redis", () => ({ Redis: class { async get() { return null; } async set() { return "OK"; } async del() { return 0; } } }));
vi.mock("@/lib/slot-mutex", () => ({ acquireSlotMutex: vi.fn().mockResolvedValue({ acquired: true, retryable: false }), releaseSlotMutex: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/logger", () => ({ logAccess: vi.fn(), logAudit: vi.fn() }));

const run = randomUUID();
const accounts: string[] = [];
let fixtureDoctor: string, regularDoctor: string, patientId: string, patientUserId: string, slotId: string;

beforeAll(async () => {
  const url = new URL(process.env.DATABASE_URL || "");
  expect(["localhost", "127.0.0.1", "host.docker.internal", "postgres"]).toContain(url.hostname);
  expect(url.pathname).toMatch(/\/(?:quick_clinic_test|test_db)$/);
  const hiddenUser = await createTestUser({ name: "Synthetic release fixture " + run, role: "DOCTOR" }); accounts.push(hiddenUser.id);
  const visibleUser = await createTestUser({ name: "Synthetic ordinary profile " + run, role: "DOCTOR" }); accounts.push(visibleUser.id);
  const patient = await createTestUser({ name: "Synthetic checkout patient " + run }); accounts.push(patient.id); patientUserId = patient.id;
  patientId = (await prisma.patient.create({ data: { userId: patient.id } })).id;
  fixtureDoctor = (await prisma.doctor.create({ data: { userId: hiddenUser.id, specialty: "GENERAL_PHYSICIAN", fees: 500, isReleaseFixture: true } })).id;
  regularDoctor = (await prisma.doctor.create({ data: { userId: visibleUser.id, specialty: "GENERAL_PHYSICIAN", fees: 500 } })).id;
  // Even an accidentally provisioned valid future slot cannot make a fixture bookable.
  const start = new Date(Date.now() + 86400000);
  slotId = (await prisma.slot.create({ data: { doctorId: fixtureDoctor, date: start, startTime: start, endTime: new Date(start.getTime() + 1800000), status: "AVAILABLE" } })).id;
});
afterAll(async () => { await cleanupTestUsers(accounts); });

describe("private release doctor identity", () => {
  it("applies the additive migration to existing profiles with the safe false default", async () => {
    const rollback = new Error("synthetic migration verification rollback");
    await expect(prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('ALTER TABLE "Doctor" DROP COLUMN "isReleaseFixture"');
      const sql = readFileSync(join(process.cwd(), "prisma/migrations/20261108000000_private_release_doctor/migration.sql"), "utf8");
      await tx.$executeRawUnsafe(sql);
      expect((await tx.doctor.findUniqueOrThrow({ where: { id: regularDoctor } })).isReleaseFixture).toBe(false);
      expect((await tx.doctor.findUniqueOrThrow({ where: { id: fixtureDoctor } })).isReleaseFixture).toBe(false);
      throw rollback;
    })).rejects.toBe(rollback);
    expect((await prisma.doctor.findUniqueOrThrow({ where: { id: fixtureDoctor } })).isReleaseFixture).toBe(true);
  });

  it("keeps existing/default ordinary profiles visible and hides fixtures in filtered discovery", async () => {
    const result = await listDoctors(new NextRequest("https://example.com/api/doctors?name=" + run));
    expect(result.status).toBe(200);
    const rows = await result.json();
    expect(rows.map((row: { id: string }) => row.id)).toEqual([regularDoctor]);
    expect((await prisma.doctor.findUniqueOrThrow({ where: { id: regularDoctor } })).isReleaseFixture).toBe(false);
  });

  it("cannot reveal a fixture through the direct public profile route", async () => {
    const result = await getDoctor(new NextRequest("https://example.com/api/doctors/" + fixtureDoctor), { params: Promise.resolve({ doctorId: fixtureDoctor }) });
    expect(result.status).toBe(404);
    expect(await result.text()).not.toContain(run);
  });

  it("preserves ordinary direct profile access", async () => {
    const result = await getDoctor(new NextRequest("https://example.com/api/doctors/" + regularDoctor), { params: Promise.resolve({ doctorId: regularDoctor }) });
    expect(result.status).toBe(200);
    expect((await result.json()).doctor.id).toBe(regularDoctor);
  });

  it("denies legacy slot holds and confirmation for a fixture", async () => {
    expect((await createSlotHold(slotId, fixtureDoctor, patientId)).kind).not.toBe("ok");
    expect(await confirmSlotHold({ slotId, doctorId: fixtureDoctor, patientId, token: randomUUID(), paymentMethod: "OFFLINE" })).toBeNull();
    expect(await prisma.appointment.count({ where: { doctorId: fixtureDoctor } })).toBe(0);
  });

  it("denies the legacy payment-order path before contacting a provider", async () => {
    const provider = vi.spyOn(paymentProvider, "createRazorpayOrder");
    const token = randomUUID();
    await prisma.slot.update({ where: { id: slotId }, data: { status: "HELD", heldByPatientId: patientId, holdToken: token, heldAt: new Date(), holdExpiresAt: new Date(Date.now() + 600000) } });
    try {
      await expect(createOrReusePaymentOrder({ userId: patientUserId, patientId, doctorId: fixtureDoctor, slotId, holdToken: token, idempotencyKey: "fixture-legacy-denial-" + randomUUID() })).rejects.toMatchObject({ statusCode: 409 });
      expect(provider).not.toHaveBeenCalled();
      expect(await prisma.payment.count({ where: { userId: patientUserId } })).toBe(0);
    } finally {
      await prisma.slot.update({ where: { id: slotId }, data: { status: "AVAILABLE", heldByPatientId: null, holdToken: null, heldAt: null, holdExpiresAt: null } });
      provider.mockRestore();
    }
  });

  it.each(["ONLINE", "OFFLINE"] as const)("blocks %s checkout before provider, reservation or payment mutations", async (paymentMethod) => {
    const provider = vi.spyOn(paymentProvider, "createRazorpayOrder");
    await expect(initiateCheckout({ userId: patientUserId, patientId, doctorId: fixtureDoctor, slotId, paymentMethod, idempotencyKey: "fixture-denial-" + randomUUID() })).rejects.toMatchObject({ statusCode: 404 });
    expect(provider).not.toHaveBeenCalled();
    expect(await prisma.checkout.count({ where: { doctorId: fixtureDoctor } })).toBe(0);
    expect(await prisma.payment.count({ where: { userId: patientUserId } })).toBe(0);
    expect((await prisma.slot.findUniqueOrThrow({ where: { id: slotId } })).status).toBe("AVAILABLE");
    provider.mockRestore();
  });
});
