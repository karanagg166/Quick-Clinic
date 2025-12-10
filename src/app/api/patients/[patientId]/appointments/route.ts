import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { PatientAppointment } from "@/types/patient";

export async function GET(req: Request, { params }: { params: Promise<{ patientId: string }> }) {
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
      where.doctor.fees = Number(searchParams.get("fees"));
    }

    if (searchParams.get("specialty")) {
      where.doctor.specialty = searchParams.get("specialty");
    }

    if (searchParams.get("date")) {
      where.slot.date = new Date(searchParams.get("date") as string);
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
                city: true,
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
    });

    const patientAppointments: PatientAppointment[] = appointments.map((a: any) => ({
      id: a.id,
      appointmentDate: a.slot?.date?.toISOString() ?? "",
      appointmentTime: a.slot?.startTime ?? "",
      doctorName: a.doctor.user.name,
      doctorEmail: a.doctor.user.email,
      city: a.doctor.user.city,
      fees: a.doctor.fees,
      status: a.status,
      specialty: a.doctor.specialty,
    }));

    return NextResponse.json(patientAppointments, { status: 200 });
  } catch (err) {
    return NextResponse.json({ error: "Failed to fetch appointments" }, { status: 500 });
  }
}
export async function POST(req: Request, { params }: { params: Promise<{ patientId: string }> }){
    try {  
     const {doctorId,slotId}=await req.json();
       const {patientId}=await params;
     // Create appointment
     const appointment = await prisma.appointment.create({
         data: {
             doctorId,
            patientId,
             slotId,
             status: 'PENDING',
         },
     });

    const slotUpdate = await prisma.slot.update({
        where: { id: slotId },
        data: { status: 'BOOKED' },
     });
    return NextResponse.json({appointment,slotUpdate},{status:201});

}
    catch (err: any) {
        return NextResponse.json({message:"internal server error"},{status:500});
    }
 }
// -------------------------------------------------------------

