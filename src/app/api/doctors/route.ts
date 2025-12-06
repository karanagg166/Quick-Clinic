import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const POST = async (req: NextRequest) => {
  try {
    const body = await req.json();
    const {
      userId,
      specialty,
      fees = 0,
      experience = 0,
      qualifications = [],
    } = body ?? {};

    if (!userId || typeof userId !== "string") {
      return NextResponse.json({ error: "userId is required" }, { status: 400 });
    }

    if (!specialty || typeof specialty !== "string") {
      return NextResponse.json({ error: "specialty is required" }, { status: 400 });
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const existing = await prisma.doctor.findUnique({ where: { userId } });
    if (existing) {
      return NextResponse.json(
        { error: "Doctor profile already exists for this user" },
        { status: 409 }
      );
    }

    const doctor = await prisma.doctor.create({
      data: {
        userId,
        specialty,
        fees: Number(fees),
        experience: Number(experience),
        qualifications: Array.isArray(qualifications) ? qualifications : [],
      },
    });

    return NextResponse.json({ doctor }, { status: 201 });
  } catch (err: any) {
    console.error("doctors-post-error", err);
    return NextResponse.json(
      { error: err?.message ?? "Server error" },
      { status: 500 }
    );
  }
};
