// app/api/user/role/route.ts
import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

export const POST = async (
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) => {
  try {
    const { userId } = await params;
    const fallbackUserId = req.nextUrl.searchParams.get("userId");
    const resolvedUserId = userId ?? fallbackUserId;

    if (!resolvedUserId) {
      return NextResponse.json({ error: "User Not Logined or userId not valid" }, { status: 400 });
    }

    const body = await req.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: "Invalid or missing JSON body" }, { status: 400 });
    }

    const { specialty, experience, qualifications, fees } = body;
    if (!specialty|| !experience || !qualifications || !fees ) {
      return NextResponse.json({ error: "specialty is required" }, { status: 400 });
    }

    
    const user = await prisma.user.findUnique({ where: { id: resolvedUserId } });
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const existing = await prisma.doctor.findUnique({ where: { userId: resolvedUserId } });
    if (existing) {
      return NextResponse.json({ error: "Doctor profile already exists for this user" }, { status: 409 });
    }

    const created = await prisma.doctor.create({
      data: {
        userId: resolvedUserId,
        specialty,
        experience,
        qualifications,
        fees,
      },
    });

    return NextResponse.json({ doctor: created }, { status: 201 });
  } catch (err: any) {
    console.error("create-doctor-error:", err);
    return NextResponse.json({ error: err?.message ?? "Server error" }, { status: 500 });
  }
};
