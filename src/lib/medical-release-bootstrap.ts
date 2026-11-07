/** Reviewed, atomic provisioning of owned synthetic doctor/patient grants. */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import bcrypt from "bcryptjs";
import type { PrismaClient, Prisma } from "@/generated/prisma";
import {
  medicalReleaseIdentity,
  medicalReleaseTarget,
  MEDICAL_RELEASE_LABELS,
} from "./medical-release-identity";
type Identity = ReturnType<typeof medicalReleaseIdentity>;
type Db = Prisma.TransactionClient;
export interface MedicalReleasePlan {
  version: 1;
  owner: string;
  target: string;
  mode: "create" | "reuse";
  expiresAt: string;
  signature: string;
}
function requireState(condition: unknown): asserts condition {
  if (!condition)
    throw new Error("Medical release fixture state is unowned, incomplete or changed.");
}
const startDate = (identity: Identity) =>
  new Date(identity.pastStart.slice(0, 10) + "T00:00:00.000Z");
const expectedUser = (identity: Identity, label: (typeof MEDICAL_RELEASE_LABELS)[number]) => ({
  id: identity.accounts[label].userId,
  email: identity.accounts[label].email,
  role: identity.accounts[label].role,
  name: "Synthetic release " + label,
  phoneNo: "0000000000",
  age: 30,
  gender: "BINARY" as const,
  address: "Synthetic verification identity. No clinical encounter.",
  pinCode: 121004,
  isActive: true,
  emailVerified: true,
  profileImageUrl: null,
});
const same = (actual: Record<string, unknown>, expected: Record<string, unknown>) =>
  Object.entries(expected).every(([key, value]) => {
    const found = actual[key];
    return value instanceof Date
      ? found instanceof Date && found.getTime() === value.getTime()
      : found === value;
  });
const sign = (key: string, fields: Omit<MedicalReleasePlan, "signature">) =>
  createHmac("sha256", key).update(JSON.stringify(fields)).digest("hex");
