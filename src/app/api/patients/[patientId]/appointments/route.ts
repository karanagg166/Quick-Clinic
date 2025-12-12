import { NextResponse,NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
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
export async function POST(
  req: Request, 
  { params }: { params: Promise<{ patientId: string }> }
) {
  try {  
    // 1. Destructure the new optional fields
    // paymentId comes from the frontend when paymentMethod is 'ONLINE'
    const { doctorId, slotId, paymentMethod, transactionId } = await req.json();
    const { patientId } = await params;

    // 2. Validation
    if (!doctorId || !slotId) {
      return NextResponse.json(
        { message: "Doctor ID and Slot ID are required" }, 
        { status: 400 }
      );
    }

    // 3. Create appointment with payment details
    const appointment = await prisma.appointment.create({
      data: {
        doctorId,
        patientId,
        slotId,
        status: 'PENDING', 
        // Save the payment info
        paymentMethod: paymentMethod || 'OFFLINE', // Default to OFFLINE if not sent
        transactionId           // Optional: Store the transaction ID
      },
    });

    // 4. Update the slot status
    const slotUpdate = await prisma.slot.update({
      where: { id: slotId },
      data: { status: 'BOOKED' },
    });

    return NextResponse.json({ appointment, slotUpdate }, { status: 201 });

  } catch (err: any) {
    console.error("Booking Error:", err);
    return NextResponse.json(
        { message: "Internal server error", error: err.message }, 
        { status: 500 }
    );
  }
}