import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { confirmSlotHold } from "@/lib/booking";
import { getAuthenticatedPatient } from "@/lib/request-auth";
import { logAudit } from "@/lib/logger";
import { prisma } from "@/lib/prisma";

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
    const appointment = await confirmSlotHold({ ...body.data, patientId: patient.id, token: body.data.holdToken });
    if (!appointment) return NextResponse.json({ error: "Hold expired or does not belong to this patient" }, { status: 409 });
    await logAudit(patient.userId, "Booked Appointment", {
      appointmentId: appointment.id,
      doctorId: body.data.doctorId,
      slotId: body.data.slotId,
    });

    // Notify doctor of new pending appointment request
    try {
      const doctor = await prisma.doctor.findUnique({
        where: { id: body.data.doctorId },
        include: { user: true },
      });
      const slot = await prisma.slot.findUnique({
        where: { id: body.data.slotId },
      });
      const patientUser = await prisma.user.findUnique({
        where: { id: patient.userId },
        include: { location: true },
      });

      if (doctor?.user?.id) {
        const patientName = patientUser?.name || "A patient";
        const apptDate = slot?.date ? new Date(slot.date).toISOString().split('T')[0] : "";
        await prisma.notification.create({
          data: {
            userId: doctor.user.id,
            message: `New appointment request received from ${patientName} on ${apptDate}. Please review and confirm.`,
          },
        });

        const socketServerUrl = process.env.NEXT_PUBLIC_SOCKET_URL || process.env.SOCKET_SERVER_URL || 'http://localhost:4000';
        await fetch(`${socketServerUrl}/api/notifications/new-appointment`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            doctorUserId: doctor.user.id,
            appointmentId: appointment.id,
            appointment: {
              id: appointment.id,
              patientName: patientUser?.name || "Patient",
              patientString: patientUser?.email || "",
              gender: patientUser?.gender || "",
              city: patientUser?.location?.city || "N/A",
              age: patientUser?.age || 0,
              appointmentDate: slot?.date?.toISOString() || "",
              appointmentTime: slot?.startTime?.toISOString() || "",
              status: "PENDING",
              paymentMethod: appointment.paymentMethod,
            },
          }),
        }).catch(() => {});
      }
    } catch (e) {
      console.warn("Non-critical notification failed:", e);
    }

    return NextResponse.json({ appointment }, { status: 201 });
  } catch (error) {
    console.error("appointment-confirm-error", error);
    return NextResponse.json({ error: "Unable to confirm this appointment" }, { status: 500 });
  }
}
