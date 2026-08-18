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
 * Mark AVAILABLE slots as ON_LEAVE if they overlap with the leave period.
 * Only affects slots that fall within the leave start/end times.
 */
async function markSlotsOnLeave(doctorId: string, leaveStart: Date, leaveEnd: Date) {
  const dates = getDatesBetween(leaveStart, leaveEnd);

  for (const date of dates) {
    const slots = await prisma.slot.findMany({
      where: {
        doctorId,
        date,
        status: "AVAILABLE",
      },
    });

    for (const slot of slots) {
      if (slot.startTime < leaveEnd && slot.endTime > leaveStart) {
        await prisma.slot.update({
          where: { id: slot.id },
          data: { status: "ON_LEAVE" },
        });
      }
    }
  }
}

/**
 * Restore ON_LEAVE slots back to AVAILABLE when a leave is cancelled or shrunk.
 * Only restores if they don't overlap with another active leave.
 */
async function restoreSlotsFromLeave(doctorId: string, leaveStart: Date, leaveEnd: Date, excludeLeaveId: string) {
  const dates = getDatesBetween(leaveStart, leaveEnd);

  for (const date of dates) {
    const slots = await prisma.slot.findMany({
      where: {
        doctorId,
        date,
        status: "ON_LEAVE",
      },
    });

    for (const slot of slots) {
      if (slot.startTime < leaveEnd && slot.endTime > leaveStart) {
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
  }
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
      select: { userId: true },
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

    // Auto-cancel overlapping PENDING/CONFIRMED appointments
    const overlappingAppointments = await prisma.appointment.findMany({
      where: {
        doctorId,
        status: { in: ["PENDING", "CONFIRMED"] },
        slot: {
          startTime: { lt: endDateTime },
          endTime: { gt: startDateTime },
        },
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
    const cancelledCount = cancellableAppointments.length;
    const doctorName = overlappingAppointments[0]?.doctor?.user?.name || "your doctor";

    for (const appt of cancellableAppointments) {
      await prisma.appointment.update({
        where: { id: appt.id },
        data: {
          status: "CANCELLED",
          notes: `Doctor cancelled due to leave. Reason: ${reason}`,
        },
      });

      await prisma.slot.update({
        where: { id: appt.slotId },
        data: { status: "ON_LEAVE" },
      });

      const patientUserId = appt.patient?.user?.id;
      if (patientUserId) {
        const apptDate = appt.slot.date.toISOString().split("T")[0];
        try {
          await prisma.notification.create({
            data: {
              userId: patientUserId,
              message: `Your appointment on ${apptDate} with ${doctorName} has been cancelled. Reason: Doctor is on leave — ${reason}`,
            },
          });
        } catch {}
      }
    }

    if (userId) {
      const message = cancelledCount > 0
        ? `Leave request submitted. ${cancelledCount} appointment(s) for this period have been cancelled and patients have been notified.`
        : "Leave request has been successfully added. No existing appointments were affected.";

      try {
        await prisma.notification.create({
          data: {
            userId,
            message,
          },
        });
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
      select: { userId: true },
    });

    if (!doctor) {
      return NextResponse.json({ error: "Doctor not found" }, { status: 404 });
    }

    const authUser = await getAuthenticatedUser(req);
    if (authUser && doctor.userId !== authUser.id && authUser.role !== "ADMIN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const { leaveId, newEndDate, newStartDate } = body || {};

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

    const updatedLeave = await prisma.leave.update({
      where: { id: leaveId },
      data: {
        startDate: updatedStart,
        endDate: updatedEnd,
      },
    });

    // Handle freed slots
    if (updatedEnd < oldEnd) {
      await restoreSlotsFromLeave(doctorId, updatedEnd, oldEnd, leaveId);
    }
    if (updatedStart > oldStart) {
      await restoreSlotsFromLeave(doctorId, oldStart, updatedStart, leaveId);
    }

    // Handle new covered slots
    if (updatedEnd > oldEnd) {
      await markSlotsOnLeave(doctorId, oldEnd, updatedEnd);
    }
    if (updatedStart < oldStart) {
      await markSlotsOnLeave(doctorId, updatedStart, oldStart);
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
