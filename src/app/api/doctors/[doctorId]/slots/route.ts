import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { expireDoctorHolds } from "@/lib/booking";

const SLOT_DURATION_MINUTES = 10;

// Helper: convert HH:MM to minutes since midnight
function timeStringToMinutes(timeStr: string): number {
  const [hours, minutes] = timeStr.split(":").map(Number);
  return hours * 60 + minutes;
}

// Helper: get day name from UTC date
function getDayNameUTC(date: Date): string {
  const days = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ];
  return days[date.getUTCDay()];
}

// Helper: format slots with real-time appointment availability
function formatSlotsWithAvailability(slots: any[]) {
  return slots.map((slot) => {
    let status = slot.status;

    if (slot.appointment) {
      const apptStatus = slot.appointment.status;
      if (apptStatus === "COMPLETED" || apptStatus === "NO_SHOW" || apptStatus === "EXPIRED") {
        status = "UNAVAILABLE";
      } else if (apptStatus === "CONFIRMED" || apptStatus === "PENDING") {
        status = "BOOKED";
      } else if (apptStatus === "CANCELLED") {
        if (status !== "ON_LEAVE") {
          status = "AVAILABLE";
        }
      }
    }

    return {
      id: slot.id,
      doctorId: slot.doctorId,
      date: slot.date,
      startTime: slot.startTime,
      endTime: slot.endTime,
      status,
      heldByPatientId: slot.heldByPatientId,
      heldAt: slot.heldAt,
    };
  });
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ doctorId: string }> }
) {
  try {
    const { doctorId } = await params;
    const { searchParams } = req.nextUrl;
    const dateStr = searchParams.get("date");

    if (!doctorId) {
      return NextResponse.json(
        { error: "Missing doctorId" },
        { status: 400 }
      );
    }

    if (!dateStr) {
      return NextResponse.json(
        { error: "Missing date query parameter" },
        { status: 400 }
      );
    }

    // Parse as UTC midnight
    const date = new Date(`${dateStr}T00:00:00.000Z`);
    if (isNaN(date.getTime())) {
      return NextResponse.json(
        { error: "Invalid date format" },
        { status: 400 }
      );
    }

    // A stale payment hold must never make a slot appear unavailable.
    await expireDoctorHolds(doctorId);

    // Check if slots already exist for this date
    const existingSlots = await prisma.slot.findMany({
      where: {
        doctorId,
        date,
      },
      include: {
        appointment: {
          select: { id: true, status: true },
        },
      },
      orderBy: { startTime: "asc" },
    });

    if (existingSlots.length > 0) {
      return NextResponse.json({ slots: formatSlotsWithAvailability(existingSlots) }, { status: 200 });
    }

    // Fetch doctor's schedule
    const schedule = await prisma.schedule.findUnique({
      where: { doctorId },
      include: { doctor: true },
    });

    if (!schedule) {
      return NextResponse.json(
        { error: "Doctor schedule does not exist" },
        { status: 404 }
      );
    }

    // Get day name based on UTC day
    const dayName = getDayNameUTC(date);

    // Get schedule for this day
    const weeklySchedule = schedule.weeklySchedule as Array<{
      day: string;
      slots: Array<{ slotNo: number; start: string; end: string }>;
    }>;

    const daySchedule = weeklySchedule.find((d) => d.day === dayName);

    if (!daySchedule || !daySchedule.slots || daySchedule.slots.length === 0) {
      return NextResponse.json(
        { slots: [] },
        { status: 200 }
      );
    }

    // Check for active leaves on this date
    const activeLeaves = await prisma.leave.findMany({
      where: {
        doctorId,
        startDate: { lte: new Date(`${dateStr}T23:59:59.999Z`) },
        endDate: { gte: new Date(`${dateStr}T00:00:00.000Z`) },
      },
    });

    // Generate slots for each time slot in the schedule
    const slotsToCreate: Array<{
      doctorId: string;
      date: Date;
      startTime: Date;
      endTime: Date;
      status: "ON_LEAVE" | "AVAILABLE";
    }> = [];

    for (const timeSlot of daySchedule.slots) {
      if (!timeSlot.start || !timeSlot.end) continue;

      const startMin = timeStringToMinutes(timeSlot.start);
      const endMin = timeStringToMinutes(timeSlot.end);

      // Generate 10-minute slots within this time range
      for (let min = startMin; min < endMin; min += SLOT_DURATION_MINUTES) {
        const startTime = new Date(date);
        startTime.setUTCHours(Math.floor(min / 60), min % 60, 0, 0);

        const endTime = new Date(startTime);
        endTime.setUTCMinutes(endTime.getUTCMinutes() + SLOT_DURATION_MINUTES);

        // Check if this slot overlaps with any active leave
        const isOnLeave = activeLeaves.some(
          (leave: { startDate: Date; endDate: Date }) => startTime < leave.endDate && endTime > leave.startDate
        );

        slotsToCreate.push({
          doctorId,
          date,
          startTime,
          endTime,
          status: isOnLeave ? "ON_LEAVE" : "AVAILABLE",
        });
      }
    }

    if (slotsToCreate.length > 0) {
      await prisma.slot.createMany({
        data: slotsToCreate,
        skipDuplicates: true,
      });
    }

    const generatedSlots = await prisma.slot.findMany({
      where: {
        doctorId,
        date,
      },
      include: {
        appointment: {
          select: { id: true, status: true },
        },
      },
      orderBy: { startTime: "asc" },
    });

    return NextResponse.json({ slots: formatSlotsWithAvailability(generatedSlots) }, { status: 201 });
  } catch (err: any) {
    console.error("GET Slots Error:", err);
    return NextResponse.json(
      { error: err?.message ?? "Server error" },
      { status: 500 }
    );
  }
}

