import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser } from "@/lib/auth";
import { validateWeeklySchedule } from "@/lib/scheduleUtils";

// ========================================================
// POST → CREATE or UPDATE Doctor Schedule (UPSERT)
// ========================================================
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ doctorId: string }> }
) {
  try {
    const authUser = await getAuthenticatedUser(req, { verifyDb: true });
    if (!authUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

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

    if (authUser.role !== "ADMIN" && (authUser.role !== "DOCTOR" || doctor.userId !== authUser.id)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  
    const body = await req.json().catch(() => ({}));
    const { weeklySchedule } = body;

    if (!weeklySchedule) {
      return NextResponse.json(
        { error: "Missing weeklySchedule" },
        { status: 400 }
      );
    }

    // Validate that schedule has no overlapping or invalid slots
    const validation = validateWeeklySchedule(weeklySchedule);
    if (!validation.isValid) {
      return NextResponse.json(
        { error: validation.error },
        { status: 400 }
      );
    }

    // UPSERT — create if not exists, update if exists
    const schedule = await prisma.schedule.upsert({
      where: { doctorId },
      update: { weeklySchedule },
      create: {
        doctorId,
        weeklySchedule,
      },
    });

    return NextResponse.json(schedule, { status: 201 });
  } catch (err: any) {
    console.error("POST Schedule Error:", err);
    return NextResponse.json(
      { error: err?.message ?? "Server error" },
      { status: 500 }
    );
  }
}

// ========================================================
// GET → Get doctor schedule
// ========================================================
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ doctorId: string }> }
) {
  try {
    const { doctorId } = await params;

    if (!doctorId) {
      return NextResponse.json({ error: "Missing doctorId" }, { status: 400 });
    }

    const schedule = await prisma.schedule.findUnique({
      where: { doctorId },
    });

    if (!schedule) {
      return NextResponse.json(
        { error: "No schedule found for this doctor" },
        { status: 404 }
      );
    }

    return NextResponse.json(schedule, { status: 200 });
  } catch (err: any) {
    console.error("GET Schedule Error:", err);
    return NextResponse.json(
      { error: err?.message ?? "Server error" },
      { status: 500 }
    );
  }
}
