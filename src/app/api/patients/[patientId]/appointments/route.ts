import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import type { PatientAppointment } from "@/types/patient";
import { getAuthenticatedPatient } from "@/lib/request-auth";

export async function GET(req: NextRequest, { params }: { params: Promise<{ patientId: string }> }) {
  try {
    const { patientId } = await params;

    if (!patientId) {
      return NextResponse.json({ error: "patientId required" }, { status: 400 });
    }

    const { searchParams } = req.nextUrl;

    const where: any = {
      patientId,
      doctor: {
        user: {},
      },
      slot: {},
    };

    if (searchParams.get("status")) {
      where.status = searchParams.get("status");
    }

    if (searchParams.get("doctorName")) {
      where.doctor.user.name = {
        contains: searchParams.get("doctorName") as string,
        mode: "insensitive",
      };
    }

    if (searchParams.get("fees")) {
      const feesNum = Number(searchParams.get("fees"));
      if (!isNaN(feesNum)) {
        where.doctor.fees = feesNum;
      }
    }

    if (searchParams.get("specialty")) {
      where.doctor.specialty = searchParams.get("specialty");
    }

    if (searchParams.get("date")) {
      const dateVal = new Date(searchParams.get("date") as string);
      if (!isNaN(dateVal.getTime())) {
        where.slot.date = dateVal;
      }
    }

    const appointments = await prisma.appointment.findMany({
      where: where,
      select: {
        id: true,
        status: true,
        doctor: {
          select: {
            user: {
              select: {
                name: true,
                email: true,
                location: {
                  select: {
                    city: true,
                    state: true,
                  },
                },
              },
            },
            fees: true,
            specialty: true,
          },
        },
        slot: {
          select: {
            date: true,
            startTime: true,
          },
        },
      },
      orderBy: {
        slot: {
          startTime: "desc",
        },
      },
    });

    const patientAppointments: PatientAppointment[] = appointments.map((a: any) => ({
      id: a.id,
      appointmentDate: a.slot?.date?.toISOString() ?? "",
      appointmentTime: a.slot?.startTime?.toISOString() ?? "",
      doctorName: a.doctor?.user?.name || "Doctor",
      doctorEmail: a.doctor?.user?.email || "",
      city: a.doctor?.user?.location?.city || "N/A",
      state: a.doctor?.user?.location?.state || "N/A",
      fees: a.doctor?.fees || 0,
      status: a.status,
      specialty: a.doctor?.specialty || "",
    }));

    return NextResponse.json(patientAppointments, { status: 200 });
  } catch (err: any) {
    console.error("Patient appointments GET error:", err);
    return NextResponse.json({ error: "Failed to fetch appointments" }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ patientId: string }> }
) {
  const { patientId } = await params;
  const patient = await getAuthenticatedPatient(req);
  if (!patient) return NextResponse.json({ message: "Authentication required" }, { status: 401 });
  if (patient.id !== patientId) return NextResponse.json({ message: "Forbidden" }, { status: 403 });

  return NextResponse.json(
    { message: "Use /api/appointments/hold followed by /api/appointments/confirm to book a slot" },
    { status: 410 },
  );
}