// =============================================
// PATCH → Update slot status
// =============================================
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ doctorId: string }> }
) {
  try {
    const { doctorId } = await params;
    const body = await req.json();
    const { slotId, slotIds, status } = body;

    if (!doctorId || (!slotId && (!slotIds || !Array.isArray(slotIds))) || !status) {
      return NextResponse.json(
        { error: "doctorId, status, and either slotId or slotIds array are required" },
        { status: 400 }
      );
    }

    const allowedStatuses = ["AVAILABLE", "HELD", "BOOKED", "UNAVAILABLE", "CANCELLED", "ON_LEAVE"];
    if (!allowedStatuses.includes(status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }

    if (slotIds && Array.isArray(slotIds)) {
      const updated = await prisma.slot.updateMany({
        where: {
          id: { in: slotIds },
          doctorId,
          status: { notIn: ["BOOKED"] },
        },
        data: { status },
      });
      return NextResponse.json({ success: true, count: updated.count }, { status: 200 });
    }

    const slot = await prisma.slot.findUnique({ where: { id: slotId } });
    if (!slot || slot.doctorId !== doctorId) {
      return NextResponse.json({ error: "Slot not found" }, { status: 404 });
    }

    const updated = await prisma.slot.update({
      where: { id: slotId },
      data: { status },
    });

    return NextResponse.json({ slot: updated }, { status: 200 });
  } catch (err: any) {
    console.error("PATCH Slot Error:", err);
    return NextResponse.json(
      { error: err?.message ?? "Server error" },
      { status: 500 }
    );
  }
}

// =============================================
// DELETE → Delete a slot (only if AVAILABLE)
// =============================================
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ doctorId: string }> }
) {
  try {
    const { doctorId } = await params;
    const { slotId } = await req.json();

    if (!doctorId || !slotId) {
      return NextResponse.json(
        { error: "doctorId and slotId are required" },
        { status: 400 }
      );
    }

    const slot = await prisma.slot.findUnique({ where: { id: slotId } });
    if (!slot || slot.doctorId !== doctorId) {
      return NextResponse.json({ error: "Slot not found" }, { status: 404 });
    }

    if (slot.status !== "AVAILABLE") {
      return NextResponse.json(
        { error: "Only AVAILABLE slots can be deleted" },
        { status: 400 }
      );
    }

    await prisma.slot.delete({ where: { id: slotId } });

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err: any) {
    console.error("DELETE Slot Error:", err);
    return NextResponse.json(
      { error: err?.message ?? "Server error" },
      { status: 500 }
    );
  }
}

// =============================================
// POST → Create a new ad-hoc slot
// =============================================
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ doctorId: string }> }
) {
  try {
    const { doctorId } = await params;
    const { date, startTime, endTime } = await req.json();

    if (!doctorId || !date || !startTime || !endTime) {
      return NextResponse.json(
        { error: "doctorId, date, startTime and endTime are required" },
        { status: 400 }
      );
    }

    const start = new Date(`${date}T${startTime}:00.000Z`);
    const end = new Date(`${date}T${endTime}:00.000Z`);

    if (isNaN(start.getTime()) || isNaN(end.getTime()) || start >= end) {
      return NextResponse.json({ error: "Invalid time range" }, { status: 400 });
    }

    const dayDate = new Date(`${date}T00:00:00.000Z`);

    // Overlap check with existing slots for that doctor/date
    const existing = await prisma.slot.findMany({
      where: { doctorId, date: dayDate },
      orderBy: { startTime: "asc" },
    });

    const hasOverlap = existing.some((s: any) => start < s.endTime && end > s.startTime);
    if (hasOverlap) {
      return NextResponse.json(
        { error: "New slot overlaps with an existing slot" },
        { status: 400 }
      );
    }

    const created = await prisma.slot.create({
      data: {
        doctorId,
        date: dayDate,
        startTime: start,
        endTime: end,
        status: "AVAILABLE",
      },
    });

    return NextResponse.json({ slot: created }, { status: 201 });
  } catch (err: any) {
    console.error("POST Slot Error:", err);
    return NextResponse.json(
      { error: err?.message ?? "Server error" },
      { status: 500 }
    );
  }
}
