import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser } from "@/lib/auth";
import { isValidStatusTransition } from "@/lib/appointment-state-machine";

/**
 * Helper: get all dates between two DateTimes (inclusive, UTC midnight dates)
 */
function getDatesBetween(start: Date, end: Date): Date[] {
  const dates: Date[] = [];
  const current = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  const last = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));
  while (current <= last) {
    dates.push(new Date(current));
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return dates;
}

/**
 * Mark AVAILABLE or HELD slots as ON_LEAVE if they overlap with the leave period.
 */
async function markSlotsOnLeave(doctorId: string, leaveStart: Date, leaveEnd: Date) {
  await prisma.slot.updateMany({
    where: {
      doctorId,
      status: { in: ["AVAILABLE", "HELD"] },
      OR: [
        { startTime: { gte: leaveStart, lte: leaveEnd } },
        { endTime: { gte: leaveStart, lte: leaveEnd } },
        { startTime: { lt: leaveEnd }, endTime: { gt: leaveStart } },
      ],
    },
    data: {
      status: "ON_LEAVE",
      heldByPatientId: null,
      heldAt: null,
      holdToken: null,
      holdExpiresAt: null,
    },
  });
}

/**
 * Restore ON_LEAVE slots back to AVAILABLE when a leave is cancelled or shrunk.
 * Only restores if they don't overlap with another active leave.
 */
async function restoreSlotsFromLeave(doctorId: string, leaveStart: Date, leaveEnd: Date, excludeLeaveId: string) {
  const onLeaveSlots = await prisma.slot.findMany({
    where: {
      doctorId,
      status: "ON_LEAVE",
      OR: [
        { startTime: { gte: leaveStart, lte: leaveEnd } },
        { endTime: { gte: leaveStart, lte: leaveEnd } },
        { startTime: { lt: leaveEnd }, endTime: { gt: leaveStart } },
      ],
    },
  });

  for (const slot of onLeaveSlots) {
    // Check if any other leave covers this slot
    const otherLeave = await prisma.leave.findFirst({
      where: {
        doctorId,
        id: { not: excludeLeaveId },
        startDate: { lt: slot.endTime },
        endDate: { gt: slot.startTime },
      },
    });

    if (!otherLeave) {
      await prisma.slot.update({
        where: { id: slot.id },
        data: { status: "AVAILABLE" },
      });
    }
  }
}

/**
 * Cancel appointments that overlap with the doctor's leave period,
 * send automated chat messages, issue notifications to patient & doctor,
 * process refunds if paid online, and broadcast socket events.
 */
