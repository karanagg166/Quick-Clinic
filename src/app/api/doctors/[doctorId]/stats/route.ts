import { getAuthenticatedUser } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ doctorId: string }> }
) {
  try {
    const authUser = await getAuthenticatedUser(req, { verifyDb: true });
    if (!authUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { doctorId } = await params;

    if (!doctorId) {
      return NextResponse.json({ error: "Missing doctorId" }, { status: 400 });
    }

    const owner = await prisma.doctor.findUnique({ where: { id: doctorId }, select: { userId: true } });
    if (!owner) return NextResponse.json({ error: "Doctor not found" }, { status: 404 });
    if (authUser.role !== "ADMIN" && (authUser.role !== "DOCTOR" || owner.userId !== authUser.id)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);

    const thisMonthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
    const nextMonthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 1));

    // Run queries concurrently for fast response times
    const [todayAppointments, activePatients, pendingConsults, thisMonthEarnings, doctor] =
      await Promise.all([
        prisma.appointment.count({
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
        }),
        prisma.doctorPatientRelation.count({
          where: {
            doctor: {
              id: doctorId,
            },
          },
        }),
        prisma.appointment.count({
          where: {
            doctorId,
            status: "PENDING",
          },
        }),
        prisma.appointment.findMany({
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
        }),
        prisma.doctor.findUnique({
          where: { id: doctorId },
          select: { fees: true },
        }),
      ]);

    const monthlyEarnings = (doctor?.fees || 0) * thisMonthEarnings.length;

    return NextResponse.json({
      todayAppointments,
      activePatients,
      pendingConsults,
      monthlyEarnings,
    }, { status: 200 });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : "Failed to fetch stats";
    console.error("Doctor Stats GET Error:", error);
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}
