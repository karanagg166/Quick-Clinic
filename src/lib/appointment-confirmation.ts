import { confirmSlotHold } from '@/lib/booking';
import { logAudit } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { publishToSocketServer } from '@/lib/socket-publisher';

type ConfirmationInput = {
  slotId: string;
  doctorId: string;
  patientId: string;
  patientUserId: string;
  holdToken: string;
  paymentMethod: 'ONLINE' | 'OFFLINE';
  transactionId?: string | null;
  paymentId?: string | null;
};

export async function finalizeAppointmentBooking(input: ConfirmationInput) {
  const appointment = await confirmSlotHold({
    slotId: input.slotId,
    doctorId: input.doctorId,
    patientId: input.patientId,
    token: input.holdToken,
    paymentMethod: input.paymentMethod,
    transactionId: input.transactionId,
    paymentId: input.paymentId,
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

    // Idempotent system chat message with stable clientMessageId
    const confirmClientMessageId = `chat:appt_confirm:${appointment.id}`;
    const existingChat = await prisma.chatMessages.findFirst({
      where: {
        OR: [
          { clientMessageId: confirmClientMessageId },
          { id: confirmClientMessageId },
        ],
      },
    });
    if (!existingChat) {
      await prisma.chatMessages.create({
        data: {
          id: confirmClientMessageId,
          clientMessageId: confirmClientMessageId,
          doctorPatientRelationId: relation.id,
          text: `✅ Appointment Confirmed!\n\n📅 Date: ${formattedDate}\n⏰ Time: ${formattedTime}\n👨‍⚕️ Doctor: Dr. ${doctorName}\n👤 Patient: ${patientName}\n💳 Payment: ${appointment.paymentMethod === 'ONLINE' ? 'Paid Online' : 'Pay at Clinic'}\n\n👉 If you need to cancel this appointment:\n[🔴 Cancel Appointment](/patient/appointments/${appointment.id})`,
          senderId: patientUser.id,
        },
      }).catch(() => undefined);
    }

    const doctorEventId = `apt:${appointment.id}:CONFIRMED:doctor`;
    const patientEventId = `apt:${appointment.id}:CONFIRMED:patient`;

    const [doctorNotification, patientNotification] = await Promise.all([
      prisma.notification.upsert({
        where: { userId_eventId: { userId: doctor.user.id, eventId: doctorEventId } },
        update: {},
        create: {
          userId: doctor.user.id,
          eventId: doctorEventId,
          message: `New appointment confirmed with ${patientName} on ${formattedDate} at ${formattedTime}.`,
          actionHref: `/doctor/appointments/${appointment.id}`,
          actionLabel: 'View appointment',
        },
      }),
      prisma.notification.upsert({
        where: { userId_eventId: { userId: patientUser.id, eventId: patientEventId } },
        update: {},
        create: {
          userId: patientUser.id,
          eventId: patientEventId,
          message: `Your appointment with Dr. ${doctorName} is confirmed for ${formattedDate} at ${formattedTime}.`,
          actionHref: `/patient/appointments/${appointment.id}`,
          actionLabel: 'View appointment',
        },
      }),
    ]);

    const appointmentPayload = {
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
    };

    const doctorBroadcastPromise = publishToSocketServer('/api/notifications/new-appointment', {
      doctorUserId: doctor.user.id,
      notification: serializeNotification(doctorNotification),
      appointment: appointmentPayload,
    });
    const patientBroadcastPromise = publishToSocketServer('/api/notifications/broadcast', {
      userId: patientUser.id,
      notification: serializeNotification(patientNotification),
    });

    const [doctorRes, patientRes] = await Promise.allSettled([doctorBroadcastPromise, patientBroadcastPromise]);

    // Durable outbox fallback: queue if socket server is unreachable
    if (doctorRes.status === 'rejected' || (doctorRes.status === 'fulfilled' && !doctorRes.value)) {
      await prisma.notificationOutbox.upsert({
        where: { eventId: doctorEventId },
        update: { attempts: { increment: 1 }, lastAttemptAt: new Date() },
        create: {
          eventId: doctorEventId,
          channel: 'SOCKET_APPOINTMENT_REQUEST',
          targetUserId: doctor.user.id,
          payload: {
            doctorUserId: doctor.user.id,
            notification: serializeNotification(doctorNotification),
            appointment: appointmentPayload,
          },
          status: 'PENDING',
        },
      }).catch(() => undefined);
    }

    if (patientRes.status === 'rejected' || (patientRes.status === 'fulfilled' && !patientRes.value)) {
      await prisma.notificationOutbox.upsert({
        where: { eventId: patientEventId },
        update: { attempts: { increment: 1 }, lastAttemptAt: new Date() },
        create: {
          eventId: patientEventId,
          channel: 'SOCKET_NOTIFICATION',
          targetUserId: patientUser.id,
          payload: {
            userId: patientUser.id,
            notification: serializeNotification(patientNotification),
          },
          status: 'PENDING',
        },
      }).catch(() => undefined);
    }
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