async function cancelAppointmentsForLeave(
  doctorId: string,
  doctorUserId: string,
  doctorName: string,
  startDateTime: Date,
  endDateTime: Date,
  reason: string
): Promise<number> {
  const overlappingAppointments = await prisma.appointment.findMany({
    where: {
      doctorId,
      status: { in: ["PENDING", "CONFIRMED"] },
      OR: [
        {
          slot: {
            startTime: { gte: startDateTime, lte: endDateTime },
          },
        },
        {
          slot: {
            endTime: { gte: startDateTime, lte: endDateTime },
          },
        },
        {
          slot: {
            startTime: { lt: endDateTime },
            endTime: { gt: startDateTime },
          },
        },
      ],
    },
    include: {
      patient: { include: { user: true } },
      doctor: { include: { user: true } },
      slot: true,
    },
  });

  const cancellableAppointments = overlappingAppointments.filter((a) =>
    isValidStatusTransition(a.status as any, "CANCELLED")
  );

  const socketServerUrl =
    process.env.NEXT_PUBLIC_SOCKET_URL ||
    process.env.SOCKET_SERVER_URL ||
    "http://localhost:4000";

  for (const appt of cancellableAppointments) {
    // 1. Update appointment status to CANCELLED
    await prisma.appointment.update({
      where: { id: appt.id },
      data: {
        status: "CANCELLED",
        notes: appt.notes
          ? `${appt.notes} | Doctor cancelled due to leave. Reason: ${reason}`
          : `Doctor cancelled due to leave. Reason: ${reason}`,
      },
    });

    // 2. Mark slot status as ON_LEAVE
    await prisma.slot.update({
      where: { id: appt.slotId },
      data: {
        status: "ON_LEAVE",
        heldByPatientId: null,
        heldAt: null,
        holdToken: null,
        holdExpiresAt: null,
      },
    });

    const patientUserId = appt.patient?.user?.id;
    const patientName = appt.patient?.user?.name || "Patient";
    const apptDate = appt.slot?.date
      ? new Date(appt.slot.date).toISOString().split("T")[0]
      : "scheduled date";
    const docName = appt.doctor?.user?.name || doctorName || "Doctor";

    // 3. Process online refund if payment was ONLINE
    if (appt.paymentMethod === "ONLINE" && appt.transactionId) {
      try {
        const payment = await prisma.payment.findFirst({
          where: {
            razorpayPaymentId: appt.transactionId,
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
                reason: `Doctor on leave: ${reason}`,
                appointmentId: appt.id,
              },
            });

            await prisma.payment.update({
              where: { id: payment.id },
              data: { status: "REFUNDED" },
            });
          }
        }
      } catch (refundError) {
        console.error(`Refund error for appointment ${appt.id}:`, refundError);
      }
    }

    // 4. Send chat message to doctor-patient chat
    if (patientUserId && doctorUserId) {
      try {
        let relation = await prisma.doctorPatientRelation.findUnique({
          where: {
            doctorsUserId_patientsUserId: {
              doctorsUserId: doctorUserId,
              patientsUserId: patientUserId,
            },
          },
        });

        if (!relation) {
          try {
            relation = await prisma.doctorPatientRelation.create({
              data: {
                doctorsUserId: doctorUserId,
                patientsUserId: patientUserId,
              },
            });
          } catch {
            relation = await prisma.doctorPatientRelation.findUnique({
              where: {
                doctorsUserId_patientsUserId: {
                  doctorsUserId: doctorUserId,
                  patientsUserId: patientUserId,
                },
              },
            });
          }
        }

        const cancelChatText =
          appt.paymentMethod === "ONLINE"
            ? `❌ Appointment Cancelled\n\nYour appointment with Dr. ${docName} on ${apptDate} has been cancelled because the doctor is on leave (Reason: ${reason}). A full refund has been initiated to your original payment method.\n\n👉 [Click here to find available doctors & slots](/patient/findDoctors)`
            : `❌ Appointment Cancelled\n\nYour appointment with Dr. ${docName} on ${apptDate} has been cancelled because the doctor is on leave (Reason: ${reason}).\n\n👉 [Click here to find available doctors & slots](/patient/findDoctors)`;

        if (relation) {
          await prisma.chatMessages.create({
            data: {
              doctorPatientRelationId: relation.id,
              text: cancelChatText,
              senderId: doctorUserId,
            },
          });
        }
      } catch (chatErr) {
        console.warn("Failed to create automated cancellation chat message:", chatErr);
      }
    }

    // 5. Send notification to Patient
    if (patientUserId) {
      try {
        const patientMessage =
          appt.paymentMethod === "ONLINE"
            ? `Your appointment on ${apptDate} with Dr. ${docName} has been cancelled due to doctor leave (Reason: ${reason}). A full refund has been initiated to your payment method.`
            : `Your appointment on ${apptDate} with Dr. ${docName} has been cancelled. Reason: Doctor is on leave — ${reason}`;

        const patientNotification = await prisma.notification.create({
          data: {
            userId: patientUserId,
            message: patientMessage,
            actionHref: `/patient/appointments/${appt.id}`,
            actionLabel: "View appointment",
          },
        });

        await fetch(`${socketServerUrl}/api/notifications/broadcast`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userId: patientUserId,
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

        if (appt.slot?.date && appt.slot?.startTime) {
          await fetch(`${socketServerUrl}/api/notifications/appointment-status`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              patientUserId,
              appointmentId: appt.id,
              status: "CANCELLED",
              appointmentDate: appt.slot.date.toISOString(),
              appointmentTime: appt.slot.startTime.toISOString(),
              doctorName: docName,
            }),
          }).catch(() => {});
        }
      } catch {}
    }

    // 6. Send notification to Doctor for this cancelled appointment
    if (doctorUserId) {
      try {
        const doctorMessage = `Appointment with ${patientName} on ${apptDate} was cancelled due to your scheduled leave (Reason: ${reason}).`;

        const doctorNotification = await prisma.notification.create({
          data: {
            userId: doctorUserId,
            message: doctorMessage,
            actionHref: `/doctor/appointments/${appt.id}`,
            actionLabel: "View appointment",
          },
        });

        await fetch(`${socketServerUrl}/api/notifications/broadcast`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userId: doctorUserId,
            notification: {
              id: doctorNotification.id,
              message: doctorNotification.message,
              actionHref: doctorNotification.actionHref,
              actionLabel: doctorNotification.actionLabel,
              createdAt: doctorNotification.createdAt.toISOString(),
              isRead: doctorNotification.isRead,
            },
          }),
        }).catch(() => {});
      } catch {}
    }
  }

  return cancellableAppointments.length;
}

