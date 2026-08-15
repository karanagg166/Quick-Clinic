import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { cancelSlotHold } from "@/lib/booking";
import { getAuthenticatedPatient } from "@/lib/request-auth";

const cancelSchema = z.object({
  slotId: z.string().min(1),
  holdToken: z.string().uuid(),
});

export async function POST(req: NextRequest) {
  try {
    const patient = await getAuthenticatedPatient(req);
    if (!patient) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

    const rawBody = await req.json().catch(() => null);
    const body = cancelSchema.safeParse(rawBody);
    if (!body.success) return NextResponse.json({ error: "Invalid cancellation request" }, { status: 400 });

    const released = await cancelSlotHold(body.data.slotId, patient.id, body.data.holdToken);
    if (!released) return NextResponse.json({ error: "Hold expired or does not belong to this patient" }, { status: 409 });
    return NextResponse.json({ released: true });
  } catch (error: any) {
    console.error("appointment-cancel-hold-error", error);
    return NextResponse.json({ error: error?.message || "Unable to cancel this hold" }, { status: 500 });
  }
}
