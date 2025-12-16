import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { Doctor } from "@/types/doctor";

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

    const doctorDataPromise = prisma.doctor.findUnique({
      where: { id: doctorId },
      select: {
        id: true,
        userId: true,
        specialty: true,
        qualifications: true,
        fees: true,
        experience: true,
        user: {
          select: {
            id: true,
            name: true,
            gender: true,
            age: true,
            email: true,
            city: true,
            state: true,
            profileImageUrl: true,
          },
        },
      },
    });

    const ratingAggPromise = prisma.rating.aggregate({
      where: { doctorId },
      _avg: { rating: true },
      _count: { rating: true },
    });

    const commentsPromise = prisma.comment.findMany({
      where: { doctorId },
      orderBy: { createdAt: "desc" },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            profileImageUrl: true,
          },
        },
      },
    });

    const [d, ratingAgg, comments] = await Promise.all([
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
      qualifications: Array.isArray(d.qualifications)
        ? d.qualifications
        : d.qualifications
          ? [d.qualifications]
          : [],
      city: d.user?.city ?? undefined,
      state: d.user?.state ?? undefined,
      profileImageUrl: d.user?.profileImageUrl ?? undefined,
    };

    const ratingSummary = {
      average: ratingAgg._avg.rating ? Number(ratingAgg._avg.rating.toFixed(1)) : 0,
      count: ratingAgg._count.rating ?? 0,
    };
    
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
    } = body ?? {};

    // Check if doctor exists
    const doctor = await prisma.doctor.findUnique({
      where: { id: doctorId },
    });

    if (!doctor) {
      return NextResponse.json({ error: "Doctor not found" }, { status: 404 });
    }

    // Update doctor
    const updated = await prisma.doctor.update({
      where: { id: doctorId },
      data: {
        ...(specialty && { specialty }),
        ...(fees !== undefined && { fees: Number(fees) }),
        ...(experience !== undefined && { experience: Number(experience) }),
        ...(qualifications && Array.isArray(qualifications) && { qualifications }),
      },
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
    if (body.qualifications !== undefined && Array.isArray(body.qualifications)) {
      updateData.qualifications = body.qualifications;
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
