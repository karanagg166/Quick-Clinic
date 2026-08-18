import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logAccess } from "@/lib/logger";
import { verifyToken, getAuthenticatedUser } from "@/lib/auth";

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

    const patient = await prisma.patient.findUnique({
      where: { id: patientId },
      include: { user: true },
    });

    if (!patient) {
      return NextResponse.json({ error: "Patient not found" }, { status: 404 });
    }

    // Log Access
    const authUser = await getAuthenticatedUser(req);
    const viewerId = authUser?.id || null;
    await logAccess(viewerId, patientId, "Viewed Patient Profile");

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

    // Check if patient exists
    const patient = await prisma.patient.findUnique({
      where: { id: patientId },
    });

    if (!patient) {
      return NextResponse.json({ error: "Patient not found" }, { status: 404 });
    }

    const authUser = await getAuthenticatedUser(req);
    if (authUser && patient.userId !== authUser.id && authUser.role !== "ADMIN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await req.json();
    const {
      medicalHistory = undefined,
      allergies = undefined,
      currentMedications = undefined,
    } = body ?? {};

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

    // Check if patient exists
    const patient = await prisma.patient.findUnique({
      where: { id: patientId },
    });

    if (!patient) {
      return NextResponse.json({ error: "Patient not found" }, { status: 404 });
    }

    const authUser = await getAuthenticatedUser(req);
    if (authUser && patient.userId !== authUser.id && authUser.role !== "ADMIN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await req.json();
    const updateData: any = {};

    // Only add fields that are explicitly provided
    if (body.medicalHistory !== undefined) updateData.medicalHistory = body.medicalHistory;
    if (body.allergies !== undefined) updateData.allergies = body.allergies;
    if (body.currentMedications !== undefined) updateData.currentMedications = body.currentMedications;

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
