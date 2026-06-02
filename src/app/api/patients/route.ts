import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { Patient } from "@/types/patient";
import { Gender } from "@/generated/prisma";

export const POST = async (req: NextRequest) => {
  try {
    const body = await req.json();
    const {
      userId,
      medicalHistory = "",
      allergies = "",
      currentMedications = "",
    } = body ?? {};

    if (!userId || typeof userId !== "string") {
      return NextResponse.json({ error: "userId is required" }, { status: 400 });
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const existing = await prisma.patient.findUnique({ where: { userId } });
    if (existing) {
      return NextResponse.json(
        { error: "Patient profile already exists for this user" },
        { status: 409 }
      );
    }

    const patient = await prisma.patient.create({
      data: {
        userId,
        medicalHistory,
        allergies,
        currentMedications,
      },
    });

    return NextResponse.json({ patient }, { status: 201 });
  } catch (err: any) {
    console.error("patients-post-error", err);
    return NextResponse.json(
      { error: err?.message ?? "Server error" },
      { status: 500 }
    );
  }
};

export const GET = async (req: NextRequest) => {
  try {
    const { searchParams } = new URL(req.url);
    const doctorId = searchParams.get("doctorId");

    if (!doctorId) {
      return NextResponse.json({ error: "doctorId is required" }, { status: 400 });
    }

    // --- build patient & user filters ---
    const patientFilter: any = {};
    const medHistoryParam = searchParams.get("medicalHistory")?.trim();
    if (medHistoryParam) {
      patientFilter.medicalHistory = { contains: medHistoryParam, mode: "insensitive" };
    }
    const allergyParam = searchParams.get("allergy")?.trim();
    if (allergyParam) {
      patientFilter.allergies = { contains: allergyParam, mode: "insensitive" };
    }
    const curMedParam = searchParams.get("currentMedications")?.trim();
    if (curMedParam) {
      patientFilter.currentMedications = { contains: curMedParam, mode: "insensitive" };
    }

    const userFilter: any = {};
    const locationFilter: any = {};

    const nameParam = searchParams.get("name")?.trim();
    if (nameParam) {
      userFilter.name = { contains: nameParam, mode: "insensitive" };
    }
    const ageVal = searchParams.get("age");
    if (ageVal) {
      const ageNum = Number(ageVal);
      if (!isNaN(ageNum)) {
        userFilter.age = ageNum;
      }
    }
    const genderInput = searchParams.get("gender")?.trim();
    if (genderInput && genderInput !== "all") {
      const genderUpper = genderInput.toUpperCase();
      if (Object.values(Gender).includes(genderUpper as Gender)) {
        userFilter.gender = genderUpper as Gender;
      }
    }

    // Location filters
    const cityParam = searchParams.get("city")?.trim();
    if (cityParam) {
      locationFilter.city = { contains: cityParam, mode: "insensitive" };
    }
    const stateParam = searchParams.get("state")?.trim();
    if (stateParam) {
      locationFilter.state = { contains: stateParam, mode: "insensitive" };
    }

    if (Object.keys(locationFilter).length > 0) {
      userFilter.location = { is: locationFilter };
    }

    // --- get appointment rows for the doctor ---
    const appointmentRows = await prisma.appointment.findMany({
      where: { doctorId },
      select: { patientId: true },
    });

    // defensive check & debug logging
    if (!Array.isArray(appointmentRows)) {
      console.error("patients-get-error: appointmentRows is not an array:", appointmentRows);
      return NextResponse.json({ error: "Unexpected DB response" }, { status: 500 });
    }

    // convert to array of unique, non-null IDs
    const patientIds = Array.from(
      new Set(
        appointmentRows
          .map((r) => r?.patientId)        // r could be null-safe
          .filter((id): id is string => !!id) // remove null/undefined and narrow type
      )
    );

    if (patientIds.length === 0) {
      return NextResponse.json([], { status: 200 });
    }

    // --- compose final where for patient.findMany ---
    const where: any = {
      id: { in: patientIds },
      ...patientFilter,
    };
    if (Object.keys(userFilter).length > 0) where.user = { is: userFilter };

    // --- query patients with selected fields only ---
    const patients = await prisma.patient.findMany({
      where,
      select: {
        id: true,
        medicalHistory: true,
        allergies: true,
        currentMedications: true,
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            age: true,
            gender: true,
            phoneNo: true,
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

    const formatted = patients.map((p: any) => ({
      id: p.id,
      name: p.user.name,
      gender: p.user.gender,
      age: p.user.age,
      email: p.user.email,
      city: p.user.location?.city ?? "",
      state: p.user.location?.state ?? "",
      phoneNo: p.user.phoneNo,

      medicalHistory: p.medicalHistory ?? "",
      allergies: p.allergies ?? "",
      currentMedications: p.currentMedications ?? "",
    }));

    return NextResponse.json(formatted, { status: 200 });


  } catch (err: any) {
    console.error("patients-get-error", err);
    return NextResponse.json({ error: err?.message ?? "Server error" }, { status: 500 });
  }
};


export const PATCH = async (req: NextRequest) => {
  try {
    const { patientId, medicalHistory, allergies, currentMedications } = await req.json();
    if (!patientId) {
      return NextResponse.json({ error: "patientId is required" }, { status: 400 });
    }
    const existingPatient = await prisma.patient.findUnique({ where: { id: patientId } });
    if (!existingPatient) {
      return NextResponse.json({ error: "Patient not found" }, { status: 404 });
    }
    const updatedPatient = await prisma.patient.update({
      where: { id: patientId },
      data: {
        medicalHistory: medicalHistory ?? existingPatient.medicalHistory,
        allergies: allergies ?? existingPatient.allergies,
        currentMedications: currentMedications ?? existingPatient.currentMedications,
      }
    });
    return NextResponse.json({ patient: updatedPatient }, { status: 200 });
  }
  catch (err: any) {
    console.error("patients-patch-error", err);
    return NextResponse.json(
      { error: err?.message ?? "Server error" },
      { status: 500 }
    );
  }
}