/* POST - create a leave request for doctorId */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ doctorId: string }> }
) {
  try {
    const { doctorId } = await params;
    if (!doctorId) {
      return NextResponse.json({ error: "Missing doctorId" }, { status: 400 });
    }

    const doctor = await prisma.doctor.findUnique({
      where: { id: doctorId },
      select: { userId: true, user: { select: { id: true, name: true } } },
    });

    if (!doctor) {
      return NextResponse.json({ error: "Doctor not found" }, { status: 404 });
    }

    const authUser = await getAuthenticatedUser(req);
    if (authUser && doctor.userId !== authUser.id && authUser.role !== "ADMIN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const { startDate, endDate, reason, userId } = body || {};

    if (!startDate || !endDate || !reason) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const startDateTime = new Date(startDate);
    const endDateTime = new Date(endDate);
    if (isNaN(startDateTime.getTime()) || isNaN(endDateTime.getTime())) {
      return NextResponse.json({ error: "Invalid date format" }, { status: 400 });
    }

    if (endDateTime < startDateTime) {
      return NextResponse.json({ error: "End date cannot be before start date" }, { status: 400 });
    }

    const now = new Date();
    if (endDateTime <= now) {
      return NextResponse.json({ error: "Cannot create leave in the past" }, { status: 400 });
    }

    // Check for conflicting leaves (any overlap)
    const checkLeaveConflict = await prisma.leave.findFirst({
      where: {
        doctorId,
        startDate: { lt: endDateTime },
        endDate: { gt: startDateTime },
      },
    });

    if (checkLeaveConflict) {
      return NextResponse.json({ error: "Leave request conflicts with existing leave" }, { status: 409 });
    }

    // Create the leave
    const leaveRequest = await prisma.leave.create({
      data: {
        doctorId,
        startDate: startDateTime,
        endDate: endDateTime,
        reason,
      },
    });

    // Mark overlapping AVAILABLE slots as ON_LEAVE
    await markSlotsOnLeave(doctorId, startDateTime, endDateTime);

    // Auto-cancel overlapping PENDING/CONFIRMED appointments & notify patient and doctor
    const doctorName = doctor.user?.name || "Doctor";
    const cancelledCount = await cancelAppointmentsForLeave(
      doctorId,
      doctor.userId,
      doctorName,
      startDateTime,
      endDateTime,
      reason
    );

    // Summary notification for the doctor
    const summaryUserId = userId || doctor.userId;
    if (summaryUserId) {
      const summaryMessage =
        cancelledCount > 0
          ? `Leave request submitted. ${cancelledCount} appointment(s) for this period have been cancelled, and patients have been notified on chat and notifications.`
          : "Leave request has been successfully added. No existing appointments were affected.";

      try {
        const summaryNotif = await prisma.notification.create({
          data: {
            userId: summaryUserId,
            message: summaryMessage,
            actionHref: `/doctor/leave/history`,
            actionLabel: "View leave history",
          },
        });

        const socketServerUrl =
          process.env.NEXT_PUBLIC_SOCKET_URL ||
          process.env.SOCKET_SERVER_URL ||
          "http://localhost:4000";

        await fetch(`${socketServerUrl}/api/notifications/broadcast`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userId: summaryUserId,
            notification: {
              id: summaryNotif.id,
              message: summaryNotif.message,
              actionHref: summaryNotif.actionHref,
              actionLabel: summaryNotif.actionLabel,
              createdAt: summaryNotif.createdAt.toISOString(),
              isRead: summaryNotif.isRead,
            },
          }),
        }).catch(() => {});
      } catch {}
    }

    return NextResponse.json({ ...leaveRequest, cancelledAppointments: cancelledCount }, { status: 201 });
  } catch (err: any) {
    console.error("Doctor Leave POST Error:", err);
    return NextResponse.json({ error: err?.message ?? "Server error" }, { status: 500 });
  }
}

