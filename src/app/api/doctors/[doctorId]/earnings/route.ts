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

    const filter: any = {
      doctorId,
      status: "COMPLETED",
    };

    if (startDate || endDate) {
      filter.appointmentDateTime = {
        ...(startDate && {
          gte: new Date(`${startDate}T${startTime || "00:00"}`),
        }),
        ...(endDate && {
          lte: new Date(`${endDate}T${endTime || "23:59"}`),
        }),
      };
    }

    const appointments = await prisma.appointment.findMany({
      where: filter,
      orderBy: { appointmentDateTime: "desc" },
      select: {
        id: true,
        appointmentDateTime: true,
        patient: {
          select: {
            user: { select: { name: true } },
          },
        },
      },
    });

    // Fix: Add type to `a`
    const earnings = appointments.map((a: any) => ({
      id: a.id,
      earned: doctor.fees,
      patientName: a.patient?.user?.name || "Unknown",
      appointmentDateTime: a.appointmentDateTime,
    }));

    const total = earnings.reduce((sum: number, e: any) => sum + e.earned, 0);

    return NextResponse.json(
      { total, count: earnings.length, earnings },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("Earnings GET Error:", err);
    return NextResponse.json(
      { error: err?.message || "Server error" },
      { status: 500 }
    );
  }
}
