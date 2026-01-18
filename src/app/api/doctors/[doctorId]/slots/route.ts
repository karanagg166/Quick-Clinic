import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const SLOT_DURATION_MINUTES = 10;

// Helper: convert HH:MM to minutes since midnight
function timeStringToMinutes(timeStr: string): number {
  const [hours, minutes] = timeStr.split(":").map(Number);
  return hours * 60 + minutes;
}

// Helper: get day name from date
function getDayName(date: Date): string {
  const days = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ];
  return days[date.getDay()];
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ doctorId: string }> }
) {
  console.log("Slots API called");
  try {
    const { doctorId } = await params;
    const { searchParams } = req.nextUrl;
    const dateStr = searchParams.get("date");
    
    console.log("DoctorId:", doctorId, "Date:", dateStr);

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

    // Check if slots already exist for this date
    const existingSlots = await prisma.slot.findMany({
      where: { 
        doctorId,
        date,
      },
      orderBy: { startTime: "asc" },
    });

    if (existingSlots.length > 0) {
      return NextResponse.json({ slots: existingSlots }, { status: 200 });
    }

    // Fetch doctor's schedule
    const schedule = await prisma.schedule.findUnique({
      where: { doctorId },
      include: { doctor: true },
    });

    if (!schedule) {
      return NextResponse.json(
        { error: "Doctors Schedule Doesnt Exist" },
        { status: 404 }
      );
    }

    // Get day name
    const dayName = getDayName(date);

    // Get schedule for this day - schedule is an array format
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

    // Generate slots for each time slot in the schedule
    const generatedSlots = [];

    for (const timeSlot of daySchedule.slots) {
      if (!timeSlot.start || !timeSlot.end) continue;

      const startMin = timeStringToMinutes(timeSlot.start);
      const endMin = timeStringToMinutes(timeSlot.end);

      // Generate 10-minute slots within this time range
      for (let min = startMin; min < endMin; min += SLOT_DURATION_MINUTES) {
        const startTime = new Date(date);
        startTime.setUTCHours(Math.floor(min / 60), min % 60, 0, 0);

        const endTime = new Date(startTime);
        endTime.setMinutes(endTime.getMinutes() + SLOT_DURATION_MINUTES);

        const slot = await prisma.slot.create({
          data: {
            doctorId,
            date,
            startTime,
            endTime,
            status: "AVAILABLE",
          },
        });

        generatedSlots.push(slot);
      }
    }

    return NextResponse.json({ slots: generatedSlots }, { status: 201 });
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
    const { slotId, status } = await req.json();

    if (!doctorId || !slotId || !status) {
      return NextResponse.json(
        { error: "doctorId, slotId and status are required" },
        { status: 400 }
      );
    }

    const allowedStatuses = ["AVAILABLE", "HELD", "BOOKED", "UNAVAILABLE", "CANCELLED"];
    if (!allowedStatuses.includes(status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
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

    const hasOverlap = existing.some((s:any) => start < s.endTime && end > s.startTime);
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