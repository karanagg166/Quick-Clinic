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
      // Segregate existing slots by session
      const morning: any[] = [];
      const evening: any[] = [];

      existingSlots.forEach((slot: any) => {
        const hour = new Date(slot.startTime).getHours();
        if (hour < 14) {
          morning.push(slot);
        } else {
          evening.push(slot);
        }
      });

      return NextResponse.json({ morning, evening }, { status: 200 });
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

    // Get schedule for this day
    const weeklySchedule = schedule.weeklySchedule as any;
    const daySchedule = weeklySchedule[dayName];

    if (!daySchedule) {
      return NextResponse.json(
        { error: `No schedule found for ${dayName}` },
        { status: 404 }
      );
    }

    // If all times are empty, doctor is not available
    if (
      !daySchedule.morningStart ||
      !daySchedule.morningEnd ||
      !daySchedule.eveningStart ||
      !daySchedule.eveningEnd
    ) {
      return NextResponse.json({ slots: [] }, { status: 200 });
    }

    // Generate slots for morning and evening
    const morningSlots = [];
    const eveningSlots = [];

    // Morning slots
    const morningStartMin = timeStringToMinutes(daySchedule.morningStart);
    const morningEndMin = timeStringToMinutes(daySchedule.morningEnd);

    for (let min = morningStartMin; min < morningEndMin; min += SLOT_DURATION_MINUTES) {
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
      morningSlots.push(slot);
    }

    // Evening slots
    const eveningStartMin = timeStringToMinutes(daySchedule.eveningStart);
    const eveningEndMin = timeStringToMinutes(daySchedule.eveningEnd);

    for (let min = eveningStartMin; min < eveningEndMin; min += SLOT_DURATION_MINUTES) {
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
      eveningSlots.push(slot);
    }

    return NextResponse.json({ morning: morningSlots, evening: eveningSlots }, { status: 201 });
  } catch (err: any) {
    console.error("GET Slots Error:", err);
    return NextResponse.json(
      { error: err?.message ?? "Server error" },
      { status: 500 }
    );
  }
}