/* GET - list leaves for doctorId with optional filters */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ doctorId: string }> }
) {
  try {
    const { doctorId } = await params;
    if (!doctorId) {
      return NextResponse.json({ error: "Missing doctorId" }, { status: 400 });
    }

    const { searchParams } = req.nextUrl;
    const where: any = { doctorId };

    const startDateParam = searchParams.get("startDate") ?? undefined;
    const endDateParam = searchParams.get("endDate") ?? undefined;
    const reason = searchParams.get("reason") ?? undefined;

    if (startDateParam) {
      const d = new Date(startDateParam);
      if (isNaN(d.getTime())) {
        return NextResponse.json({ error: "Invalid startDate" }, { status: 400 });
      }
      where.startDate = { ...(where.startDate ?? {}), gte: d };
    }

    if (endDateParam) {
      const d = new Date(endDateParam);
      if (isNaN(d.getTime())) {
        return NextResponse.json({ error: "Invalid endDate" }, { status: 400 });
      }
      where.endDate = { ...(where.endDate ?? {}), lte: d };
    }

    if (reason) {
      where.reason = { contains: reason, mode: "insensitive" };
    }

    const leaves = await prisma.leave.findMany({
      where,
      orderBy: { startDate: "desc" },
    });

    return NextResponse.json({ leaves }, { status: 200 });
  } catch (err: any) {
    console.error("Get Leave Error:", err);
    return NextResponse.json({ error: err?.message ?? "Server error" }, { status: 500 });
  }
}

