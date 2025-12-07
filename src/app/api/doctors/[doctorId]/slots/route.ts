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

    const date = new Date(dateStr);
    date.setHours(0, 0, 0, 0); // normalize to start of day

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
        { error: "No schedule found for doctor" },
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
        startTime.setHours(Math.floor(min / 60), min % 60, 0, 0);

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