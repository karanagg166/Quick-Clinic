import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { Doctor } from "@/types/doctor";



export async function GET(req: NextRequest) {
  try {
    const { searchParams } = req.nextUrl;

    // Build root (doctor) and related (user) filters
    const filtersDoctor: any = {};
    const filtersUser: any = {};

    if (searchParams.has("city")) {
      filtersUser.city = searchParams.get("city");
    }
    if (searchParams.has("state")) {
      filtersUser.state = searchParams.get("state");
    }
    if (searchParams.has("specialty")) {
      filtersDoctor.specialty = searchParams.get("specialty");
    }
    if (searchParams.has("name")) {
      filtersUser.name = {
        contains: searchParams.get("name"),
        mode: "insensitive",
      };
    }
    if (searchParams.has("gender")) {
      filtersUser.gender = searchParams.get("gender");
    }
    if (searchParams.has("fees")) {
      const fees = Number(searchParams.get("fees"));
      if (!Number.isNaN(fees)) filtersDoctor.fees = fees;
    }
    if (searchParams.has("experience")) {
      const exp = Number(searchParams.get("experience"));
      if (!Number.isNaN(exp)) filtersDoctor.experience = exp;
    }

    // Compose final where.
    const where: any = { ...filtersDoctor };
    if (Object.keys(filtersUser).length > 0) {
      where.user = { is: filtersUser };
    }

    const raw = await prisma.doctor.findMany({
      where,
      select: {
        id: true,
        specialty: true,
        qualifications: true,
        fees: true,
        experience: true,
        user: {
          select: {
            name: true,
            gender: true,
            age: true,
            city: true,
            state: true,
          },
        },
      },
    });
console.log("doctors-raw", raw);
    // Map raw Prisma result -> your Doctor type
    const doctors: Doctor[] = raw.map((d:any) => {
      return {
        id: String(d.id),
       
        name: d.user?.name ?? "",
        gender: d.user?.gender ?? "",
        age: d.user?.age ?? 0,
        specialty: d.specialty ?? "",
        experience: d.experience ?? 0,
        fees: d.fees ?? 0,
       
        qualifications: Array.isArray(d.qualifications) ? d.qualifications : (d.qualifications ? [d.qualifications] : []),
       
        city: d.user?.city ?? undefined,
        state: d.user?.state ?? undefined,
      };
    });

    return NextResponse.json(doctors, { status: 200 });
  } catch (err: any) {
    console.error("doctors-get-error", err);
    return NextResponse.json(
      { error: err?.message ?? "Server error" },
      { status: 500}
    );
  }
}

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

