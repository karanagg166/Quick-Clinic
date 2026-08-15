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

    // Notify doctor & patient in database, chat, and sockets
    try {
      const [doctor, slot, patientUser] = await Promise.all([
        prisma.doctor.findUnique({
          where: { id: body.data.doctorId },
          include: { user: true },
        }),
        prisma.slot.findUnique({
          where: { id: body.data.slotId },
        }),
        prisma.user.findUnique({
          where: { id: patient.userId },
          include: { location: true },
        }),
      ]);

      if (doctor?.user?.id && patientUser) {
        const patientName = patientUser.name || "Patient";
        const doctorName = doctor.user.name || "Doctor";
        const formattedDate = slot?.date
          ? new Date(slot.date).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" })
          : "Scheduled Date";
        const formattedTime = slot?.startTime
          ? new Date(slot.startTime).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })
          : "Scheduled Time";

        // 1. Ensure DoctorPatientRelation exists
        let relation = await prisma.doctorPatientRelation.findUnique({
          where: {
            doctorsUserId_patientsUserId: {
              doctorsUserId: doctor.user.id,
              patientsUserId: patientUser.id,
            },
          },
        });

        if (!relation) {
          relation = await prisma.doctorPatientRelation.create({
            data: {
              doctorsUserId: doctor.user.id,
              patientsUserId: patientUser.id,
            },
          });
        }

        // 2. Post automated confirmation message in Chat
        const chatText = `✅ Appointment Confirmed!\n\n📅 Date: ${formattedDate}\n⏰ Time: ${formattedTime}\n👨‍⚕️ Doctor: Dr. ${doctorName}\n👤 Patient: ${patientName}\n💳 Payment: ${appointment.paymentMethod === 'ONLINE' ? 'Paid Online' : 'Pay at Clinic'}\n\n👉 If you need to cancel this appointment:\n[🔴 Cancel Appointment](/patient/appointments/${appointment.id})`;

        await prisma.chatMessages.create({
          data: {
            doctorPatientRelationId: relation.id,
            text: chatText,
            senderId: patientUser.id,
          },
        });

        // 3. Create Notifications for Doctor and Patient in parallel
        const [doctorNotification, patientNotification] = await Promise.all([
          prisma.notification.create({
            data: {
              userId: doctor.user.id,
              message: `New appointment confirmed with ${patientName} on ${formattedDate} at ${formattedTime}.`,
              actionHref: `/doctor/appointments/${appointment.id}`,
              actionLabel: "View appointment",
            },
          }),
          prisma.notification.create({
            data: {
              userId: patientUser.id,
              message: `Your appointment with Dr. ${doctorName} is confirmed for ${formattedDate} at ${formattedTime}.`,
              actionHref: `/patient/appointments/${appointment.id}`,
              actionLabel: "View appointment",
            },
          }),
        ]);

        // 5. Send real-time updates via Socket Server
        const socketServerUrl = process.env.NEXT_PUBLIC_SOCKET_URL || process.env.SOCKET_SERVER_URL || 'http://localhost:4000';
        
        // Notify doctor via socket
        fetch(`${socketServerUrl}/api/notifications/new-appointment`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            doctorUserId: doctor.user.id,
            notification: {
              id: doctorNotification.id,
              message: doctorNotification.message,
              actionHref: doctorNotification.actionHref,
              actionLabel: doctorNotification.actionLabel,
              createdAt: doctorNotification.createdAt.toISOString(),
              isRead: doctorNotification.isRead,
            },
            appointmentId: appointment.id,
            appointment: {
              id: appointment.id,
              patientName,
              patientString: patientUser.email || "",
              gender: patientUser.gender || "",
              city: patientUser.location?.city || "N/A",
              age: patientUser.age || 0,
              appointmentDate: slot?.date?.toISOString() || "",
              appointmentTime: slot?.startTime?.toISOString() || "",
              status: "CONFIRMED",
              paymentMethod: appointment.paymentMethod,
            },
          }),
        }).catch(() => {});

        // Notify patient via socket
        fetch(`${socketServerUrl}/api/notifications/broadcast`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: patientUser.id,
            notification: {
              id: patientNotification.id,
              message: patientNotification.message,
              actionHref: patientNotification.actionHref,
              actionLabel: patientNotification.actionLabel,
              createdAt: patientNotification.createdAt.toISOString(),
              isRead: patientNotification.isRead,
            },
          }),
        }).catch(() => {});
      }
    } catch (e) {
      console.warn("Non-critical chat/notification delivery warning:", e);
    }

    return NextResponse.json({ appointment }, { status: 201 });
  } catch (error) {
    console.error("appointment-confirm-error", error);
    return NextResponse.json({ error: "Unable to confirm this appointment" }, { status: 500 });
  }
}
