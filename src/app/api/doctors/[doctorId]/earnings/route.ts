import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ doctorId: string }> }
) {
  const { doctorId } = await params;

  if (!doctorId) {
    return NextResponse.json({ error: "Missing doctorId" }, { status: 400 });
  }

  const url = req.nextUrl.searchParams;

  const startDate = url.get("startDate");
  const endDate = url.get("endDate");
  const startTime = url.get("startTime");
  const endTime = url.get("endTime");

  try {
    const doctor = await prisma.doctor.findUnique({
      where: { id: doctorId },
      select: { fees: true },
    });

    if (!doctor) {
      return NextResponse.json({ error: "Doctor not found" }, { status: 404 });
    }

    const filter: {
      doctorId: string;
      status: string;
      slot?: {
        startTime?: {
          gte?: Date;
          lte?: Date;
        };
      };
    } = {
      doctorId,
      status: "COMPLETED",
    };

    if (startDate || endDate) {
      filter.slot = {
        startTime: {
          ...(startDate && {
            gte: new Date(`${startDate}T${startTime || "00:00"}`),
          }),
          ...(endDate && {
            lte: new Date(`${endDate}T${endTime || "23:59"}`),
          }),
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
      // Construct appointmentDateTime from slot.date and slot.startTime
      const appointmentDateTime = a.slot?.startTime 
        ? new Date(a.slot.startTime)
        : a.slot?.date 
        ? new Date(a.slot.date)
        : new Date();
      
      return {
        id: a.id,
        earned: doctor.fees,
        patientName: a.patient?.user?.name || "Unknown",
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
