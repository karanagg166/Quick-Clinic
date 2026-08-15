import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUserId } from "@/lib/auth";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ doctorId: string }> }
) {
  try {
    const { doctorId } = await params;
    if (!doctorId) {
      return NextResponse.json({ message: "doctorId is required" }, { status: 400 });
    }

    const agg = await prisma.rating.aggregate({
      where: { doctorId },
      _avg: { rating: true },
      _count: { rating: true },
    });

    return NextResponse.json({
      average: agg._avg.rating ? Number(agg._avg.rating.toFixed(1)) : 0,
      count: agg._count.rating ?? 0,
    }, { status: 200 });
  } catch (error: any) {
    console.error("rating-get-error", error);
    return NextResponse.json({ message: error?.message || "Server error" }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ doctorId: string }> }
) {
  try {
    const { doctorId } = await params;
    const authHeader = req.headers.get("authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
    const cookieToken = req.cookies.get("token")?.value;
    const actualToken = token || cookieToken;

    if (!actualToken) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const { valid, userId } = await getUserId(actualToken);
    if (!valid || !userId) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const rating = Number(body?.rating);
    if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
      return NextResponse.json({ message: "Rating must be between 1 and 5" }, { status: 400 });
    }

    // Ensure doctor exists
    const doctor = await prisma.doctor.findUnique({ where: { id: doctorId } });
    if (!doctor) {
      return NextResponse.json({ message: "Doctor not found" }, { status: 404 });
    }

    // Find the patient corresponding to the logged in user
    let patient = await prisma.patient.findUnique({ where: { userId } });
    if (!patient) {
      // If the caller provided a patientId directly in body
      if (body.patientId) {
        patient = await prisma.patient.findUnique({ where: { id: body.patientId } });
      }
    }

    if (!patient) {
      return NextResponse.json({ message: "Patient profile required to rate a doctor" }, { status: 403 });
    }

    // Ensure patient has at least one completed appointment with this doctor
    const completedAppointment = await prisma.appointment.findFirst({
      where: {
        doctorId,
        patientId: patient.id,
        status: "COMPLETED",
      },
    });

    if (!completedAppointment) {
      return NextResponse.json(
        { message: "You can only rate a doctor after completing an appointment with them." },
        { status: 403 }
      );
    }

    // Upsert rating for this patient/doctor
    await prisma.rating.upsert({
      where: {
        doctorId_patientId: {
          doctorId,
          patientId: patient.id,
        },
      },
      update: { rating },
      create: {
        doctorId,
        patientId: patient.id,
        rating,
      },
    });

    // Return updated aggregate
    const agg = await prisma.rating.aggregate({
      where: { doctorId },
      _avg: { rating: true },
      _count: { rating: true },
    });

    return NextResponse.json({
      rating: {
        average: agg._avg.rating ? Number(agg._avg.rating.toFixed(1)) : 0,
        count: agg._count.rating ?? 0,
      },
    }, { status: 200 });
  } catch (error: any) {
    console.error("rating-post-error", error);
    return NextResponse.json({ message: error?.message || "Server error" }, { status: 500 });
  }
}
