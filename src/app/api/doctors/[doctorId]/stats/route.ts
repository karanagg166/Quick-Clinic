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
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const thisMonthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const nextMonthStart = new Date(today.getFullYear(), today.getMonth() + 1, 1);

    // Today's appointments
    const todayAppointments = await prisma.appointment.count({
      where: {
        doctorId,
        appointmentDateTime: {
          gte: today,
          lt: tomorrow,
        },
        status: {
          in: ["CONFIRMED", "PENDING"],
        },
      },
    });

    // Active patients (patients with at least one appointment)
    const activePatients = await prisma.doctorPatientRelation.count({
      where: {
        doctorId,
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
        appointmentDateTime: {
          gte: thisMonthStart,
          lt: nextMonthStart,
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
  } catch (error: any) {
    console.error("Stats GET Error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to fetch stats" },
      { status: 500 }
    );
  }
}

