import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ doctorId: string }> }
) {
  try {
    const { doctorId } = await params;

    if (!doctorId) {
      return NextResponse.json({ error: "Missing doctorId" }, { status: 400 });
    }

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);

    const thisMonthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
    const nextMonthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 1));

    // Today's appointments
    const todayAppointments = await prisma.appointment.count({
      where: {
        doctorId,
        slot: {
          startTime: {
            gte: today,
            lt: tomorrow,
          },
        },
        status: {
          in: ["CONFIRMED", "PENDING"],
        },
      },
    });

    // Active patients (patients with at least one appointment)
    const activePatients = await prisma.doctorPatientRelation.count({
      where: {
        doctor: {
          id: doctorId,
        },
      },
    });

    // Pending consults (appointments with PENDING status)
    const pendingConsults = await prisma.appointment.count({
      where: {
        doctorId,
        status: "PENDING",
      },
    });

    // This month's earnings
    const thisMonthEarnings = await prisma.appointment.findMany({
      where: {
        doctorId,
        status: "COMPLETED",
        slot: {
          startTime: {
            gte: thisMonthStart,
            lt: nextMonthStart,
          },
        },
      },
      select: {
        id: true,
      },
    });

    const doctor = await prisma.doctor.findUnique({
      where: { id: doctorId },
      select: { fees: true },
    });

    const monthlyEarnings = (doctor?.fees || 0) * thisMonthEarnings.length;

    return NextResponse.json({
      todayAppointments,
      activePatients,
      pendingConsults,
      monthlyEarnings,
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : "Failed to fetch stats";
    console.error("Stats GET Error:", error);
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}

