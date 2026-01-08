import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { Doctor } from "@/types/doctor";
import { logAccess } from "@/lib/logger";
import { verifyToken } from "@/lib/auth";

// GET - Fetch doctor by ID
export const GET = async (
  req: NextRequest,
  { params }: { params: Promise<{ doctorId: string }> }
) => {
  try {
    const { doctorId } = await params;

    if (!doctorId || typeof doctorId !== "string") {
      return NextResponse.json({ error: "doctorId is required" }, { status: 400 });
    }
    console.log(doctorId);

    const doctorDataPromise = await prisma.doctor.findUnique({
      where: { id: doctorId },
      select: {
        id: true,
        userId: true,
        specialty: true,
        doctorQualifications: { select: { qualification: true } },
        fees: true,
        experience: true,
        doctorBio: true,
        user: {
          select: {
            id: true,
            name: true,
            gender: true,
            age: true,
            email: true,
            profileImageUrl: true,

            location: {
              select: {
                city: true,
                state: true,
              }
            }
          },

        },
      },
    });

    const ratingAggPromise = await prisma.rating.aggregate({
      where: { doctorId },
      _avg: { rating: true },
      _count: { rating: true },
    });

    const commentsPromise = await prisma.comment.findMany({
      where: { doctorId },
      orderBy: { createdAt: "desc" },
      include: {
        patient: {
          select: {
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
    });

    const [d, ratingAgg, rawComments] = await Promise.all([
      doctorDataPromise,
      ratingAggPromise,
      commentsPromise,
    ]);

    if (!d) {
      return NextResponse.json({ error: "Doctor not found" }, { status: 404 });
    }

    const doctor: Doctor = {
      id: String(d.id),
      userId: d.userId,
      name: d.user?.name ?? "",
      gender: d.user?.gender ?? "",
      age: d.user?.age ?? 0,
      specialty: d.specialty ?? "",
      experience: d.experience ?? 0,
      fees: d.fees ?? 0,
      email: d.user?.email ?? "",
      qualifications: d.doctorQualifications?.map((q: any) => q.qualification) ?? [],
      city: d.user?.location?.city ?? undefined,
      state: d.user?.location?.state ?? undefined,
      profileImageUrl: d.user?.profileImageUrl ?? undefined,
      doctorBio: d.doctorBio ?? undefined,
    };

    const ratingSummary = {
      average: ratingAgg._avg.rating ? Number(ratingAgg._avg.rating.toFixed(1)) : 0,
      count: ratingAgg._count.rating ?? 0,
    };

    const comments = rawComments.map((c: any) => ({
      ...c,
      user: c.patient.user,
      patient: undefined, // Remove patient structure to match original expected shape if needed, or keep it.
    }));

    // Log Access
    const token = req.cookies.get("token")?.value;
    let viewerId = null;
    if (token) {
      const { payload } = await verifyToken(token);
      if (payload) viewerId = (payload as any).id;
    }
    await logAccess(viewerId, doctorId, "Viewed Doctor Profile");

    return NextResponse.json({ doctor, rating: ratingSummary, comments }, { status: 200 });
  } catch (err: any) {
    console.error("doctor-get-error", err);
    return NextResponse.json(
      { error: err?.message ?? "Server error" },
      { status: 500 }
    );
  }
};

// PUT - Update entire doctor profile
export const PUT = async (
  req: NextRequest,
  { params }: { params: Promise<{ doctorId: string }> }
) => {
  try {
    const { doctorId } = await params;

    if (!doctorId || typeof doctorId !== "string") {
      return NextResponse.json({ error: "doctorId is required" }, { status: 400 });
    }

    const body = await req.json();
    const {
      specialty,
      fees = undefined,
      experience = undefined,
      qualifications = undefined,
      doctorBio = undefined,
    } = body ?? {};

    // Check if doctor exists
    const doctor = await prisma.doctor.findUnique({
      where: { id: doctorId },
    });

    if (!doctor) {
      return NextResponse.json({ error: "Doctor not found" }, { status: 404 });
    }

    // Prepare update data
    const data: any = {};
    if (specialty) data.specialty = specialty;
    if (fees !== undefined) data.fees = Number(fees);
    if (experience !== undefined) data.experience = Number(experience);
    if (doctorBio !== undefined) data.doctorBio = doctorBio;

    // Handle qualifications update: Delete all existing, verify uniqueness, then create new
    if (qualifications && Array.isArray(qualifications)) {
      // Filter redundant qualifications
      const uniqueQuals = Array.from(new Set(qualifications));

      data.doctorQualifications = {
        deleteMany: {}, // Clear existing
        create: uniqueQuals.map((q: any) => ({
          qualification: q,
        })),
      };
    }

    // Update doctor
    const updated = await prisma.doctor.update({
      where: { id: doctorId },
      data,
    });

    return NextResponse.json({ doctor: updated }, { status: 200 });
  } catch (err: any) {
    console.error("doctor-put-error", err);
    return NextResponse.json(
      { error: err?.message ?? "Server error" },
      { status: 500 }
    );
  }
};


// PATCH - Partially update doctor profile
export const PATCH = async (
  req: NextRequest,
  { params }: { params: Promise<{ doctorId: string }> }
) => {
  try {
    const { doctorId } = await params;

    if (!doctorId || typeof doctorId !== "string") {
      return NextResponse.json({ error: "doctorId is required" }, { status: 400 });
    }

    const body = await req.json();
    const updateData: any = {};

    // Only add fields that are explicitly provided
    if (body.specialty !== undefined) updateData.specialty = body.specialty;
    if (body.fees !== undefined) updateData.fees = Number(body.fees);
    if (body.experience !== undefined) updateData.experience = Number(body.experience);
    if (body.doctorBio !== undefined) updateData.doctorBio = body.doctorBio;

    // Handle qualifications update: Delete all existing, verify uniqueness, then create new
    if (body.qualifications !== undefined && Array.isArray(body.qualifications)) {
      const uniqueQuals = Array.from(new Set(body.qualifications));
      updateData.doctorQualifications = {
        deleteMany: {}, // Clear existing
        create: uniqueQuals.map((q: any) => ({
          qualification: q,
        })),
      };
    }

    // Check if doctor exists
    const doctor = await prisma.doctor.findUnique({
      where: { id: doctorId },
    });

    if (!doctor) {
      return NextResponse.json({ error: "Doctor not found" }, { status: 404 });
    }

    // Update only provided fields
    const updated = await prisma.doctor.update({
      where: { id: doctorId },
      data: updateData,
    });

    return NextResponse.json({ doctor: updated }, { status: 200 });
  } catch (err: any) {
    console.error("doctor-patch-error", err);
    return NextResponse.json(
      { error: err?.message ?? "Server error" },
      { status: 500 }
    );
  }
};
