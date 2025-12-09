import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const patientId = url.searchParams.get("patientId");
    const doctorName = url.searchParams.get("doctorName");
    const specialty = url.searchParams.get("specialty");
    const date = url.searchParams.get("date");
    const status = url.searchParams.get("status");

    if (!patientId)
      return NextResponse.json({ error: "patientId required" }, { status: 400 });

    const where: any = { patientId };

    if (status) where.status = status;
    if (date) where.slot = { is: { date: new Date(date) } };

    if (doctorName || specialty) {
      where.doctor = {
        is: {
          ...(specialty ? { specialty } : {}),
          user: doctorName
            ? { is: { name: { contains: doctorName, mode: "insensitive" } } }
            : undefined,
        },
      };
    }

    const appts = await prisma.appointment.findMany({
      where,
      include: {
        doctor: { include: { user: true } },
        slot: true,
      },
    });

    const formatted = appts.map((a) => ({
      id: a.id,
      status: a.status,
      doctorName: a.doctor.user.name,
      specialty: a.doctor.specialty,
      slotDate: a.slot.date.toISOString().split("T")[0],
      slotStart: a.slot.startTime.toLocaleString(),
      slotEnd: a.slot.endTime.toLocaleString(),
    }));

    return NextResponse.json(formatted);
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to fetch appointments" },
      { status: 500 }
    );
  }
}



export async function DELETE(req: Request) {
  try {
    const { appointmentId } = await req.json();

    const appointment = await prisma.appointment.findUnique({
      where: { id: appointmentId },
    });

    await prisma.$transaction([
      prisma.appointment.update({
        where: { id: appointmentId },
        data: { status: "CANCELLED" },
      }),
      prisma.slot.update({
        where: { id: appointment.slotId },
        data: { status: "AVAILABLE" },
      }),
    ]);

    return NextResponse.json({ message: "Cancelled" });
  } catch {
    return NextResponse.json({ error: "Failed to cancel" }, { status: 500 });
  }
}

