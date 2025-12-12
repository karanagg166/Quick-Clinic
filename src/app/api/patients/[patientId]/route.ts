import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { Patient } from "@/types/patient";

// GET - Fetch patient by ID
export const GET = async (
  req: NextRequest,
  { params }: { params: Promise<{ patientId: string }> }
) => {
  try {
    const { patientId } = await params;

    if (!patientId || typeof patientId !== "string") {
      return NextResponse.json({ error: "patientId is required" }, { status: 400 });
    }

    const p = await prisma.patient.findUnique({
      where: { id: patientId },
      select: {
        id: true,
        userId: true,
        medicalHistory: true,
        allergies: true,
        currentMedications: true,
        user: {
          select: {
            id: true,
            name: true,
            gender:true,
            age:true,
            email:true,
            phoneNo:true,
            city: true,
            state: true
          },
        },  
      } 
    });

    const patient: Patient = {
        id: String(p.id),
        userId: p.userId,
          name: p.user?.name ?? "",   
          gender: p.user?.gender ?? "",
          age: p.user?.age ?? 0,
          email: p.user?.email ?? "",
          phoneNo: p.user?.phoneNo ?? "",
          city: p.user?.city ?? "",
          state: p.user?.state ?? "",
          medicalHistory: p.medicalHistory ?? [],
          allergies: p.allergies ?? [],
          currentMedications: p.currentMedications ?? [],
    };

    if (!p || !patient) {
      return NextResponse.json({ error: "Patient not found" }, { status: 404 });
    }
    console.log("Fetched patient:", patient);
    return NextResponse.json({ patient }, { status: 200 });
  } catch (err: any) {
    console.error("patient-get-error", err);
    return NextResponse.json(
      { error: err?.message ?? "Server error" },
      { status: 500 }
    );
  }
};

// PUT - Update entire patient profile
export const PUT = async (
  req: NextRequest,
  { params }: { params: Promise<{ patientId: string }> }
) => {
  try {
    const { patientId } = await params;

    if (!patientId || typeof patientId !== "string") {
      return NextResponse.json({ error: "patientId is required" }, { status: 400 });
    }

    const body = await req.json();
    const {
      medicalHistory = undefined,
      allergies = undefined,
      currentMedications = undefined,
    } = body ?? {};

    // Check if patient exists
    const patient = await prisma.patient.findUnique({
      where: { id: patientId },
    });

    if (!patient) {
      return NextResponse.json({ error: "Patient not found" }, { status: 404 });
    }

    // Update patient
    const updated = await prisma.patient.update({
      where: { id: patientId },
      data: {
        ...(medicalHistory !== undefined && { medicalHistory }),
        ...(allergies !== undefined && { allergies }),
        ...(currentMedications !== undefined && { currentMedications }),
      },
    });

    return NextResponse.json({ patient: updated }, { status: 200 });
  } catch (err: any) {
    console.error("patient-put-error", err);
    return NextResponse.json(
      { error: err?.message ?? "Server error" },
      { status: 500 }
    );
  }
};

// PATCH - Partially update patient profile
export const PATCH = async (
  req: NextRequest,
  { params }: { params: Promise<{ patientId: string }> }
) => {
  try {
    const { patientId } = await params;

    if (!patientId || typeof patientId !== "string") {
      return NextResponse.json({ error: "patientId is required" }, { status: 400 });
    }

    const body = await req.json();
    const updateData: any = {};

    // Only add fields that are explicitly provided
    if (body.medicalHistory !== undefined) updateData.medicalHistory = body.medicalHistory;
    if (body.allergies !== undefined) updateData.allergies = body.allergies;
    if (body.currentMedications !== undefined) updateData.currentMedications = body.currentMedications;

    // Check if patient exists
    const patient = await prisma.patient.findUnique({
      where: { id: patientId },
    });

    if (!patient) {
      return NextResponse.json({ error: "Patient not found" }, { status: 404 });
    }

    // Update only provided fields
    const updated = await prisma.patient.update({
      where: { id: patientId },
      data: updateData,
    });

    return NextResponse.json({ patient: updated }, { status: 200 });
  } catch (err: any) {
    console.error("patient-patch-error", err);
    return NextResponse.json(
      { error: err?.message ?? "Server error" },
      { status: 500 }
    );
  }
};
