import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser } from "@/lib/auth";
import { logAccess } from "@/lib/logger";
import { AppointmentStatus } from "@/generated/prisma";

export async function GET(req: NextRequest) {
  try {
    const authUser = await getAuthenticatedUser(req, { verifyDb: true });
    if (!authUser) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 }
      );
    }

    if (authUser.role !== "DOCTOR") {
      return NextResponse.json(
        { error: "Access denied. Only doctors can access this endpoint." },
        { status: 403 }
      );
    }

    const doctor = await prisma.doctor.findUnique({
      where: { userId: authUser.id },
      select: { id: true },
    });

    if (!doctor) {
      return NextResponse.json(
        { error: "Doctor profile not found" },
        { status: 404 }
      );
    }

    // Only appointments with CONFIRMED or COMPLETED grant medical record access
    const qualifyingAppointments = await prisma.appointment.findMany({
      where: {
        doctorId: doctor.id,
        status: {
          in: [AppointmentStatus.CONFIRMED, AppointmentStatus.COMPLETED],
        },
      },
      include: {
        slot: {
          select: {
            date: true,
            startTime: true,
            endTime: true,
          },
        },
      },
      orderBy: {
        bookedAt: "desc",
      },
    });

    if (qualifyingAppointments.length === 0) {
      // Log list access even if zero patients
      await logAccess(
        authUser.id,
        doctor.id,
        "MEDICAL_DOCUMENT_LIST",
        "MEDICAL_RECORD"
      );
      return NextResponse.json([], { status: 200 });
    }

    // Group latest appointment by patientId
    const latestApptByPatient = new Map<string, (typeof qualifyingAppointments)[0]>();
    for (const appt of qualifyingAppointments) {
      if (!latestApptByPatient.has(appt.patientId)) {
        latestApptByPatient.set(appt.patientId, appt);
      }
    }

    const patientIds = Array.from(latestApptByPatient.keys());

    const patients = await prisma.patient.findMany({
      where: {
        id: { in: patientIds },
      },
      select: {
        id: true,
        user: {
          select: {
            name: true,
            age: true,
            gender: true,
            profileImageUrl: true,
          },
        },
      },
    });

    // Patient lookup map
    const patientMap = new Map(patients.map((p) => [p.id, p]));

    const result = patientIds
      .map((patientId) => {
        const patient = patientMap.get(patientId);
        if (!patient) return null;

        const appt = latestApptByPatient.get(patientId);
        const lastApptTime =
          appt?.slot?.startTime?.toISOString() ||
          appt?.slot?.date?.toISOString() ||
          appt?.bookedAt.toISOString() ||
          null;

        return {
          id: patient.id,
          name: patient.user?.name || "Patient",
          age: patient.user?.age ?? null,
          gender: patient.user?.gender ?? null,
          profileImageUrl: patient.user?.profileImageUrl ?? null,
          lastAppointment: lastApptTime,
          relationship: appt?.status || AppointmentStatus.CONFIRMED,
        };
      })
      .filter(Boolean);

    // Audit log for medical-record patient list access
    await logAccess(
      authUser.id,
      doctor.id,
      "MEDICAL_DOCUMENT_LIST",
      "MEDICAL_RECORD"
    );

    return NextResponse.json(result, { status: 200 });
  } catch (error: any) {
    console.error("Failed to fetch medical record patients:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to retrieve accessible patients" },
      { status: 500 }
    );
  }
}
