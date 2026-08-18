import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser } from "@/lib/auth";
import { AppointmentStatus } from "@/generated/prisma";

export async function GET(
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
      select: { fees: true, userId: true },
    });

    if (!doctor) {
      return NextResponse.json({ error: "Doctor not found" }, { status: 404 });
    }

    const authUser = await getAuthenticatedUser(req);
    if (authUser && doctor.userId !== authUser.id && authUser.role !== "ADMIN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const url = req.nextUrl.searchParams;
    const startDate = url.get("startDate");
    const endDate = url.get("endDate");
    const startTime = url.get("startTime");
    const endTime = url.get("endTime");

    const filter: {
      doctorId: string;
      status: AppointmentStatus;
      slot?: {
        startTime?: {
          gte?: Date;
          lte?: Date;
        };
      };
    } = {
      doctorId,
      status: AppointmentStatus.COMPLETED,
    };

    if (startDate || endDate) {
      const gteDate = startDate ? new Date(`${startDate}T${startTime || "00:00:00"}`) : undefined;
      const lteDate = endDate ? new Date(`${endDate}T${endTime || "23:59:59"}`) : undefined;

      filter.slot = {
        startTime: {
          ...(gteDate && !isNaN(gteDate.getTime()) && { gte: gteDate }),
          ...(lteDate && !isNaN(lteDate.getTime()) && { lte: lteDate }),
        },
      };
    }

    const appointments = await prisma.appointment.findMany({
      where: filter,
      orderBy: { slot: { startTime: "desc" } },
      select: {
        id: true,
        slot: {
          select: {
            date: true,
            startTime: true,
          },
        },
        patient: {
          select: {
            user: { select: { name: true } },
          },
        },
      },
    });

    // Map appointments to earnings format
    const earnings = appointments.map((a: any) => {
      const appointmentDateTime = a.slot?.startTime 
        ? new Date(a.slot.startTime)
        : a.slot?.date 
        ? new Date(a.slot.date)
        : new Date();
      
      return {
        id: a.id,
        earned: doctor.fees,
        patientName: a.patient?.user?.name || "Patient",
        appointmentDateTime: appointmentDateTime.toISOString(),
      };
    });

    const total = earnings.reduce((sum: number, e: any) => sum + e.earned, 0);

    return NextResponse.json(
      { total, count: earnings.length, earnings },
      { status: 200 }
    );
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : "Server error";
    console.error("Earnings GET Error:", err);
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}
