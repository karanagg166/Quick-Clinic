import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { Patient } from "@/types/patient";

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
    if (searchParams.get("medicalHistory")) {
      patientFilter.medicalHistory = { contains: searchParams.get("medicalHistory") || "", mode: "insensitive" };
    }
    if (searchParams.get("allergy")) {
      patientFilter.allergies = { contains: searchParams.get("allergy") || "", mode: "insensitive" };
    }
    if (searchParams.get("currentMedications")) {
      patientFilter.currentMedications = { contains: searchParams.get("currentMedications") || "", mode: "insensitive" };
    }

    const userFilter: any = {};
    const locationFilter: any = {};

    if (searchParams.get("name")) {
      userFilter.name = { contains: searchParams.get("name") || "", mode: "insensitive" };
    }
    if (searchParams.get("age")) {
      const age = Number(searchParams.get("age"));
      if (!Number.isNaN(age)) userFilter.age = age;
    }
    if (searchParams.get("gender")) userFilter.gender = searchParams.get("gender");

    // Location filters
    if (searchParams.get("city")) {
      locationFilter.city = { contains: searchParams.get("city") || "", mode: "insensitive" };
    }
    if (searchParams.get("state")) {
      locationFilter.state = { contains: searchParams.get("state") || "", mode: "insensitive" };
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

  }
}