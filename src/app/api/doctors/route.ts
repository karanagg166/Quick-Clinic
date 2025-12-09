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
