import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ patientId: string }> }
) {
  try {
    const { patientId } = await params;

    if (!patientId) {
      return NextResponse.json({ error: "Missing patientId" }, { status: 400 });
    }

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);

    // Upcoming appointments
    const upcomingAppointments = await prisma.appointment.count({
      where: {
        patientId,
        slot: {
          date: {
            gte: today,
          },
        },
        status: {
          in: ["CONFIRMED", "PENDING"],
        },
      },
    });

    // Assigned doctors
    const assignedDoctors = await prisma.doctorPatientRelation.count({
      where: {
        patient: {
          id: patientId
        },
      },
    });

    // Pending approvals (appointments with PENDING status)
    const pendingApprovals = await prisma.appointment.count({
      where: {
        patientId,
        status: "PENDING",
      },
    });

    // Wellness score (placeholder - can be calculated based on completed appointments, follow-ups, etc.)
    const completedAppointments = await prisma.appointment.count({
      where: {
        patientId,
        status: "COMPLETED",
      },
    });

    // Simple wellness score calculation (0-100)
    const wellnessScore = Math.min(100, Math.max(0, completedAppointments * 10));

    return NextResponse.json({
      upcomingAppointments,
      assignedDoctors,
      pendingApprovals,
      wellnessScore,
    });
  } catch (error: any) {
    console.error("Stats GET Error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to fetch stats" },
      { status: 500 }
    );
  }
}

