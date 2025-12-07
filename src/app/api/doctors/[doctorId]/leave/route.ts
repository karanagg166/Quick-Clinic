import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ doctorId: string }> }
) {
  const { doctorId } = await params;

  if (!doctorId) {
    return NextResponse.json({ error: "Missing doctorId" }, { status: 400 });
  }

  try {
    const { startDate, endDate, reason } = await req.json();

    if (!startDate || !endDate || !reason) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    console.log("Received leave request:", {
      startDate,
      endDate,
      reason,
    });

    const startDateTime = new Date(startDate);
    const endDateTime = new Date(endDate);

    console.log("Parsed DateTimes:", { startDateTime, endDateTime });

    const leaveRequest = await prisma.leave.create({
      data: {
        doctorId,
        startDate: startDateTime,
        endDate: endDateTime,
        reason,
      },
    });

    return NextResponse.json(leaveRequest, { status: 201 });
  } catch (err: any) {
    console.error("Doctor Leave Error:", err);
    return NextResponse.json(
      { error: err?.message ?? "Server error" },
      { status: 500 }
    );
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ doctorId: string }> }
) {
  const { doctorId } = await params;

  if (!doctorId) {
    return NextResponse.json({ error: "Missing doctorId" }, { status: 400 });
  }

  try {
    const leaves = await prisma.leave.findMany({
      where: { doctorId },
      orderBy: { startDate: "desc" },
    });
    

    return NextResponse.json(leaves, { status: 200 });
  } catch (err: any) {
    console.error("Get Leave Error:", err);
    return NextResponse.json(
      { error: err?.message ?? "Server error" },
      { status: 500 }
    );
  }
}
