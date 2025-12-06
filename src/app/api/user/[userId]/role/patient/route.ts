// app/api/user/[userId]/role/patient/route.ts
import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

export const POST = async (
  req: NextRequest,
  { params }: { params: { userId: string } }
) => {
  try {
    const { userId } = params;
    if (!userId) {
      return NextResponse.json({ error: "Missing userId in params" }, { status: 400 });
    }

    // parse body (optional fields)
    const body = await req.json();
    const {
      medicalHistory = "",
      allergies = "",
      currentMedications = "",
    } = body;

    // ensure user exists
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // check if patient already exists
    const existing = await prisma.patient.findUnique({ where: { userId } });
    if (existing) {
      return NextResponse.json({ error: "Patient profile already exists for this user" }, { status: 409 });
    }

    // create patient
    const created = await prisma.patient.create({
      data: {
        userId,
        medicalHistory,
        allergies,
        currentMedications,
      },
    });

    return NextResponse.json({ patient: created }, { status: 201 });
  } catch (err: any) {
    console.error("create-patient-error:", err);
    return NextResponse.json(
      { error: err?.message ?? "Server error" },
      { status: 500 }
    );
  }
};