async function inspect(db: Db, identity: Identity): Promise<"create" | "reuse"> {
  const column = await db.$queryRaw<
    Array<{
      present: boolean;
    }>
  >`SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='Doctor' AND column_name='isReleaseFixture') AS present`;
  requireState(column[0]?.present);
  requireState((await db.location.count({ where: { pincode: 121004 } })) === 1);
  const users = await db.user.findMany({
    where: {
      OR: [
        {
          id: {
            in: MEDICAL_RELEASE_LABELS.map((label) => identity.accounts[label].userId),
          },
        },
        {
          email: {
            in: MEDICAL_RELEASE_LABELS.map((label) => identity.accounts[label].email),
          },
        },
      ],
    },
    select: {
      id: true,
      email: true,
      role: true,
      name: true,
      phoneNo: true,
      age: true,
      gender: true,
      address: true,
      pinCode: true,
      isActive: true,
      emailVerified: true,
      password: true,
      profileImageUrl: true,
    },
  });
  const doctor = await db.doctor.findUnique({
    where: { id: identity.accounts.doctor.profileId },
  });
  const patients = await db.patient.findMany({
    where: {
      id: {
        in: [identity.accounts["patient-a"].profileId, identity.accounts["patient-b"].profileId],
      },
    },
    select: { id: true, userId: true },
  });
  const slot = await db.slot.findUnique({ where: { id: identity.slotId } });
  const appointment = await db.appointment.findUnique({
    where: { id: identity.appointmentId },
  });
  const count =
    users.length + (doctor ? 1 : 0) + patients.length + (slot ? 1 : 0) + (appointment ? 1 : 0);
  if (count === 0) return "create";
  requireState(count === 8);
  for (const label of MEDICAL_RELEASE_LABELS) {
    const account = identity.accounts[label];
    const user = users.find((row) => row.id === account.userId);
    requireState(
      user &&
        same(user, expectedUser(identity, label)) &&
        (await bcrypt.compare(account.password, user.password)),
    );
  }
  requireState(
    doctor &&
      same(doctor, {
        id: identity.accounts.doctor.profileId,
        userId: identity.accounts.doctor.userId,
        isReleaseFixture: true,
        specialty: "GENERAL_PHYSICIAN",
        experience: 0,
        fees: 0,
        balance: 0,
        latitude: null,
        longitude: null,
        doctorBio: "Synthetic release fixture. Does not provide medical care.",
      }),
  );
  for (const label of ["patient-a", "patient-b"] as const) {
    const account = identity.accounts[label];
    requireState(
      patients.some((row) => row.id === account.profileId && row.userId === account.userId),
    );
    // Verify empty synthetic clinical fields without reading their contents.
    requireState(
      (await db.patient.count({
        where: {
          id: account.profileId,
          userId: account.userId,
          medicalHistory: "",
          allergies: "",
          currentMedications: "",
        },
      })) === 1,
    );
  }
  requireState(
    slot &&
      same(slot, {
        id: identity.slotId,
        doctorId: identity.accounts.doctor.profileId,
        date: startDate(identity),
        startTime: new Date(identity.pastStart),
        endTime: new Date(identity.pastEnd),
        status: "BOOKED",
        heldByPatientId: null,
        heldAt: null,
        holdToken: null,
        holdExpiresAt: null,
      }),
  );
  requireState(
    appointment &&
      same(appointment, {
        id: identity.appointmentId,
        doctorId: identity.accounts.doctor.profileId,
        patientId: identity.accounts["patient-a"].profileId,
        slotId: identity.slotId,
        status: "COMPLETED",
        paymentMethod: "OFFLINE",
        paymentId: null,
        transactionId: null,
        isAppointmentOffline: true,
        notes: "Synthetic release authorization only; no clinical encounter.",
        bookedAt: new Date(identity.pastStart),
      }),
  );
  const doctorId = identity.accounts.doctor.profileId;
  const userIds = MEDICAL_RELEASE_LABELS.map((label) => identity.accounts[label].userId);
  requireState(
    (await db.appointment.count({
      where: {
        OR: [{ doctorId }, { patientId: { in: patients.map((row) => row.id) } }],
      },
    })) === 1,
  );
  requireState((await db.slot.count({ where: { doctorId } })) === 1);
  requireState((await db.schedule.count({ where: { doctorId } })) === 0);
  requireState((await db.payment.count({ where: { userId: { in: userIds } } })) === 0);
  requireState(
    (await db.checkout.count({
      where: { OR: [{ doctorId }, { userId: { in: userIds } }] },
    })) === 0,
  );
  requireState((await db.notification.count({ where: { userId: { in: userIds } } })) === 0);
  requireState(
    (await db.doctorPatientRelation.count({
      where: {
        OR: [
          { doctorsUserId: identity.accounts.doctor.userId },
          {
            patientsUserId: {
              in: [identity.accounts["patient-a"].userId, identity.accounts["patient-b"].userId],
            },
          },
        ],
      },
    })) === 0,
  );
  return "reuse";
}
export async function planMedicalRelease(
  db: PrismaClient,
  databaseUrl: string,
  key: string,
  now = new Date(),
): Promise<MedicalReleasePlan> {
  const identity = medicalReleaseIdentity(key);
  // Read-only PostgreSQL snapshot: planning cannot insert identities or acquire a write lock.
  const mode = await db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      return inspect(tx, identity);
    },
    { isolationLevel: "RepeatableRead", timeout: 30000 },
  );
  const fields: Omit<MedicalReleasePlan, "signature"> = {
    version: 1,
    owner: identity.owner,
    target: medicalReleaseTarget(databaseUrl),
    mode,
    expiresAt: new Date(now.getTime() + 15 * 60000).toISOString(),
  };
  return { ...fields, signature: sign(key, fields) };
}
export async function applyMedicalRelease(
  db: PrismaClient,
  databaseUrl: string,
  key: string,
  plan: MedicalReleasePlan,
  now = new Date(),
) {
  const identity = medicalReleaseIdentity(key);
  const { signature, ...fields } = plan;
  requireState(
    plan.version === 1 &&
      plan.owner === identity.owner &&
      plan.target === medicalReleaseTarget(databaseUrl),
  );
  requireState(
    (plan.mode === "create" || plan.mode === "reuse") &&
      Number.isFinite(Date.parse(plan.expiresAt)) &&
      Date.parse(plan.expiresAt) > now.getTime() &&
      Date.parse(plan.expiresAt) <= now.getTime() + 15 * 60000,
  );
  const expected = sign(key, fields);
  requireState(
    typeof signature === "string" &&
      /^[a-f0-9]{64}$/.test(signature) &&
      timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(expected, "hex")),
  );
  // Hash outside the identity lock; no side effect occurs until fresh state checks pass.
  const passwords = Object.fromEntries(
    await Promise.all(
      MEDICAL_RELEASE_LABELS.map(async (label) => [
        label,
        await bcrypt.hash(identity.accounts[label].password, 10),
      ]),
    ),
  );
  return db.$transaction(
    async (tx) => {
      const lock = createHash("sha256")
        .update(identity.owner + plan.target)
        .digest("hex");
      const acquired = await tx.$queryRaw<
        Array<{
          locked: boolean;
        }>
      >`SELECT pg_try_advisory_xact_lock(hashtextextended(${lock},17)) AS locked`;
      requireState(acquired[0]?.locked);
      const mode = await inspect(tx, identity);
      if (mode === "reuse") return { created: false, ownedRecords: 8 };
      requireState(plan.mode === "create");
      for (const label of MEDICAL_RELEASE_LABELS)
        await tx.user.create({
          data: {
            ...expectedUser(identity, label),
            password: passwords[label],
          },
        });
      await tx.doctor.create({
        data: {
          id: identity.accounts.doctor.profileId,
          userId: identity.accounts.doctor.userId,
          isReleaseFixture: true,
          specialty: "GENERAL_PHYSICIAN",
          experience: 0,
          fees: 0,
          balance: 0,
          latitude: null,
          longitude: null,
          doctorBio: "Synthetic release fixture. Does not provide medical care.",
        },
      });
      for (const label of ["patient-a", "patient-b"] as const)
        await tx.patient.create({
          data: {
            id: identity.accounts[label].profileId,
            userId: identity.accounts[label].userId,
          },
        });
      await tx.slot.create({
        data: {
          id: identity.slotId,
          doctorId: identity.accounts.doctor.profileId,
          date: startDate(identity),
          startTime: new Date(identity.pastStart),
          endTime: new Date(identity.pastEnd),
          status: "BOOKED",
        },
      });
      await tx.appointment.create({
        data: {
          id: identity.appointmentId,
          doctorId: identity.accounts.doctor.profileId,
          patientId: identity.accounts["patient-a"].profileId,
          slotId: identity.slotId,
          status: "COMPLETED",
          paymentMethod: "OFFLINE",
          isAppointmentOffline: true,
          bookedAt: new Date(identity.pastStart),
          notes: "Synthetic release authorization only; no clinical encounter.",
        },
      });
      requireState((await inspect(tx, identity)) === "reuse");
      return { created: true, ownedRecords: 8 };
    },
    { timeout: 30000, maxWait: 3000 },
  );
}
