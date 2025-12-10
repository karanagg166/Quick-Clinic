import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * NOTE:
 * The second argument shape coming from Next may make `params` a Promise.
 * To be safe, `await params` before accessing doctorId.
 */

/* POST - create a leave request for doctorId */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ doctorId: string }> } // keep as Promise
) {
  try {
    const { doctorId } = await params;
    if (!doctorId) {
      return NextResponse.json({ error: "Missing doctorId" }, { status: 400 });
    }

    const body = await req.json().catch(() => ({}));
    const { startDate, endDate, reason,userId } = body || {};

    if (!startDate || !endDate || !reason) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const startDateTime = new Date(startDate);
    const endDateTime = new Date(endDate);
    if (isNaN(startDateTime.getTime()) || isNaN(endDateTime.getTime())) {
      return NextResponse.json({ error: "Invalid date format" }, { status: 400 });
    }
    const checkLeaveConflict = await prisma.leave.findFirst({
 where:{
  doctorId,
  OR:[
{startDate:{
    gte:startDateTime,
    lte:endDateTime
  }}
  ,{endDate:{
    gte:startDateTime,
    lte:endDateTime
  }}
  ]
  
 }


    })
     if(checkLeaveConflict){
  return NextResponse.json({error:"Leave request conflicts with existing leave"}, {status:409}) }

    // create the leave
    const leaveRequest = await prisma.leave.create({
      data: {
        doctorId,
        startDate: startDateTime,
        endDate: endDateTime,
        reason,
      },
    });
     const notification=await prisma.notification.create({
      data:{
        userId,
        message:"leave request has been successfully added"
      }
     });
    return NextResponse.json(leaveRequest, { status: 201 });
  } catch (err: any) {
    console.error("Doctor Leave POST Error:", err);
    return NextResponse.json({ error: err?.message ?? "Server error" }, { status: 500 });
  }
}

/* GET - list leaves for doctorId with optional filters */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ doctorId: string }> } // keep as Promise
) {
  try {
    const { doctorId } = await params;
    if (!doctorId) {
      return NextResponse.json({ error: "Missing doctorId" }, { status: 400 });
    }

    console.log("Fetching leaves for doctorId:", doctorId);

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
      // find leaves that start on/after this date
      where.startDate = { ...(where.startDate ?? {}), gte: d };
    }

    if (endDateParam) {
      const d = new Date(endDateParam);
      if (isNaN(d.getTime())) {
        return NextResponse.json({ error: "Invalid endDate" }, { status: 400 });
      }
      // find leaves that start on/before this date
      where.startDate = { ...(where.startDate ?? {}), lte: d };
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
