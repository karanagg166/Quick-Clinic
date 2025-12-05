import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUserId } from "@/lib/auth";

// -------------------------
// GET PATIENT INFO
// -------------------------
export async function GET(req: NextRequest) {
  try {
    const token = req.cookies.get("token")?.value;

    if (!token)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const result = await getUserId(token);

    if (!result.valid)
      return NextResponse.json({ error: "Invalid token" }, { status: 401 });

    const userId = result.userId;

    const patient = await prisma.patient.findUnique({
      where: { userId },
    });

    if (!patient)
      return NextResponse.json(
        { error: "Patient not found" },
        { status: 404 }
      );

    return NextResponse.json(patient, { status: 200 });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "Server error" },
      { status: 500 }
    );
  }
}

// -------------------------
// CREATE PATIENT INFO
// -------------------------
export async function POST(req: NextRequest) {
  try {
    const token = req.cookies.get("token")?.value;

    if (!token)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const result = await getUserId(token);

    if (!result.valid)
      return NextResponse.json({ error: "Invalid token" }, { status: 401 });

    const userId = result.userId;

    const { medicalHistory, allergies, currentMedications } = await req.json();

    const exists = await prisma.patient.findUnique({ where: { userId } });

    if (exists)
      return NextResponse.json(
        { error: "Patient already exists" },
        { status: 400 }
      );

    const created = await prisma.patient.create({
      data: {
        userId,
        medicalHistory,
        allergies,
        currentMedications,
      },
    });
const res= NextResponse.json(created, { status: 201 });
    res.cookies.set("patientId", created.id, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
    });

    return res;
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "Server error" },
      { status: 500 }
    );
  }
}

// -------------------------
// UPDATE PATIENT INFO
// -------------------------
export async function PUT(req: NextRequest) {
  try {
    const token = req.cookies.get("token")?.value;

    if (!token)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const result = await getUserId(token);

    if (!result.valid)
      return NextResponse.json({ error: "Invalid token" }, { status: 401 });

    const userId = result.userId;

    const { medicalHistory, allergies, currentMedications } = await req.json();

    const exists = await prisma.patient.findUnique({ where: { userId } });

    if (!exists)
      return NextResponse.json(
        { error: "Patient does not exist" },
        { status: 404 }
      );

    const updated = await prisma.patient.update({
      where: { userId },
      data: {
        medicalHistory,
        allergies,
        currentMedications,
      },
    });

    return NextResponse.json(updated, { status: 200 });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "Server error" },
      { status: 500 }
    );
  }
}
