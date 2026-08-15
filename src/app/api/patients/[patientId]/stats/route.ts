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

    // Run counts concurrently for fast response times
    const [upcomingAppointments, assignedDoctors, pendingApprovals, completedAppointments] =
      await Promise.all([
        prisma.appointment.count({
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
        }),
        prisma.doctorPatientRelation.count({
          where: {
            patient: {
              id: patientId,
            },
          },
        }),
        prisma.appointment.count({
          where: {
            patientId,
            status: "PENDING",
          },
        }),
        prisma.appointment.count({
          where: {
            patientId,
            status: "COMPLETED",
          },
        }),
      ]);

    // Simple wellness score calculation (0-100) for backward compatibility
    const wellnessScore = Math.min(100, Math.max(0, completedAppointments * 10));

    return NextResponse.json({
      upcomingAppointments,
      assignedDoctors,
      pendingApprovals,
      completedAppointments,
      wellnessScore,
    }, { status: 200 });
  } catch (error: any) {
    console.error("Patient Stats GET Error:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to fetch stats" },
      { status: 500 }
    );
  }
}
