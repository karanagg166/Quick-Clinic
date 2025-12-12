import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = req.nextUrl;

    const doctorId = searchParams.get("doctorId");
    if (!doctorId)
      return NextResponse.json({ error: "doctorId missing" }, { status: 400 });

    const patientName = searchParams.get("patientName") ?? undefined;
    const dateStr = searchParams.get("date") ?? undefined;
    const status = searchParams.get("status") ?? undefined;

    const where: any = { doctorId };

    if (status) where.status = status;

    if (dateStr) {
      where.slot = {
        is: { date: new Date(dateStr) },
      };
    }

    if (patientName) {
      where.patient = {
        is: {
          user: {
            is: {
              name: { contains: patientName, mode: "insensitive" },
            },
          },
        },
      };
    }

    const appts = await prisma.appointment.findMany({
      where,
      include: {
        slot: true,
        patient: {
          include: { user: true },
        },
      },
      orderBy: { bookedAt: "desc" },
    });

    const formatted = appts.map((a:any) => ({
      id: a.id,
      slotId: a.slotId,
      slotStart: a.slot?.startTime,
      slotEnd: a.slot?.endTime,
      status: a.status,
      notes: a.notes,
      patientId: a.patientId,
      patientName: a.patient?.user?.name ?? "",
      patientContact: a.patient?.user?.phone ?? "",
    }));

    return NextResponse.json(formatted, { status: 200 });
  } catch (err) {
    console.log("doctor appts error:", err);
    return NextResponse.json(
      { error: "Failed to fetch appointments" },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { appointmentId } = await req.json();

    if (!appointmentId)
      return NextResponse.json({ error: "Missing appointmentId" }, { status: 400 });

    const appt = await prisma.appointment.findUnique({
      where: { id: appointmentId },
    });

    if (!appt)
      return NextResponse.json({ error: "Appointment not found" }, { status: 404 });

    await prisma.$transaction([
      prisma.appointment.update({
        where: { id: appointmentId },
        data: { status: "CANCELLED" },
      }),
      prisma.slot.update({
        where: { id: appt.slotId },
        data: { status: "AVAILABLE" },
      }),
    ]);

    return NextResponse.json({ message: "Appointment cancelled" }, { status: 200 });
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to cancel appointment" },
      { status: 500 }
    );
  }
}
