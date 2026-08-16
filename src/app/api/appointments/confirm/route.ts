import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAuthenticatedPatient } from "@/lib/request-auth";
import { finalizeAppointmentBooking } from "@/lib/appointment-confirmation";

const confirmSchema = z.object({
  slotId: z.string().min(1),
  doctorId: z.string().min(1),
  holdToken: z.string().uuid(),
  paymentMethod: z.enum(["ONLINE", "OFFLINE"]),
  transactionId: z.string().min(1).nullable().optional(),
});

export async function POST(req: NextRequest) {
  const patient = await getAuthenticatedPatient(req);
  if (!patient) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const body = confirmSchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Invalid confirmation request" }, { status: 400 });
  if (body.data.paymentMethod === "ONLINE" && !body.data.transactionId) {
    return NextResponse.json({ error: "A transaction ID is required for online payment" }, { status: 400 });
  }

  try {
    const appointment = await finalizeAppointmentBooking({
      ...body.data,
      patientId: patient.id,
      patientUserId: patient.userId,
    });
    if (!appointment) return NextResponse.json({ error: "Hold expired or does not belong to this patient" }, { status: 409 });

    return NextResponse.json({ appointment }, { status: 201 });
  } catch (error) {
    console.error("appointment-confirm-error", error);
    return NextResponse.json({ error: "Unable to confirm this appointment" }, { status: 500 });
  }
}
