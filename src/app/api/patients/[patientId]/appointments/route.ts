import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/logger";
import type { PatientAppointment } from "@/types/patient";

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
  req: Request,
  { params }: { params: Promise<{ patientId: string }> }
) {
  try {
    const { doctorId, slotId, paymentMethod, transactionId } = await req.json();
    const { patientId } = await params;

    // Validation
    if (!doctorId || !slotId) {
      return NextResponse.json(
        { message: "Doctor ID and Slot ID are required" },
        { status: 400 }
      );
    }

    // Verify slot is available
    const slot = await prisma.slot.findUnique({
      where: { id: slotId },
    });

    if (!slot || slot.doctorId !== doctorId) {
      return NextResponse.json(
        { message: "Slot not found" },
        { status: 404 }
      );
    }

    if (slot.status !== "AVAILABLE") {
      return NextResponse.json(
        { message: `Slot is not available (current status: ${slot.status})` },
        { status: 409 }
      );
    }

    // Create appointment with payment details
    const appointment = await prisma.appointment.create({
      data: {
        doctorId,
        patientId,
        slotId,
        status: 'PENDING',
        paymentMethod: paymentMethod || 'OFFLINE',
        transactionId: transactionId || null,
      },
    });

    // Update slot status to BOOKED
    const slotUpdate = await prisma.slot.update({
      where: { id: slotId },
      data: { status: 'BOOKED' },
    });

    // Send notification to doctor via Socket.IO
    try {
      const socketServerUrl = process.env.NEXT_PUBLIC_SOCKET_URL || process.env.SOCKET_SERVER_URL || 'http://localhost:4000';
      await fetch(`${socketServerUrl}/api/notifications/appointment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          doctorId,
          appointmentId: appointment.id,
        }),
      }).catch(() => {});
    } catch {}

    // Log Audit
    await logAudit(patientId, "Booked Appointment", { appointmentId: appointment.id, doctorId, slotId });

    return NextResponse.json({ appointment, slotUpdate }, { status: 201 });

  } catch (err: any) {
    console.error("Booking Error:", err);
    return NextResponse.json(
      { message: "Internal server error", error: err?.message || "Failed to book appointment" },
      { status: 500 }
    );
  }
}
