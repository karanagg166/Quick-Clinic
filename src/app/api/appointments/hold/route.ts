import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createSlotHold } from "@/lib/booking";
import { getAuthenticatedPatient } from "@/lib/request-auth";
import { prisma } from "@/lib/prisma";

const holdSchema = z.object({
  slotId: z.string().min(1),
  doctorId: z.string().min(1),
});

export async function POST(req: NextRequest) {
  try {
    const patient = await getAuthenticatedPatient(req);
    if (!patient) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

    const rawBody = await req.json().catch(() => null);
    const body = holdSchema.safeParse(rawBody);
    if (!body.success) return NextResponse.json({ error: "Invalid hold request" }, { status: 400 });

    // Server-side guard: reject holds on slots whose time has already passed
    const slot = await prisma.slot.findUnique({
      where: { id: body.data.slotId },
      select: { startTime: true },
    });
    if (slot && new Date(slot.startTime) <= new Date()) {
      return NextResponse.json({ error: "This time slot has already passed" }, { status: 400 });
    }

    const result = await createSlotHold(body.data.slotId, body.data.doctorId, patient.id);
    if (result.kind === "conflict") {
      return NextResponse.json({ error: "This slot is no longer available" }, { status: 409 });
    }
    return NextResponse.json({ holdToken: result.token, expiresAt: result.expiresAt.toISOString() }, { status: 201 });
  } catch (error: any) {
    console.error("appointment-hold-error", error);
    return NextResponse.json({ error: error?.message || "Unable to hold this slot" }, { status: 500 });
  }
}