/* DELETE - cancel a leave and restore affected slots */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ doctorId: string }> }
) {
  try {
    const { doctorId } = await params;
    if (!doctorId) {
      return NextResponse.json({ error: "Missing doctorId" }, { status: 400 });
    }

    const doctor = await prisma.doctor.findUnique({
      where: { id: doctorId },
      select: { userId: true },
    });

    if (!doctor) {
      return NextResponse.json({ error: "Doctor not found" }, { status: 404 });
    }

    const authUser = await getAuthenticatedUser(req);
    if (authUser && doctor.userId !== authUser.id && authUser.role !== "ADMIN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { searchParams } = req.nextUrl;
    const leaveId = searchParams.get("leaveId");

    if (!leaveId) {
      return NextResponse.json({ error: "Missing leaveId" }, { status: 400 });
    }

    const leave = await prisma.leave.findUnique({
      where: { id: leaveId },
    });

    if (!leave) {
      return NextResponse.json({ error: "Leave not found" }, { status: 404 });
    }

    if (leave.doctorId !== doctorId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const now = new Date();
    if (leave.endDate <= now) {
      return NextResponse.json({ error: "Cannot cancel past leaves that have already ended" }, { status: 400 });
    }

    // Restore ON_LEAVE slots back to AVAILABLE
    await restoreSlotsFromLeave(doctorId, leave.startDate, leave.endDate, leaveId);

    // Delete the leave
    await prisma.leave.delete({
      where: { id: leaveId },
    });

    return NextResponse.json({ ok: true, message: "Leave cancelled and slots restored" }, { status: 200 });
  } catch (err: any) {
    console.error("Delete Leave Error:", err);
    return NextResponse.json({ error: err?.message ?? "Server error" }, { status: 500 });
  }
}

/* PATCH - modify leave dates */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ doctorId: string }> }
) {
  try {
    const { doctorId } = await params;
    if (!doctorId) {
      return NextResponse.json({ error: "Missing doctorId" }, { status: 400 });
    }

    const doctor = await prisma.doctor.findUnique({
      where: { id: doctorId },
      select: { userId: true, user: { select: { id: true, name: true } } },
    });

    if (!doctor) {
      return NextResponse.json({ error: "Doctor not found" }, { status: 404 });
    }

    const authUser = await getAuthenticatedUser(req);
    if (authUser && doctor.userId !== authUser.id && authUser.role !== "ADMIN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const { leaveId, newEndDate, newStartDate, reason } = body || {};

    if (!leaveId) {
      return NextResponse.json({ error: "Missing leaveId" }, { status: 400 });
    }

    const leave = await prisma.leave.findUnique({
      where: { id: leaveId },
    });

    if (!leave) {
      return NextResponse.json({ error: "Leave not found" }, { status: 404 });
    }

    if (leave.doctorId !== doctorId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const oldStart = leave.startDate;
    const oldEnd = leave.endDate;
    const updatedStart = newStartDate ? new Date(newStartDate) : oldStart;
    const updatedEnd = newEndDate ? new Date(newEndDate) : oldEnd;

    if (isNaN(updatedStart.getTime()) || isNaN(updatedEnd.getTime())) {
      return NextResponse.json({ error: "Invalid date format" }, { status: 400 });
    }

    if (updatedEnd < updatedStart) {
      return NextResponse.json({ error: "End date cannot be before start date" }, { status: 400 });
    }

    // Check conflict with other leaves
    const conflict = await prisma.leave.findFirst({
      where: {
        doctorId,
        id: { not: leaveId },
        startDate: { lt: updatedEnd },
        endDate: { gt: updatedStart },
      },
    });

    if (conflict) {
      return NextResponse.json({ error: "Updated dates conflict with another leave" }, { status: 409 });
    }

    const updateData: any = {
      startDate: updatedStart,
      endDate: updatedEnd,
    };
    if (reason && typeof reason === "string" && reason.trim()) {
      updateData.reason = reason.trim();
    }

    const updatedLeave = await prisma.leave.update({
      where: { id: leaveId },
      data: updateData,
    });

    // Handle freed slots
    if (updatedEnd < oldEnd) {
      await restoreSlotsFromLeave(doctorId, updatedEnd, oldEnd, leaveId);
    }
    if (updatedStart > oldStart) {
      await restoreSlotsFromLeave(doctorId, oldStart, updatedStart, leaveId);
    }

    // Handle new covered slots & auto-cancel appointments
    const docName = doctor.user?.name || "Doctor";
    if (updatedEnd > oldEnd) {
      await markSlotsOnLeave(doctorId, oldEnd, updatedEnd);
      await cancelAppointmentsForLeave(
        doctorId,
        doctor.userId,
        docName,
        oldEnd,
        updatedEnd,
        leave.reason
      );
    }
    if (updatedStart < oldStart) {
      await markSlotsOnLeave(doctorId, updatedStart, oldStart);
      await cancelAppointmentsForLeave(
        doctorId,
        doctor.userId,
        docName,
        updatedStart,
        oldStart,
        leave.reason
      );
    }

    return NextResponse.json({
      ok: true,
      message: "Leave updated. Freed slots have been restored.",
      leave: updatedLeave,
    }, { status: 200 });
  } catch (err: any) {
    console.error("Patch Leave Error:", err);
    return NextResponse.json({ error: err?.message ?? "Server error" }, { status: 500 });
  }
}
