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
  redis ??= new Redis({ url, token });
  return redis;
}

export function bookingSlotKey(slotId: string) {
  return `booking:slot:${slotId}`;
}

async function ownsHold(slotId: string, patientId: string, token: string) {
  const client = getRedis();
  if (!client) return false;
  const value = await client.get<HoldValue>(bookingSlotKey(slotId));
  return value?.patientId === patientId && value.token === token;
}

async function deleteIfOwner(slotId: string, patientId: string, token: string) {
  const client = getRedis();
  if (!client) return;
  const key = bookingSlotKey(slotId);
  if (await ownsHold(slotId, patientId, token)) await client.del(key);
}

export async function expireSlotHolds(slotId?: string) {
  const cutoff = new Date(Date.now() - HOLD_TTL_MS);
  await prisma.slot.updateMany({
    where: {
      ...(slotId ? { id: slotId } : {}),
      status: "HELD",
      heldAt: { lte: cutoff },
    },
    data: { status: "AVAILABLE", heldByPatientId: null, heldAt: null },
  });
}

export async function expireDoctorHolds(doctorId: string) {
  const cutoff = new Date(Date.now() - HOLD_TTL_MS);
  await prisma.slot.updateMany({
    where: { doctorId, status: "HELD", heldAt: { lte: cutoff } },
    data: { status: "AVAILABLE", heldByPatientId: null, heldAt: null },
  });
}

export async function createSlotHold(slotId: string, doctorId: string, patientId: string) {
  await expireSlotHolds(slotId);
  const client = getRedis();
  if (!client) return { kind: "unavailable" as const };

  const token = randomUUID();
  const locked = await client.set(bookingSlotKey(slotId), { patientId, token }, { nx: true, ex: HOLD_TTL_SECONDS });
  if (locked !== "OK") return { kind: "conflict" as const };

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
  if (!(await ownsHold(input.slotId, input.patientId, input.token))) return null;

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
          status: "PENDING",
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
  if (!(await ownsHold(slotId, patientId, token))) return false;

  const released = await prisma.slot.updateMany({
    where: { id: slotId, status: "HELD", heldByPatientId: patientId },
    data: { status: "AVAILABLE", heldByPatientId: null, heldAt: null },
  });
  if (released.count === 1) await deleteIfOwner(slotId, patientId, token);
  return released.count === 1;
}
