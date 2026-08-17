import { confirmSlotHold } from '@/lib/booking';
import { logAudit } from '@/lib/logger';
import { prisma } from '@/lib/prisma';

type ConfirmationInput = {
  slotId: string;
  doctorId: string;
  patientId: string;
  patientUserId: string;
  holdToken: string;
  paymentMethod: 'ONLINE' | 'OFFLINE';
  transactionId?: string | null;
};

export async function finalizeAppointmentBooking(input: ConfirmationInput) {
  const appointment = await confirmSlotHold({
    slotId: input.slotId,
    doctorId: input.doctorId,
    patientId: input.patientId,
    token: input.holdToken,
    paymentMethod: input.paymentMethod,
    transactionId: input.transactionId,
  });
  if (!appointment) return null;

  await logAudit(input.patientUserId, 'Booked Appointment', {
    appointmentId: appointment.id,
    doctorId: input.doctorId,
    slotId: input.slotId,
  });

  await sendAppointmentConfirmation({
    appointment,
    doctorId: input.doctorId,
    slotId: input.slotId,
    patientUserId: input.patientUserId,
  });

  return appointment;
}

async function sendAppointmentConfirmation({
  appointment,
  doctorId,
  slotId,
  patientUserId,
}: {
  appointment: { id: string; paymentMethod: string };
  doctorId: string;
  slotId: string;
  patientUserId: string;
}) {
  try {
    const [doctor, slot, patientUser] = await Promise.all([
      prisma.doctor.findUnique({ where: { id: doctorId }, include: { user: true } }),
      prisma.slot.findUnique({ where: { id: slotId } }),
      prisma.user.findUnique({ where: { id: patientUserId }, include: { location: true } }),
    ]);
    if (!doctor?.user?.id || !patientUser) return;

    const patientName = patientUser.name || 'Patient';
    const doctorName = doctor.user.name || 'Doctor';
    const formattedDate = slot?.date
      ? new Date(slot.date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
      : 'Scheduled Date';
    const formattedTime = slot?.startTime
      ? new Date(slot.startTime).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })
      : 'Scheduled Time';

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
        data: { doctorsUserId: doctor.user.id, patientsUserId: patientUser.id },
      });
    }

    await prisma.chatMessages.create({
      data: {
        doctorPatientRelationId: relation.id,
        text: `✅ Appointment Confirmed!\n\n📅 Date: ${formattedDate}\n⏰ Time: ${formattedTime}\n👨‍⚕️ Doctor: Dr. ${doctorName}\n👤 Patient: ${patientName}\n💳 Payment: ${appointment.paymentMethod === 'ONLINE' ? 'Paid Online' : 'Pay at Clinic'}\n\n👉 If you need to cancel this appointment:\n[🔴 Cancel Appointment](/patient/appointments/${appointment.id})`,
        senderId: patientUser.id,
      },
    });

    const [doctorNotification, patientNotification] = await Promise.all([
      prisma.notification.create({
        data: {
          userId: doctor.user.id,
          message: `New appointment confirmed with ${patientName} on ${formattedDate} at ${formattedTime}.`,
          actionHref: `/doctor/appointments/${appointment.id}`,
          actionLabel: 'View appointment',
        },
      }),
      prisma.notification.create({
        data: {
          userId: patientUser.id,
          message: `Your appointment with Dr. ${doctorName} is confirmed for ${formattedDate} at ${formattedTime}.`,
          actionHref: `/patient/appointments/${appointment.id}`,
          actionLabel: 'View appointment',
        },
      }),
    ]);

    const socketServerUrl = process.env.NEXT_PUBLIC_SOCKET_URL || process.env.SOCKET_SERVER_URL || 'http://localhost:4000';
    const doctorBroadcast = fetch(`${socketServerUrl}/api/notifications/new-appointment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        doctorUserId: doctor.user.id,
        notification: serializeNotification(doctorNotification),
        appointment: {
          id: appointment.id,
          patientName,
          patientString: patientUser.email || '',
          gender: patientUser.gender || '',
          city: patientUser.location?.city || 'N/A',
          age: patientUser.age || 0,
          appointmentDate: slot?.date?.toISOString() || '',
          appointmentTime: slot?.startTime?.toISOString() || '',
          status: 'CONFIRMED',
          paymentMethod: appointment.paymentMethod,
        },
      }),
    });
    const patientBroadcast = fetch(`${socketServerUrl}/api/notifications/broadcast`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: patientUser.id,
        notification: serializeNotification(patientNotification),
      }),
    });
    await Promise.allSettled([doctorBroadcast, patientBroadcast]);
  } catch (error) {
    console.warn('Non-critical chat/notification delivery warning:', error);
  }
}

function serializeNotification(notification: {
  id: string;
  message: string;
  actionHref: string | null;
  actionLabel: string | null;
  createdAt: Date;
  isRead: boolean;
}) {
  return {
    id: notification.id,
    message: notification.message,
    actionHref: notification.actionHref,
    actionLabel: notification.actionLabel,
    createdAt: notification.createdAt.toISOString(),
    isRead: notification.isRead,
  };
}
