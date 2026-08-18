import { prisma } from "@/lib/prisma";

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

          if (patientUserId) {
            await prisma.notification.create({
              data: {
                userId: patientUserId,
                message: `Your appointment with Dr. ${doctorName} on ${apptDate} has expired as the appointment date passed.`,
              },
            });
          }

          if (doctorUserId && previousStatus === "CONFIRMED") {
            await prisma.notification.create({
              data: {
                userId: doctorUserId,
                message: `Your appointment with ${patientName} on ${apptDate} was marked expired as the scheduled date passed.`,
              },
            });
          }
        } catch {
          // Non-critical notification failure
        }

        // 5. Send socket notification if socket server is configured
        try {
          const socketServerUrl = process.env.NEXT_PUBLIC_SOCKET_URL || process.env.SOCKET_SERVER_URL || "http://localhost:4000";
          if (appointment.patient?.user?.id) {
            await fetch(`${socketServerUrl}/api/notifications/appointment-status`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              signal: AbortSignal.timeout(1000),
              body: JSON.stringify({
                patientUserId: appointment.patient.user.id,
                appointmentId: appointment.id,
                status: "EXPIRED",
                appointmentDate: appointment.slot.date.toISOString(),
                appointmentTime: appointment.slot.startTime.toISOString(),
                doctorName: appointment.doctor.user.name,
              }),
            }).catch(() => {});
          }
        } catch {
          // Non-critical
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
