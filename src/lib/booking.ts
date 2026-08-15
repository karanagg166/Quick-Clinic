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

async function ownsHold(slotId: string, patientId: string, token: string) {
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

  // Database fallback check
  try {
    const slot = await prisma.slot.findUnique({
      where: { id: slotId },
    });
    if (!slot) return false;
    if (slot.status === "HELD" && slot.heldByPatientId === patientId) {
      if (slot.heldAt && Date.now() - slot.heldAt.getTime() <= HOLD_TTL_MS) {
        return true;
      }
    }
  } catch (dbError) {
    console.error("Database ownsHold check error:", dbError);
  }
  return false;
}

async function deleteIfOwner(slotId: string, patientId: string, token: string) {
  const client = getRedis();
  if (!client) return;
  try {
    const key = bookingSlotKey(slotId);
    if (await ownsHold(slotId, patientId, token)) await client.del(key);
  } catch (e) {
    console.warn("Redis deleteIfOwner error:", e);
  }
}

export async function expireSlotHolds(slotId?: string) {
  const cutoff = new Date(Date.now() - HOLD_TTL_MS);
  try {
    await prisma.slot.updateMany({
      where: {
        ...(slotId ? { id: slotId } : {}),
        status: "HELD",
        heldAt: { lte: cutoff },
      },
      data: { status: "AVAILABLE", heldByPatientId: null, heldAt: null },
    });
  } catch (e) {
    console.warn("expireSlotHolds error:", e);
  }
}

export async function expireDoctorHolds(doctorId: string) {
  const cutoff = new Date(Date.now() - HOLD_TTL_MS);
  try {
    await prisma.slot.updateMany({
      where: { doctorId, status: "HELD", heldAt: { lte: cutoff } },
      data: { status: "AVAILABLE", heldByPatientId: null, heldAt: null },
    });
  } catch (e) {
    console.warn("expireDoctorHolds error:", e);
  }
}

export async function createSlotHold(slotId: string, doctorId: string, patientId: string) {
  await expireSlotHolds(slotId);

  const token = randomUUID();
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

  // Atomic database slot transition from AVAILABLE to HELD
  const transitioned = await prisma.slot.updateMany({
    where: { id: slotId, doctorId, status: "AVAILABLE" },
    data: { status: "HELD", heldByPatientId: patientId, heldAt: new Date() },
  });

  if (transitioned.count !== 1) {
    await deleteIfOwner(slotId, patientId, token);
    return { kind: "conflict" as const };
  }

  return { kind: "ok" as const, token, expiresAt: new Date(Date.now() + HOLD_TTL_MS) };
}

export async function confirmSlotHold(input: {
  slotId: string;
  doctorId: string;
  patientId: string;
  token: string;
  paymentMethod: "ONLINE" | "OFFLINE";
  transactionId?: string | null;
}) {
  await expireSlotHolds(input.slotId);
  const isOwner = await ownsHold(input.slotId, input.patientId, input.token);
  if (!isOwner) return null;

  try {
    const appointment = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const transitioned = await tx.slot.updateMany({
        where: {
          id: input.slotId,
          doctorId: input.doctorId,
          status: "HELD",
          heldByPatientId: input.patientId,
        },
        data: { status: "BOOKED", heldByPatientId: null, heldAt: null },
      });
      if (transitioned.count !== 1) throw new Error("SLOT_UNAVAILABLE");

      return tx.appointment.create({
        data: {
          doctorId: input.doctorId,
          patientId: input.patientId,
          slotId: input.slotId,
          status: "CONFIRMED",
          paymentMethod: input.paymentMethod,
          transactionId: input.transactionId ?? null,
          isAppointmentOffline: input.paymentMethod === "OFFLINE",
        },
      });
    });
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
    where: { id: slotId, status: "HELD", heldByPatientId: patientId },
    data: { status: "AVAILABLE", heldByPatientId: null, heldAt: null },
  });
  if (released.count === 1) await deleteIfOwner(slotId, patientId, token);
  return released.count === 1;
}
