import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { Doctor } from "@/types/doctor";
import { Gender, Prisma, Specialty } from "@/generated/prisma";
import { parseSearchCoordinates } from "@/lib/coordinates";
import { getRouteMetrics } from "@/lib/routing";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = req.nextUrl;
    const patientCoordinates = parseSearchCoordinates(searchParams);
    if (patientCoordinates === "invalid") {
      return NextResponse.json({ error: "lat must be between -90 and 90 and lng must be between -180 and 180" }, { status: 400 });
    }
    const filters: any = {};
    const userFilters: any = {};
    const locationFilters: any = {};

    if (searchParams.get("name")) {
      const nameParam = searchParams.get("name")?.trim();
      if (nameParam) {
        userFilters.name = {
          contains: nameParam,
          mode: "insensitive",
        };
      }
    }

    if (searchParams.get("city")) {
      const cityParam = searchParams.get("city")?.trim();
      if (cityParam) {
        locationFilters.city = {
          contains: cityParam,
          mode: "insensitive",
        };
      }
    }

    if (searchParams.get("state")) {
      const stateParam = searchParams.get("state")?.trim();
      if (stateParam) {
        locationFilters.state = {
          contains: stateParam,
          mode: "insensitive",
        };
      }
    }

    if (Object.keys(locationFilters).length > 0) {
      userFilters.location = locationFilters;
    }

    const genderInput = searchParams.get("gender")?.trim();
    if (genderInput && genderInput !== "all") {
      const genderUpper = genderInput.toUpperCase();
      if (Object.values(Gender).includes(genderUpper as Gender)) {
        userFilters.gender = genderUpper as Gender;
      }
    }

    const ageVal = searchParams.get("age");
    if (ageVal) {
      const ageNum = Number(ageVal);
      if (!isNaN(ageNum)) {
        userFilters.age = ageNum;
      }
    }

    if (Object.keys(userFilters).length > 0) {
      filters.user = userFilters;
    }

    const specialtyVal = searchParams.get("specialty")?.trim() || searchParams.get("specialization")?.trim();
    if (specialtyVal && specialtyVal !== "all") {
      const specialtyUpper = specialtyVal.toUpperCase();
      if (Object.values(Specialty).includes(specialtyUpper as Specialty)) {
        filters.specialty = specialtyUpper as Specialty;
      }
    }

    // Fees filter
    const maxFeesVal = searchParams.get("maxFees") || searchParams.get("fees");
    const minFeesVal = searchParams.get("minFees");
    const feesFilter: any = {};
    if (maxFeesVal) {
      const maxFeesNum = Number(maxFeesVal);
      if (!isNaN(maxFeesNum)) {
        feesFilter.lte = maxFeesNum;
      }
    }
    if (minFeesVal) {
      const minFeesNum = Number(minFeesVal);
      if (!isNaN(minFeesNum)) {
        feesFilter.gte = minFeesNum;
      }
    }
    if (Object.keys(feesFilter).length > 0) {
      filters.fees = feesFilter;
    }

    // Experience filter
    const minExpVal = searchParams.get("minExperience") || searchParams.get("experience");
    const maxExpVal = searchParams.get("maxExperience");
    const expFilter: any = {};
    if (minExpVal) {
      const minExpNum = Number(minExpVal);
      if (!isNaN(minExpNum)) {
        expFilter.gte = minExpNum;
      }
    }
    if (maxExpVal) {
      const maxExpNum = Number(maxExpVal);
      if (!isNaN(maxExpNum)) {
        expFilter.lte = maxExpNum;
      }
    }
    if (Object.keys(expFilter).length > 0) {
      filters.experience = expFilter;
    }

    const raw = await prisma.doctor.findMany({
      where: filters,
      select: {
        id: true,
        specialty: true,
        experience: true,
        fees: true,
        doctorBio: true,
        ...(patientCoordinates ? { latitude: true, longitude: true } : {}),
        user: {
          select: {
            name: true,
            gender: true,
            age: true,
            profileImageUrl: true,
            location: true,
          },
        },
        doctorQualifications: true,
      },
    });

    const toDoctor = (d: any): Doctor => {
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
        latitude: d.latitude ?? undefined,
        longitude: d.longitude ?? undefined,
      };
    };

    if (!patientCoordinates) {
      return NextResponse.json(raw.map(toDoctor), { status: 200 });
    }

    // Apply all existing filters before the spatial lookup. Legacy doctors without
    // a saved practice location are deliberately excluded from a nearby result.
    const candidates = raw.filter((doctor: any) =>
      typeof doctor.latitude === "number" && typeof doctor.longitude === "number",
    );
    if (candidates.length === 0) {
      return NextResponse.json({ doctors: raw.map(toDoctor), distanceUnavailable: true }, { status: 200 });
    }

    let nearbyDoctors: Doctor[];
    try {
      const nearbyIds = await prisma.$queryRaw(Prisma.sql`
        SELECT "id"
        FROM "Doctor"
        WHERE "id" IN (${Prisma.join(candidates.map((doctor: any) => doctor.id))})
          AND "practiceLocation" IS NOT NULL
        ORDER BY "practiceLocation" <-> ST_SetSRID(
          ST_MakePoint(${patientCoordinates.longitude}, ${patientCoordinates.latitude}),
          4326
        )::geography
        LIMIT 30
      `) as Array<{ id: string }>;
      const byId = new Map(raw.map((doctor: any) => [doctor.id, doctor]));
      const nearby = nearbyIds.map(({ id }: { id: string }) => byId.get(id)).filter(Boolean) as any[];
      const metrics = await getRouteMetrics(
        patientCoordinates,
        nearby.map((doctor: any) => ({ latitude: doctor.latitude, longitude: doctor.longitude })),
      );

      nearbyDoctors = nearby
        .map((doctor: any, index: number): Doctor | null => {
          const metric = metrics[index];
          return metric ? { ...toDoctor(doctor), ...metric } : null;
        })
        .filter((doctor: Doctor | null): doctor is Doctor => doctor !== null)
        .sort((a: Doctor, b: Doctor) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity));
    } catch (error) {
      // Provider, timeout, or unavailable PostGIS should never hide an otherwise
      // valid filtered result set.
      console.error("nearby-doctors-unavailable", error);
      return NextResponse.json({ doctors: raw.map(toDoctor), distanceUnavailable: true }, { status: 200 });
    }

    return NextResponse.json({ doctors: nearbyDoctors, distanceUnavailable: false }, { status: 200 });
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
      latitude,
      longitude,
    } = body ?? {};

    if (!userId || typeof userId !== "string") {
      return NextResponse.json({ error: "userId is required" }, { status: 400 });
    }

    if (!specialty || typeof specialty !== "string") {
      return NextResponse.json({ error: "specialty is required" }, { status: 400 });
    }

    const hasCoordinates = latitude !== undefined || longitude !== undefined;
    if (hasCoordinates && (
      typeof latitude !== "number" || typeof longitude !== "number" ||
      !Number.isFinite(latitude) || !Number.isFinite(longitude) ||
      latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180
    )) {
      return NextResponse.json({ error: "Valid latitude and longitude are required" }, { status: 400 });
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
        latitude: hasCoordinates ? latitude : null,
        longitude: hasCoordinates ? longitude : null,
        doctorQualifications: {
          create: Array.isArray(qualifications)
            ? qualifications.map((q: string) => ({ qualification: q }))
            : [],
        },
      },
      include: {
        doctorQualifications: true,
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
