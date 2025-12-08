import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// ========================================================
// POST → CREATE or UPDATE Doctor Schedule (UPSERT)
// ========================================================
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ doctorId: string }> }
) {
  try {
    const { doctorId } = await params;

    if (!doctorId) {
      return NextResponse.json({ error: "Missing doctorId" }, { status: 400 });
    }
  
    const { weeklySchedule } = await req.json();
    console.log(weeklySchedule);

    if (!weeklySchedule) {
      return NextResponse.json(
        { error: "Missing weeklySchedule" },
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
