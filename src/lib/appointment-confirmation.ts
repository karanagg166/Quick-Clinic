import type { Prisma } from '@/generated/prisma';
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

/**
 * Persists all appointment confirmation side effects (chat message, doctor notification,
 * patient notification, and durable outbox intents) inside the caller's transaction.
 */
export async function persistBookingSideEffectsTx(
  tx: Prisma.TransactionClient,
  params: {
    appointmentId: string;
    doctorId: string;
    patientId: string;
    patientUserId: string;
    slotId: string;
    paymentMethod: 'ONLINE' | 'OFFLINE';
  }
): Promise<{ doctorEventId: string; patientEventId: string }> {
  const [doctor, slot, patientUser] = await Promise.all([
    tx.doctor.findUnique({ where: { id: params.doctorId }, include: { user: true } }),
    tx.slot.findUnique({ where: { id: params.slotId } }),
    tx.user.findUnique({ where: { id: params.patientUserId }, include: { location: true } }),
  ]);

  const doctorEventId = `apt:${params.appointmentId}:CONFIRMED:doctor`;
  const patientEventId = `apt:${params.appointmentId}:CONFIRMED:patient`;

  if (!doctor?.user?.id || !patientUser) {
    return { doctorEventId, patientEventId };
  }

  const patientName = patientUser.name || 'Patient';
  const doctorName = doctor.user.name || 'Doctor';
  const formattedDate = slot?.date
    ? new Date(slot.date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
    : 'Scheduled Date';
  const formattedTime = slot?.startTime
    ? new Date(slot.startTime).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })
    : 'Scheduled Time';

  let relation = await tx.doctorPatientRelation.findUnique({
    where: {
      doctorsUserId_patientsUserId: {
        doctorsUserId: doctor.user.id,
        patientsUserId: patientUser.id,
      },
    },
  });
  if (!relation) {
    relation = await tx.doctorPatientRelation.create({
      data: { doctorsUserId: doctor.user.id, patientsUserId: patientUser.id },
    });
  }

  // Idempotent system chat message with stable clientMessageId
  const confirmClientMessageId = `chat:appt_confirm:${params.appointmentId}`;
  const existingChat = await tx.chatMessages.findFirst({
    where: {
      OR: [
        { clientMessageId: confirmClientMessageId },
        { id: confirmClientMessageId },
      ],
    },
  });
  if (!existingChat) {
    await tx.chatMessages.create({
      data: {
        id: confirmClientMessageId,
        clientMessageId: confirmClientMessageId,
        doctorPatientRelationId: relation.id,
        text: `✅ Appointment Confirmed!\n\n📅 Date: ${formattedDate}\n⏰ Time: ${formattedTime}\n👨‍⚕️ Doctor: Dr. ${doctorName}\n👤 Patient: ${patientName}\n💳 Payment: ${params.paymentMethod === 'ONLINE' ? 'Paid Online' : 'Pay at Clinic'}\n\n👉 If you need to cancel this appointment:\n[🔴 Cancel Appointment](/patient/appointments/${params.appointmentId})`,
        senderId: patientUser.id,
      },
    }).catch(() => undefined);
  }

  const [doctorNotification, patientNotification] = await Promise.all([
    tx.notification.upsert({
      where: { userId_eventId: { userId: doctor.user.id, eventId: doctorEventId } },
      update: {},
      create: {
        userId: doctor.user.id,
        eventId: doctorEventId,
        message: `New appointment confirmed with ${patientName} on ${formattedDate} at ${formattedTime}.`,
        actionHref: `/doctor/appointments/${params.appointmentId}`,
        actionLabel: 'View appointment',
      },
    }),
    tx.notification.upsert({
      where: { userId_eventId: { userId: patientUser.id, eventId: patientEventId } },
      update: {},
      create: {
        userId: patientUser.id,
        eventId: patientEventId,
        message: `Your appointment with Dr. ${doctorName} is confirmed for ${formattedDate} at ${formattedTime}.`,
        actionHref: `/patient/appointments/${params.appointmentId}`,
        actionLabel: 'View appointment',
      },
    }),
  ]);

  const appointmentPayload = {
    id: params.appointmentId,
    patientName,
    patientString: patientUser.email || '',
    gender: patientUser.gender || '',
    city: patientUser.location?.city || 'N/A',
    age: patientUser.age || 0,
    appointmentDate: slot?.date?.toISOString() || '',
    appointmentTime: slot?.startTime?.toISOString() || '',
    status: 'CONFIRMED',
    paymentMethod: params.paymentMethod,
  };

  // Atomically insert durable outbox intents in the same database transaction
  await Promise.all([
    tx.notificationOutbox.upsert({
      where: { eventId: doctorEventId },
      update: {},
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
    }),
    tx.notificationOutbox.upsert({
      where: { eventId: patientEventId },
      update: {},
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
    }),
  ]);

  return { doctorEventId, patientEventId };
}

/**
 * Dispatches pending outbox events asynchronously to Socket.IO server.
 * Uses canonical endpoint /api/notifications/new-appointment for appointment requests.
 */
export async function dispatchPendingOutboxEvents(eventIds: string[]) {
  if (!eventIds.length) return;
  try {
    const items = await prisma.notificationOutbox.findMany({
      where: { eventId: { in: eventIds }, status: 'PENDING' },
    });

    await Promise.allSettled(
      items.map(async (item) => {
        const payload = item.payload as any;
        const endpoint =
          item.channel === 'SOCKET_APPOINTMENT_REQUEST'
            ? '/api/notifications/new-appointment'
            : '/api/notifications/broadcast';

        const res = await publishToSocketServer(endpoint, payload);
        if (res !== null) {
          await prisma.notificationOutbox.update({
            where: { id: item.id },
            data: { status: 'DELIVERED', deliveredAt: new Date() },
          }).catch(() => undefined);
        } else {
          await prisma.notificationOutbox.update({
            where: { id: item.id },
            data: {
              attempts: { increment: 1 },
              lastAttemptAt: new Date(),
              lastError: 'Socket server returned null or connection error',
            },
          }).catch(() => undefined);
        }
      })
    );
  } catch (error) {
    console.warn('[dispatchPendingOutboxEvents] delivery warning:', error);
  }
}

export async function finalizeAppointmentBooking(input: ConfirmationInput) {
  // If appointment already exists (e.g. booked in Transaction 1 or 2):
  const existing = await prisma.appointment.findFirst({
    where: {
      slotId: input.slotId,
      status: { in: ['PENDING', 'CONFIRMED', 'COMPLETED', 'NO_SHOW'] },
    },
  });

  let appointment = existing;
  if (!appointment) {
    appointment = await confirmSlotHold({
      slotId: input.slotId,
      doctorId: input.doctorId,
      patientId: input.patientId,
      token: input.holdToken,
      paymentMethod: input.paymentMethod,
      transactionId: input.transactionId,
      paymentId: input.paymentId,
    });
  }

  if (!appointment) return null;

  await logAudit(input.patientUserId, 'Booked Appointment', {
    appointmentId: appointment.id,
    doctorId: input.doctorId,
    slotId: input.slotId,
  });

  const eventIds = await prisma.$transaction(async (tx) => {
    return persistBookingSideEffectsTx(tx, {
      appointmentId: appointment!.id,
      doctorId: input.doctorId,
      patientId: input.patientId,
      patientUserId: input.patientUserId,
      slotId: input.slotId,
      paymentMethod: input.paymentMethod,
    });
  });

  void dispatchPendingOutboxEvents([eventIds.doctorEventId, eventIds.patientEventId]);

  return appointment;
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
