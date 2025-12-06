import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest) {
  const doctorId = req.cookies.get("doctorId")?.value;

  if (!doctorId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { startDate, endDate, reason, startTime, endTime } = await req.json();

    if (!startDate || !endDate || !reason || !startTime || !endTime) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    console.log("Received leave request:", {
      startDate,
      endDate,
      reason,
      startTime,
      endTime,
    });

    // Combine date + time
    const startDateTime = new Date(`${startDate}T${startTime}:00`);
    const endDateTime = new Date(`${endDate}T${endTime}:00`);

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

export async function GET(req: NextRequest) {
  const doctorId = req.cookies.get("doctorId")?.value;

  if (!doctorId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const params=req.nextUrl.searchParams;
    const startDate=params.get("startDate");
    const endDate=params.get("endDate");
    const reason=params.get("reason");
    const startTime=params.get("startTime");
    const endTime=params.get("endTime");
    

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
