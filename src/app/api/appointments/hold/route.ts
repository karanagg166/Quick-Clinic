import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createSlotHold } from "@/lib/booking";
import { getAuthenticatedPatient } from "@/lib/request-auth";

const holdSchema = z.object({
  slotId: z.string().min(1),
  doctorId: z.string().min(1),
});

export async function POST(req: NextRequest) {
  const patient = await getAuthenticatedPatient(req);
  if (!patient) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const body = holdSchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Invalid hold request" }, { status: 400 });

  try {
    const result = await createSlotHold(body.data.slotId, body.data.doctorId, patient.id);
    if (result.kind === "unavailable") {
      return NextResponse.json({ error: "Booking holds are temporarily unavailable" }, { status: 503 });
    }
    if (result.kind === "conflict") {
      return NextResponse.json({ error: "This slot is no longer available" }, { status: 409 });
    }
    return NextResponse.json({ holdToken: result.token, expiresAt: result.expiresAt.toISOString() }, { status: 201 });
  } catch (error) {
    console.error("appointment-hold-error", error);
    return NextResponse.json({ error: "Unable to hold this slot" }, { status: 500 });
  }
}
