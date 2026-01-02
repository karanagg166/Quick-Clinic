import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { Doctor } from "@/types/doctor";




export async function GET(req: NextRequest) {
  try {
    const { searchParams } = req.nextUrl;
    const filters: any = {
      user: {
        location: {}
      },

    };
    if (searchParams.get("name")) {
      filters.user.name = {
        contains: searchParams.get("patientName") as string,
        mode: "insensitive",
      }
    }
    if (searchParams.get("city")) {
      filters.user.location.city = {
        contains: searchParams.get("city") as string,
        mode: "insensitive",
      }
    }
    if (searchParams.get("state")) {
      filters.user.location.state = {
        contains: searchParams.get("state") as string,
        mode: "insensitive",
      }
    }
    if (searchParams.get("specialty")) {
      filters.specialty = {
        contains: searchParams.get("specialty") as string,
        mode: "insensitive",
      }
    }
    if (searchParams.get("fees")) {
      filters.fees = {
        contains: searchParams.get("fees") as string,
        mode: "insensitive",
      }
    }
    if (searchParams.get("experience")) {
      filters.experience = {
        contains: searchParams.get("experience") as string,
        mode: "insensitive",
      }
    }
    if (searchParams.get("age")) {
      filters.user.age = {
        contains: searchParams.get("age") as string,
        mode: "insensitive",
      }
    }
    if (searchParams.get("gender")) {
      filters.user.gender = {
        contains: searchParams.get("gender") as string,
        mode: "insensitive",
      }
    }
    const raw = await prisma.doctor.findMany({
      where: filters,
      include: {
        user: {
          include: {
            location: true,
          }

        },

        doctorQualifications: true
      }
    });
    const doctors: Doctor[] = raw.map((d: any) => {
      const qualifications = d.doctorQualifications?.map((dq: any) => dq.qualification) ?? [];

      return {
        id: String(d.id),

        name: d.user?.name ?? "",
        gender: d.user?.gender ?? "",
        age: d.user?.age ?? 0,
        specialty: d.specialty ?? "",
        experience: d.experience ?? 0,
        fees: d.fees ?? 0,
        profileImageUrl: d.user?.profileImageUrl ?? "",
        doctorBio: d.doctorBio ?? "",

        qualifications: qualifications,

        city: d.user?.location?.city ?? undefined,
        state: d.user?.location?.state ?? undefined,
      };
    });

    return NextResponse.json(doctors, { status: 200 });
  } catch (err: any) {
    console.error("doctors-get-error", err);
    return NextResponse.json(
      { error: err?.message ?? "Server error" },
      { status: 500 }
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
      doctorBio = null,
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
        doctorBio,
        doctorQualifications: {
          create: Array.isArray(qualifications)
            ? qualifications.map((q: string) => ({ qualification: q }))
            : []
        }
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

