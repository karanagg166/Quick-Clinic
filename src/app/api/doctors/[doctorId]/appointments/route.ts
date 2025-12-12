import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { DoctorAppointment } from "@/types/doctor";

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
      where.patient.user.city = {
        contains: searchParams.get("city") as string,
        mode: "insensitive",
      };
    }

    if (searchParams.get("age")) {
      where.patient.user.age = Number(searchParams.get("age"));
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

    if (startDate && startTime && endDate && endTime) {
      const startDateTime = new Date(`${startDate}T${startTime}`);
      const endDateTime = new Date(`${endDate}T${endTime}`);

      where.slot = {
        ...where.slot,
        startTime: { gte: startDateTime },
        endTime: { lte: endDateTime },
      };
    }

    // ---------------------
    //     QUERY DB
    // ---------------------
    const appointments = await prisma.appointment.findMany({
      where: where,
      include: {
        slot: true,
        patient: {
          include: { user: true },
        },
      },
    });

    // ---------------------
    //  MAP TO INTERFACE
    // ---------------------
    const doctorAppointments: DoctorAppointment[] = appointments.map((a: any) => ({
      id: a.id,
      patientName: a.patient.user.name,
      patientString: a.patient.user.email,
      gender: a.patient.user.gender,
      city: a.patient.user.city,
      age: a.patient.user.age,
      appointmentDate: a.slot?.date?.toISOString() ?? "",
      appointmentTime: a.slot?.startTime ?? "",
      status: a.status,
      paymentMethod:a.paymentMethod
      
    }));

    return NextResponse.json(doctorAppointments, { status: 200 });

  } catch (err) {
    return NextResponse.json(
      { error: "Failed to fetch appointments" },
      { status: 500 }
    );
  }
}
