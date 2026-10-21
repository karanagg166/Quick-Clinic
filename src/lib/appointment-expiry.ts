import { prisma } from "@/lib/prisma";
import { publishToSocketServer } from "@/lib/socket-publisher";
import { dispatchPendingOutboxEvents } from "@/lib/appointment-confirmation";

let lastAutoExpireRun = 0;
const AUTO_EXPIRE_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes

export async function autoExpirePastAppointments(force = false) {
  const now = Date.now();
  // Vitest can run inside the development container where NODE_ENV remains
  // "development". Background expiry is disabled in tests; cron tests opt in
  // with `force` so route mocks do not receive unrelated writes.
  const isTestEnvironment = process.env.NODE_ENV === "test" || Boolean(process.env.VITEST);
  if (isTestEnvironment && !force) {
    return { expired: 0, refunded: 0, refundFailed: 0 };
  }
  if (!force && !isTestEnvironment && now - lastAutoExpireRun < AUTO_EXPIRE_COOLDOWN_MS) {
    return { expired: 0, refunded: 0, refundFailed: 0 };
  }
  lastAutoExpireRun = now;
  try {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    // Find all PENDING and CONFIRMED appointments whose slot date is in the past (batched to 50 for safety)
    const expiredAppointments = await prisma.appointment.findMany({
      where: {
        status: {
          in: ["PENDING", "CONFIRMED"],
        },
        slot: {
          date: {
            lt: today,
          },
        },
      },
      include: {
        slot: true,
        patient: {
          include: { user: true },
        },
        doctor: {
          include: { user: true },
        },
      },
      take: 50,
    });

    if (expiredAppointments.length === 0) {
      return { expired: 0, refunded: 0, refundFailed: 0 };
    }

    let expiredCount = 0;
    let refundedCount = 0;
    let refundFailedCount = 0;

    for (const appointment of expiredAppointments) {
      try {
        const previousStatus = appointment.status;

        // 1. Mark appointment as EXPIRED
        await prisma.appointment.update({
          where: { id: appointment.id },
          data: {
            status: "EXPIRED",
            notes: appointment.notes
              ? `${appointment.notes} | Auto-expired: appointment date passed without completion.`
              : "Auto-expired: appointment date passed without completion.",
          },
        });

        // 2. Release the slot back to AVAILABLE
        await prisma.slot.update({
          where: { id: appointment.slotId },
          data: { status: "AVAILABLE" },
        });

        expiredCount++;

        // 3. Process refund for online-paid PENDING appointments (doctor never confirmed)
        if (previousStatus === "PENDING" && appointment.paymentMethod === "ONLINE" && appointment.transactionId) {
          try {
            const payment = await prisma.payment.findFirst({
              where: {
                razorpayPaymentId: appointment.transactionId,
                status: "SUCCESS",
              },
            });

            if (payment && payment.razorpayPaymentId) {
              if (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET) {
                const RazorpayModule = await import("razorpay");
                const Razorpay = RazorpayModule.default;
                const razorpay = new Razorpay({
                  key_id: process.env.RAZORPAY_KEY_ID,
                  key_secret: process.env.RAZORPAY_KEY_SECRET,
                });

                await razorpay.payments.refund(payment.razorpayPaymentId, {
                  amount: payment.amount,
                  notes: {
                    reason: "Appointment expired - doctor did not approve",
                    appointmentId: appointment.id,
                  },
                });

                await prisma.payment.update({
                  where: { id: payment.id },
                  data: { status: "REFUNDED" },
                });

                refundedCount++;
              } else {
                refundFailedCount++;
              }
            }
          } catch (refundError) {
            console.error(`Refund failed for appointment ${appointment.id}:`, refundError);
            refundFailedCount++;
          }
        }

        // 4. Send chat message and database notification to patient and doctor
        try {
          const patientUserId = appointment.patient?.user?.id;
          const doctorUserId = appointment.doctor?.user?.id;
          const doctorName = appointment.doctor?.user?.name || "Doctor";
          const patientName = appointment.patient?.user?.name || "Patient";
          const apptDate = appointment.slot?.date?.toISOString().split("T")[0] || "";

          // Post in-chat message
          if (doctorUserId && patientUserId) {
            let relation = await prisma.doctorPatientRelation.findUnique({
              where: {
                doctorsUserId_patientsUserId: {
                  doctorsUserId: doctorUserId,
                  patientsUserId: patientUserId,
                },
              },
            });

            if (!relation) {
              relation = await prisma.doctorPatientRelation.create({
                data: {
                  doctorsUserId: doctorUserId,
                  patientsUserId: patientUserId,
                },
              });
            }

            const expireChatText = `⏱️ Appointment Expired\n\nThe scheduled time for the appointment on ${apptDate} has passed.\n\n👉 Need to book a new appointment? [Click here to find doctors](/patient/findDoctors)`;

            await prisma.chatMessages.create({
              data: {
                doctorPatientRelationId: relation.id,
                text: expireChatText,
                senderId: doctorUserId,
              },
            });
          }

          const patientEventId = `apt:${appointment.id}:EXPIRED`;
          const doctorEventId = `apt:${appointment.id}:EXPIRED:doc`;
          const outboxEventIds: string[] = [];

          let patientNotifRecord: any = null;
          if (patientUserId) {
            patientNotifRecord = await prisma.notification.upsert({
              where: { userId_eventId: { userId: patientUserId, eventId: patientEventId } },
              update: {},
              create: {
                userId: patientUserId,
                eventId: patientEventId,
                message: `Your appointment with Dr. ${doctorName} on ${apptDate} has expired as the appointment date passed.`,
                actionHref: `/patient/appointments/${appointment.id}`,
                actionLabel: "View appointment",
              },
            });

            await prisma.notificationOutbox.upsert({
              where: { eventId: patientEventId },
              update: {},
              create: {
                eventId: patientEventId,
                channel: "SOCKET_APPOINTMENT_STATUS",
                targetUserId: patientUserId,
                payload: {
                  patientUserId,
                  appointmentId: appointment.id,
                  status: "EXPIRED",
                  appointmentDate: appointment.slot.date.toISOString(),
                  appointmentTime: appointment.slot.startTime.toISOString(),
                  doctorName: appointment.doctor.user.name,
                  notification: {
                    id: patientNotifRecord.id,
                    message: patientNotifRecord.message,
                    actionHref: patientNotifRecord.actionHref,
                    actionLabel: patientNotifRecord.actionLabel,
                    createdAt: patientNotifRecord.createdAt.toISOString(),
                    isRead: patientNotifRecord.isRead,
                  },
                },
                status: "PENDING",
              },
            });
            outboxEventIds.push(patientEventId);
          }

          if (doctorUserId && previousStatus === "CONFIRMED") {
            const doctorNotifRecord = await prisma.notification.upsert({
              where: { userId_eventId: { userId: doctorUserId, eventId: doctorEventId } },
              update: {},
              create: {
                userId: doctorUserId,
                eventId: doctorEventId,
                message: `Your appointment with ${patientName} on ${apptDate} was marked expired as the scheduled date passed.`,
                actionHref: `/doctor/appointments/${appointment.id}`,
                actionLabel: "View appointment",
              },
            });

            await prisma.notificationOutbox.upsert({
              where: { eventId: doctorEventId },
              update: {},
              create: {
                eventId: doctorEventId,
                channel: "SOCKET_NOTIFICATION",
                targetUserId: doctorUserId,
                payload: {
                  userId: doctorUserId,
                  notification: {
                    id: doctorNotifRecord.id,
                    message: doctorNotifRecord.message,
                    actionHref: doctorNotifRecord.actionHref,
                    actionLabel: doctorNotifRecord.actionLabel,
                    createdAt: doctorNotifRecord.createdAt.toISOString(),
                    isRead: doctorNotifRecord.isRead,
                  },
                },
                status: "PENDING",
              },
            });
            outboxEventIds.push(doctorEventId);
          }

          if (outboxEventIds.length > 0) {
            await dispatchPendingOutboxEvents(outboxEventIds).catch(() => undefined);
          }
        } catch {
          // Non-critical notification failure
        }
      } catch (err) {
        console.error(`Failed to expire appointment ${appointment.id}:`, err);
      }
    }

    return { expired: expiredCount, refunded: refundedCount, refundFailed: refundFailedCount };
  } catch (error) {
    console.error("autoExpirePastAppointments error:", error);
    return { expired: 0, refunded: 0, refundFailed: 0 };
  }
}
