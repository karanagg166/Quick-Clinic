import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { DoctorAppointment } from "@/types/doctor";
import { autoExpirePastAppointments } from "@/lib/appointment-expiry";
import { getAuthenticatedUser } from "@/lib/auth";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ doctorId: string }> }
) {
  try {
    const { doctorId } = await params;

    if (!doctorId) {
      return NextResponse.json(
        { error: "doctorId required" },
        { status: 400 }
      );
    }

    const doctor = await prisma.doctor.findUnique({
      where: { id: doctorId },
      select: { userId: true },
    });

    if (!doctor) {
      return NextResponse.json({ error: "Doctor not found" }, { status: 404 });
    }

    const authUser = await getAuthenticatedUser(req);
    if (authUser && doctor.userId !== authUser.id && authUser.role !== "ADMIN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (process.env.NODE_ENV !== "test") {
      autoExpirePastAppointments().catch((e) => console.warn("Auto-expire appointments warning:", e));
    }

    const { searchParams } = req.nextUrl;

    const where: any = {
      doctorId,
      patient: { user: {} },
      slot: {},
    };

    // ---------------------
    //   BASIC FILTERS
    // ---------------------
    if (searchParams.get("status")) where.status = searchParams.get("status");

    if (searchParams.get("paymentMethod")) {
      where.paymentMethod = searchParams.get("paymentMethod");
    }

    if (searchParams.get("patientName")) {
      where.patient.user.name = {
        contains: searchParams.get("patientName") as string,
        mode: "insensitive",
      };
    }

    if (searchParams.get("gender")) {
      where.patient.user.gender = searchParams.get("gender");
    }

    if (searchParams.get("city")) {
      where.patient.user.location = {
        city: {
          contains: searchParams.get("city") as string,
          mode: "insensitive",
        },
      };
    }

    if (searchParams.get("age")) {
      const ageNum = Number(searchParams.get("age"));
      if (!isNaN(ageNum)) {
        where.patient.user.age = ageNum;
      }
    }

    if (searchParams.get("patientEmail")) {
      where.patient.user.email = {
        contains: searchParams.get("patientEmail") as string,
        mode: "insensitive",
      };
    }

    // -------------------------------------
    //   DATETIME RANGE FILTER (gte / lte)
    // -------------------------------------
    const startDate = searchParams.get("startDate");
    const startTime = searchParams.get("startTime");
    const endDate = searchParams.get("endDate");
    const endTime = searchParams.get("endTime");

    if (startDate && endDate) {
      const startDateTime = new Date(`${startDate}T${startTime || "00:00:00"}`);
      const endDateTime = new Date(`${endDate}T${endTime || "23:59:59"}`);

      if (!isNaN(startDateTime.getTime()) && !isNaN(endDateTime.getTime())) {
        where.slot = {
          ...where.slot,
          startTime: { gte: startDateTime },
          endTime: { lte: endDateTime },
        };
      }
    }

    // ---------------------
    //     QUERY DB
    // ---------------------
    const appointments = await prisma.appointment.findMany({
      where: where,
      include: {
        slot: true,
        patient: {
          include: {
            user: {
              include: { location: true },
            },
          },
        },
      },
      orderBy: {
        slot: {
          startTime: "asc",
        },
      },
    });

    // ---------------------
    //  MAP TO INTERFACE
    // ---------------------
    const doctorAppointments: DoctorAppointment[] = appointments.map((a: any) => ({
      id: a.id,
      patientName: a.patient?.user?.name || "Patient",
      patientString: a.patient?.user?.email || "",
      gender: a.patient?.user?.gender || "",
      city: a.patient?.user?.location?.city ?? "N/A",
      age: a.patient?.user?.age || 0,
      appointmentDate: a.slot?.date?.toISOString() ?? "",
      appointmentTime: a.slot?.startTime?.toISOString() ?? "",
      status: a.status,
      paymentMethod: a.paymentMethod,
    }));

    return NextResponse.json(doctorAppointments, { status: 200 });
  } catch (err) {
    console.error("Doctor appointments GET error:", err);
    return NextResponse.json(
      { error: "Failed to fetch appointments" },
      { status: 500 }
    );
  }
}
