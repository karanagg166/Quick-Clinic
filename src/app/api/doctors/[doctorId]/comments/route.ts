import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUserId } from "@/lib/auth";
import { sanitizeProfileImageUrl } from "@/lib/avatar";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ doctorId: string }> }
) {
  try {
    const { doctorId } = await params;
    if (!doctorId) {
      return NextResponse.json({ message: "doctorId is required" }, { status: 400 });
    }

    const rawComments = await prisma.comment.findMany({
      where: { doctorId },
      include: {
        patient: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                profileImageUrl: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    const comments = rawComments.map((c) => ({
      ...c,
      patient: c.patient?.user
        ? {
            ...c.patient,
            user: {
              ...c.patient.user,
              profileImageUrl: sanitizeProfileImageUrl(c.patient.user.profileImageUrl) ?? null,
            },
          }
        : c.patient,
    }));

    return NextResponse.json({ comments }, { status: 200 });
  } catch (error: any) {
    console.error("comments-get-error", error);
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
    const text = (body?.text || "").trim();

    if (!text) {
      return NextResponse.json({ message: "Comment text is required" }, { status: 400 });
    }

    // Ensure doctor exists
    const doctor = await prisma.doctor.findUnique({ where: { id: doctorId } });
    if (!doctor) {
      return NextResponse.json({ message: "Doctor not found" }, { status: 404 });
    }

    // Find the patient corresponding to the logged in user
    let patient = await prisma.patient.findUnique({ where: { userId } });
    if (!patient && body.patientId) {
      patient = await prisma.patient.findUnique({ where: { id: body.patientId } });
    }

    if (!patient) {
      return NextResponse.json({ message: "Patient profile required to post a comment" }, { status: 403 });
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
        { message: "You can only review a doctor after completing an appointment with them." },
        { status: 403 }
      );
    }

    const created = await prisma.comment.create({
      data: {
        doctorId,
        patientId: patient.id,
        text,
      },
      include: {
        patient: {
          include: {
            user: { select: { id: true, name: true, profileImageUrl: true } },
          },
        },
      },
    });

    return NextResponse.json({ comment: created }, { status: 201 });
  } catch (error: any) {
    console.error("comment-post-error", error);
    return NextResponse.json({ message: error?.message || "Server error" }, { status: 500 });
  }
}
