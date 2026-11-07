import { beforeAll, afterAll, afterEach, describe, expect, it } from "vitest";
import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { planMedicalRelease, applyMedicalRelease } from "@/lib/medical-release-bootstrap";
import { medicalReleaseIdentity, medicalReleaseTarget } from "@/lib/medical-release-identity";
import { canDoctorAccessPatientMedicalRecords } from "@/lib/medical-record-access";
const databaseUrl = process.env.DATABASE_URL || "";
const key = randomBytes(48).toString("hex");
const identity = medicalReleaseIdentity(key);
const userIds = Object.values(identity.accounts).map((account) => account.userId);
const now = new Date("2026-11-08T00:00:00Z");
async function clearOwned() {
  await prisma.appointment.deleteMany({
    where: { id: identity.appointmentId },
  });
  await prisma.slot.deleteMany({ where: { id: identity.slotId } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}
async function counts() {
  return {
    users: await prisma.user.count({ where: { id: { in: userIds } } }),
    doctor: await prisma.doctor.count({
      where: { id: identity.accounts.doctor.profileId },
    }),
    patients: await prisma.patient.count({
      where: {
        id: {
          in: [identity.accounts["patient-a"].profileId, identity.accounts["patient-b"].profileId],
        },
      },
    }),
    slot: await prisma.slot.count({ where: { id: identity.slotId } }),
    appointment: await prisma.appointment.count({
      where: { id: identity.appointmentId },
    }),
  };
}
const empty = { users: 0, doctor: 0, patients: 0, slot: 0, appointment: 0 };
beforeAll(async () => {
  const url = new URL(databaseUrl);
  expect(["localhost", "127.0.0.1", "host.docker.internal", "postgres"]).toContain(url.hostname);
  expect(url.pathname).toMatch(/\/(?:quick_clinic_test|quickclinic_test|test_db)$/);
  // Connect to an existing reference without changing a shared location.
  await prisma.location.upsert({
    where: { pincode: 121004 },
    update: {},
    create: { pincode: 121004, city: "Synthetic test location", state: "Test" },
  });
});
afterEach(clearOwned);
afterAll(clearOwned);
describe("owned medical release bootstrap against PostgreSQL", () => {
  it("plans read-only without creating accounts or exposing credentials", async () => {
    const plan = await planMedicalRelease(prisma, databaseUrl, key, now);
    expect(plan.mode).toBe("create");
    expect(await counts()).toEqual(empty);
    const encoded = JSON.stringify(plan);
    for (const account of Object.values(identity.accounts)) {
      expect(encoded).not.toContain(account.email);
      expect(encoded).not.toContain(account.password);
    }
    expect(encoded).not.toContain(key);
    expect(encoded).not.toContain(databaseUrl);
  });
  it("atomically creates eight hidden records and grants only patient A", async () => {
    const plan = await planMedicalRelease(prisma, databaseUrl, key, now);
    expect(await applyMedicalRelease(prisma, databaseUrl, key, plan, now)).toEqual({
      created: true,
      ownedRecords: 8,
    });
    expect(await counts()).toEqual({
      users: 3,
      doctor: 1,
      patients: 2,
      slot: 1,
      appointment: 1,
    });
    const doctor = await prisma.doctor.findUniqueOrThrow({
      where: { id: identity.accounts.doctor.profileId },
    });
    expect(doctor.isReleaseFixture).toBe(true);
    expect(
      await canDoctorAccessPatientMedicalRecords(
        doctor.id,
        identity.accounts["patient-a"].profileId,
      ),
    ).toBe(true);
    expect(
      await canDoctorAccessPatientMedicalRecords(
        doctor.id,
        identity.accounts["patient-b"].profileId,
      ),
    ).toBe(false);
    expect(await prisma.schedule.count({ where: { doctorId: doctor.id } })).toBe(0);
    expect(await prisma.payment.count({ where: { userId: { in: userIds } } })).toBe(0);
    expect(await prisma.notification.count({ where: { userId: { in: userIds } } })).toBe(0);
    expect(
      (await prisma.slot.findUniqueOrThrow({ where: { id: identity.slotId } })).endTime.getTime(),
    ).toBeLessThan(now.getTime());
  });
  it("recovers a lost apply response without resetting passwords or grants", async () => {
    const plan = await planMedicalRelease(prisma, databaseUrl, key, now);
    await applyMedicalRelease(prisma, databaseUrl, key, plan, now);
    const before = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, password: true, updatedAt: true },
      orderBy: { id: "asc" },
    });
    expect(await applyMedicalRelease(prisma, databaseUrl, key, plan, now)).toEqual({
      created: false,
      ownedRecords: 8,
    });
    const reuse = await planMedicalRelease(prisma, databaseUrl, key, now);
    expect(reuse.mode).toBe("reuse");
    expect(await applyMedicalRelease(prisma, databaseUrl, key, reuse, now)).toEqual({
      created: false,
      ownedRecords: 8,
    });
    expect(
      await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, password: true, updatedAt: true },
        orderBy: { id: "asc" },
      }),
    ).toEqual(before);
  });
  it.each(["tampered", "expired", "wrong-key", "wrong-target"])(
    "rejects a %s plan before creating records",
    async (variant) => {
      const plan = await planMedicalRelease(prisma, databaseUrl, key, now);
      const target = new URL(databaseUrl);
      target.pathname = "/unapproved_target";
      await expect(
        applyMedicalRelease(
          prisma,
          variant === "wrong-target" ? target.href : databaseUrl,
          variant === "wrong-key" ? key + "changed" : key,
          variant === "tampered" ? { ...plan, mode: "reuse" } : plan,
          variant === "expired" ? new Date(now.getTime() + 16 * 60000) : now,
        ),
      ).rejects.toThrow("fixture state");
      expect(await counts()).toEqual(empty);
    },
  );
  it("refuses a partial or colliding identity instead of adopting it", async () => {
    const account = identity.accounts.doctor;
    await prisma.user.create({
      data: {
        id: account.userId,
        email: account.email,
        password: "synthetic-unowned",
        role: "DOCTOR",
        name: "Synthetic collision",
        phoneNo: "0000000000",
        age: 30,
        address: "Synthetic",
        pinCode: 121004,
      },
    });
    await expect(planMedicalRelease(prisma, databaseUrl, key, now)).rejects.toThrow(
      "fixture state",
    );
    expect(await counts()).toEqual({ ...empty, users: 1 });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: account.userId } })).name).toBe(
      "Synthetic collision",
    );
  });
  it.each(["role", "password", "fixture-flag", "clinical-fields", "grant"])(
    "refuses changed %s without restoring previous state",
    async (variant) => {
      const plan = await planMedicalRelease(prisma, databaseUrl, key, now);
      await applyMedicalRelease(prisma, databaseUrl, key, plan, now);
      if (variant === "role")
        await prisma.user.update({
          where: { id: identity.accounts.doctor.userId },
          data: { role: "PATIENT" },
        });
      if (variant === "password")
        await prisma.user.update({
          where: { id: identity.accounts.doctor.userId },
          data: { password: "synthetic-changed" },
        });
      if (variant === "fixture-flag")
        await prisma.doctor.update({
          where: { id: identity.accounts.doctor.profileId },
          data: { isReleaseFixture: false },
        });
      if (variant === "clinical-fields")
        await prisma.patient.update({
          where: { id: identity.accounts["patient-a"].profileId },
          data: { allergies: "synthetic changed field" },
        });
      if (variant === "grant")
        await prisma.appointment.update({
          where: { id: identity.appointmentId },
          data: { patientId: identity.accounts["patient-b"].profileId },
        });
      await expect(planMedicalRelease(prisma, databaseUrl, key, now)).rejects.toThrow(
        "fixture state",
      );
      await expect(applyMedicalRelease(prisma, databaseUrl, key, plan, now)).rejects.toThrow(
        "fixture state",
      );
      expect(await counts()).toEqual({
        users: 3,
        doctor: 1,
        patients: 2,
        slot: 1,
        appointment: 1,
      });
      if (variant === "fixture-flag")
        expect(
          (
            await prisma.doctor.findUniqueOrThrow({
              where: { id: identity.accounts.doctor.profileId },
            })
          ).isReleaseFixture,
        ).toBe(false);
      if (variant === "grant")
        expect(
          await canDoctorAccessPatientMedicalRecords(
            identity.accounts.doctor.profileId,
            identity.accounts["patient-a"].profileId,
          ),
        ).toBe(false);
    },
  );
  it("rolls back users, profiles and slot when the final appointment insert fails", async () => {
    const plan = await planMedicalRelease(prisma, databaseUrl, key, now);
    const name = "release_test_" + randomBytes(6).toString("hex");
    // IDs contain only derived hex/hyphens. This database constraint rejects only this test's owned appointment.
    expect(identity.appointmentId).toMatch(/^[a-f0-9-]+$/);
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "Appointment" ADD CONSTRAINT "${name}" CHECK (id <> '${identity.appointmentId}')`,
    );
    try {
      await expect(applyMedicalRelease(prisma, databaseUrl, key, plan, now)).rejects.toThrow();
      expect(await counts()).toEqual(empty);
    } finally {
      await prisma.$executeRawUnsafe(`ALTER TABLE "Appointment" DROP CONSTRAINT "${name}"`);
    }
  });
  it("denies simultaneous apply while the shared identity lock is held, then recovers", async () => {
    const plan = await planMedicalRelease(prisma, databaseUrl, key, now);
    const lock = createHash("sha256")
      .update(identity.owner + medicalReleaseTarget(databaseUrl))
      .digest("hex");
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lock},17))::text`;
      await expect(applyMedicalRelease(prisma, databaseUrl, key, plan, now)).rejects.toThrow(
        "fixture state",
      );
      expect(await counts()).toEqual(empty);
    });
    expect(await applyMedicalRelease(prisma, databaseUrl, key, plan, now)).toEqual({
      created: true,
      ownedRecords: 8,
    });
  });

  it("refuses a stale reuse plan if the owned fixture was removed", async () => {
    await applyMedicalRelease(
      prisma,
      databaseUrl,
      key,
      await planMedicalRelease(prisma, databaseUrl, key, now),
      now,
    );
    const reuse = await planMedicalRelease(prisma, databaseUrl, key, now);
    await clearOwned();
    await expect(applyMedicalRelease(prisma, databaseUrl, key, reuse, now)).rejects.toThrow(
      "fixture state",
    );
    expect(await counts()).toEqual(empty);
  });
});
