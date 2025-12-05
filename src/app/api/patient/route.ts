import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUserId } from "@/lib/auth";

// POST: Create patient 
export async function POST(req: NextRequest) {
  try {
    const { medicalHistory, allergies, currentMedications } =
      await req.json();

    const token = req.cookies.get("token")?.value;
        if (!token) return NextResponse.json({ error: "No token" }, { status: 401 });

    const result = await getUserId(token);
        if (!result.valid) return NextResponse.json({ error: "Invalid token" }, { status: 401 });

    const userId = result.userId;

    if (!userId) {
      return NextResponse.json(
        { error: "userId is required" },
        { status: 400 }
      );
    }

    const existingPatient = await prisma.patient.findUnique({
      where: { userId },
    });

    if (existingPatient) {
      return NextResponse.json(
        { error: "Patient already exists" },
        { status: 400 }
      );
    }

    const patient = await prisma.patient.create({
      data: {
        userId,
        medicalHistory: medicalHistory || "",
        allergies: allergies || "",
        currentMedications: currentMedications || "",
      },
    });

    return NextResponse.json(patient, { status: 201 });

  } catch (err: any) {
    console.error("POST Patient Error:", err);

    return NextResponse.json(
      { error: err?.message ?? "Server error" },
      { status: 500 }
    );
  }
}

//  GET: Fetch patient 

export async function GET(req: NextRequest) {
  try {
    
    const token = req.cookies.get("token")?.value;
    if (!token) return NextResponse.json({ error: "No token" }, { status: 401 });

    const result = await getUserId(token);
    if (!result.valid) return NextResponse.json({ error: "Invalid token" }, { status: 401 });

    const userId = result.userId;

    if (!userId) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

  
    const patient = await prisma.patient.findUnique({
      where: { userId },
      include: {
        user: true,
      },
    });

    if (!patient) {
      return NextResponse.json(
        { error: "Patient not found" },
        { status: 404 }
      );
    }

    return NextResponse.json(
      { patient },
      { status: 200 }
    );

  } catch (err: any) {
    console.error("GET Patient Error:", err);

    return NextResponse.json(
      { error: err?.message ?? "Server error" },
      { status: 500 }
    );
  }
}


// PUT: Update patient record

export async function PUT(req: NextRequest) {
  try {
   
   const token = req.cookies.get("token")?.value;
    if (!token) return NextResponse.json({ error: "No token" }, { status: 401 });

    const result = await getUserId(token);
    if (!result.valid) return NextResponse.json({ error: "Invalid token" }, { status: 401 });

    const userId = result.userId;

    if (!userId) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const { medicalHistory, allergies, currentMedications } =
      await req.json();

    const existingPatient = await prisma.patient.findUnique({
      where: { userId },
    });

    if (!existingPatient) {
      return NextResponse.json(
        { error: "Patient record not found" },
        { status: 404 }
      );
    }

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
    console.error("PUT Patient Error:", err);

    return NextResponse.json(
      { error: err?.message ?? "Server error" },
      { status: 500 }
    );
  }
}



