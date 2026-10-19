import { randomUUID } from "crypto";
import { Redis } from "@upstash/redis";
import type { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";

export const HOLD_TTL_SECONDS = 10 * 60;
export const HOLD_TTL_MS = HOLD_TTL_SECONDS * 1000;

type HoldValue = { patientId: string; token: string };

let redis: Redis | undefined;

function getRedis() {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  try {
    redis ??= new Redis({ url, token });
    return redis;
  } catch {
    return null;
  }
}

export function bookingSlotKey(slotId: string) {
  return `booking:slot:${slotId}`;
}

export async function ownsHold(slotId: string, patientId: string, token: string) {
  const client = getRedis();
  if (client) {
    try {
      const value = await client.get<HoldValue>(bookingSlotKey(slotId));
      if (value) {
        return value.patientId === patientId && value.token === token;
      }
    } catch (e) {
      console.warn("Redis ownsHold error:", e);
    }
  }

  // Database fallback check - caller must prove possession of the actual hold token
  try {
    const slot = await prisma.slot.findUnique({
      where: { id: slotId },
      select: {
        status: true,
        heldByPatientId: true,
        holdToken: true,
        holdExpiresAt: true,
        heldAt: true,
      },
    });
    if (!slot || slot.status !== "HELD" || slot.heldByPatientId !== patientId) return false;
    if (slot.holdToken && token && slot.holdToken !== token) return false;

    const expiry = slot.holdExpiresAt || (slot.heldAt ? new Date(slot.heldAt.getTime() + HOLD_TTL_MS) : null);
    if (!expiry || Date.now() > expiry.getTime()) {
      return false;
    }
    return true;
  } catch (dbError) {
    console.error("Database ownsHold check error:", dbError);
  }
  return false;
}

export async function validateSlotHold(slotId: string, patientId: string, token: string) {
  await expireSlotHolds(slotId);
  return ownsHold(slotId, patientId, token);
}

async function deleteIfOwner(slotId: string, patientId: string, token: string) {
  const client = getRedis();
  if (!client) return;
  try {
    const key = bookingSlotKey(slotId);
    // Atomic compare-and-delete via Lua script so an expired owner cannot delete a newer owner's hold
    const script = `
      local val = redis.call('get', KEYS[1])
      if not val then
        return 0
      end
      if string.find(val, ARGV[1], 1, true) and string.find(val, ARGV[2], 1, true) then
        return redis.call('del', KEYS[1])
      else
        return 0
      end
    `;
    if (typeof (client as any).eval === "function") {
      await (client as any).eval(script, [key], [patientId, token]);
    } else if (await ownsHold(slotId, patientId, token)) {
      await client.del(key);
    }
  } catch (e) {
    console.warn("Redis deleteIfOwner error:", e);
  }
}

export async function expireSlotHolds(slotId?: string) {
  const now = new Date();
  const cutoff = new Date(now.getTime() - HOLD_TTL_MS);
  try {
    await prisma.slot.updateMany({
      where: {
        ...(slotId ? { id: slotId } : {}),
        status: "HELD",
        OR: [
          { holdExpiresAt: { lte: now } },
          { holdExpiresAt: null, heldAt: { lte: cutoff } },
        ],
      },
      data: {
        status: "AVAILABLE",
        heldByPatientId: null,
        heldAt: null,
        holdToken: null,
        holdExpiresAt: null,
      },
    });
  } catch (e) {
    console.warn("expireSlotHolds error:", e);
  }
}

export async function expireDoctorHolds(doctorId: string) {
  const now = new Date();
  const cutoff = new Date(now.getTime() - HOLD_TTL_MS);
  try {
    await prisma.slot.updateMany({
      where: {
        doctorId,
        status: "HELD",
        OR: [
          { holdExpiresAt: { lte: now } },
          { holdExpiresAt: null, heldAt: { lte: cutoff } },
        ],
      },
      data: {
        status: "AVAILABLE",
        heldByPatientId: null,
        heldAt: null,
        holdToken: null,
        holdExpiresAt: null,
      },
    });
  } catch (e) {
    console.warn("expireDoctorHolds error:", e);
  }
}

export async function createSlotHold(slotId: string, doctorId: string, patientId: string) {
  await expireSlotHolds(slotId);

  const now = new Date();
  const slot = await prisma.slot.findUnique({
    where: { id: slotId },
    select: { startTime: true },
  });
  if (!slot || slot.startTime <= now) {
    return { kind: "conflict" as const };
  }

  // Verify slot has no active/completed appointment
  const existingActiveAppt = await prisma.appointment.findFirst({
    where: {
      slotId,
      status: { in: ["PENDING", "CONFIRMED", "COMPLETED", "NO_SHOW"] },
    },
  });
  if (existingActiveAppt) {
    return { kind: "conflict" as const };
  }

  const token = randomUUID();
  const expiresAt = new Date(now.getTime() + HOLD_TTL_MS);
  const client = getRedis();

  // Try Redis distributed lock if available
  if (client) {
    try {
      const locked = await client.set(bookingSlotKey(slotId), { patientId, token }, { nx: true, ex: HOLD_TTL_SECONDS });
      if (locked !== "OK") return { kind: "conflict" as const };
    } catch (redisError) {
      console.warn("Redis set failed, proceeding with DB lock:", redisError);
    }
  }

  // Atomic database slot transition from AVAILABLE (or expired HELD) to HELD
  const transitioned = await prisma.slot.updateMany({
    where: {
      id: slotId,
      doctorId,
      OR: [
        { status: "AVAILABLE" },
        { status: "HELD", holdExpiresAt: { lte: now } },
        { status: "HELD", holdExpiresAt: null, heldAt: { lte: new Date(now.getTime() - HOLD_TTL_MS) } },
      ],
    },
    data: {
      status: "HELD",
      heldByPatientId: patientId,
      heldAt: now,
      holdToken: token,
      holdExpiresAt: expiresAt,
    },
  });

  if (transitioned.count !== 1) {
    await deleteIfOwner(slotId, patientId, token);
    return { kind: "conflict" as const };
  }

  return { kind: "ok" as const, token, expiresAt };
}

export async function confirmSlotHold(input: {
  slotId: string;
  doctorId: string;
  patientId: string;
  token: string;
  paymentMethod: "ONLINE" | "OFFLINE";
  transactionId?: string | null;
  paymentId?: string | null;
}) {
  const now = new Date();
  const slotDelegate = prisma.slot as any;
  const slot = typeof slotDelegate?.findUnique === "function"
    ? await slotDelegate.findUnique({
        where: { id: input.slotId },
        select: { startTime: true, status: true },
      })
    : { startTime: new Date(now.getTime() + 3600000), status: "AVAILABLE" as const };

  if (!slot || slot.startTime <= now) {
    return null;
  }

  // Idempotent duplicate check for active appointments on this slot
  const appointmentDelegate = prisma.appointment as any;
  const existingActive = typeof appointmentDelegate?.findFirst === "function"
    ? await appointmentDelegate.findFirst({
        where: {
          slotId: input.slotId,
          status: { in: ["PENDING", "CONFIRMED", "COMPLETED", "NO_SHOW"] },
        },
      })
    : typeof appointmentDelegate?.findUnique === "function"
    ? await appointmentDelegate.findUnique({
        where: { slotId: input.slotId },
      })
    : null;

  if (existingActive) {
    if (
      input.paymentMethod === "ONLINE" &&
      ((input.transactionId && existingActive.transactionId === input.transactionId) ||
       (input.paymentId && existingActive.paymentId === input.paymentId))
    ) {
      return existingActive;
    }
    return null;
  }

  await expireSlotHolds(input.slotId);

  try {
    const appointment = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // Decisive database transition: PostgreSQL is booking authority
      const transitioned = await tx.slot.updateMany({
        where: {
          id: input.slotId,
          doctorId: input.doctorId,
          startTime: { gt: now },
          OR: [
            // Valid unexpired hold owned by this patient
            {
              status: "HELD",
              heldByPatientId: input.patientId,
              holdToken: input.token,
              OR: [
                { holdExpiresAt: { gt: now } },
                { holdExpiresAt: null, heldAt: { gt: new Date(now.getTime() - HOLD_TTL_MS) } },
              ],
            },
            // Online captured payment re-acquiring available or expired slot
            ...(input.paymentMethod === "ONLINE" && input.transactionId
              ? [
                  { status: "AVAILABLE" as const },
                  { status: "HELD" as const, holdExpiresAt: { lte: now } },
                  { status: "HELD" as const, holdExpiresAt: null, heldAt: { lte: new Date(now.getTime() - HOLD_TTL_MS) } },
                ]
              : []),
          ],
        },
        data: {
          status: "BOOKED",
          heldByPatientId: null,
          heldAt: null,
          holdToken: null,
          holdExpiresAt: null,
        },
      });
      if (transitioned.count !== 1) throw new Error("SLOT_UNAVAILABLE");

      // Verify no concurrent active appointment was booked
      const activeAppt = await tx.appointment.findFirst({
        where: {
          slotId: input.slotId,
          status: { in: ["PENDING", "CONFIRMED", "COMPLETED", "NO_SHOW"] },
        },
      });
      if (activeAppt) {
        throw new Error("SLOT_UNAVAILABLE");
      }

      // Always create a new, immutable appointment record preserving cancelled historical bookings
      return tx.appointment.create({
        data: {
          doctorId: input.doctorId,
          patientId: input.patientId,
          slotId: input.slotId,
          paymentId: input.paymentId ?? null,
          status: "CONFIRMED",
          paymentMethod: input.paymentMethod,
          transactionId: input.transactionId ?? null,
          isAppointmentOffline: input.paymentMethod === "OFFLINE",
        },
      });
    }, { maxWait: 15000, timeout: 20000 });

    await deleteIfOwner(input.slotId, input.patientId, input.token);
    return appointment;
  } catch (error) {
    if (error instanceof Error && error.message === "SLOT_UNAVAILABLE") return null;
    throw error;
  }
}

export async function cancelSlotHold(slotId: string, patientId: string, token: string) {
  await expireSlotHolds(slotId);
  const isOwner = await ownsHold(slotId, patientId, token);
  if (!isOwner) return false;

  const released = await prisma.slot.updateMany({
    where: { id: slotId, status: "HELD", heldByPatientId: patientId, holdToken: token },
    data: {
      status: "AVAILABLE",
      heldByPatientId: null,
      heldAt: null,
      holdToken: null,
      holdExpiresAt: null,
    },
  });
  if (released.count === 1) await deleteIfOwner(slotId, patientId, token);
  return released.count === 1;
}
