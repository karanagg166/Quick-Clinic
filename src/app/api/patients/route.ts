import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// GET - Fetch all patients or a specific patient
export const GET = async (req: NextRequest) => {
  try {
    const userId = req.headers.get("x-user-id");
    const userRole = req.headers.get("x-user-role");

    if (!userId) {
      return NextResponse.json(
        { error: "User ID not found" },
        { status: 400 }
      );
    }

    // Only ADMIN and DOCTOR can view all patients, PATIENT can only view their own data
    if (userRole === "PATIENT") {
      const patient = await prisma.patient.findUnique({
        where: { userId },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              phoneNo: true,
              age: true,
              gender: true,
              city: true,
              state: true,
              pinCode: true,
              createdAt: true,
              updatedAt: true
            }
          }
        }
      });

      if (!patient) {
        return NextResponse.json(
          { error: "Patient profile not found" },
          { status: 404 }
        );
      }

      return NextResponse.json({ patient }, { status: 200 });
    }

    // ADMIN or DOCTOR - fetch all patients
    const patients = await prisma.patient.findMany({
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            phoneNo: true,
            age: true,
            gender: true,
            city: true,
            state: true,
            pinCode: true,
            createdAt: true,
            updatedAt: true
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    return NextResponse.json({ patients, count: patients.length }, { status: 200 });

  } catch (error: any) {
    console.error("GET Patients Error:", error);
    return NextResponse.json(
      { error: error?.message ?? "Server error" },
      { status: 500 }
    );
  }
};

// POST - Create a new patient profile
export const POST = async (req: NextRequest) => {
  try {
    const userId = req.headers.get("x-user-id");
    const userRole = req.headers.get("x-user-role");

    if (!userId) {
      return NextResponse.json(
        { error: "User ID not found" },
        { status: 400 }
      );
    }

    // Check if user role is PATIENT
    if (userRole !== "PATIENT") {
      return NextResponse.json(
        { error: "Only users with PATIENT role can create patient profiles" },
        { status: 403 }
      );
    }

    // Check if patient profile already exists
    const existingPatient = await prisma.patient.findUnique({
      where: { userId }
    });

    if (existingPatient) {
      return NextResponse.json(
        { error: "Patient profile already exists for this user" },
        { status: 400 }
      );
    }

    const {
      medicalHistory = "",
      allergies = "",
      currentMedications = ""
    } = await req.json();

    // Create patient profile
    const patient = await prisma.patient.create({
      data: {
        userId,
        medicalHistory,
        allergies,
        currentMedications
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            phoneNo: true,
            age: true,
            gender: true,
            city: true,
            state: true,
            pinCode: true
          }
        }
      }
    });

    return NextResponse.json(
      { 
        message: "Patient profile created successfully", 
        patient 
      },
      { status: 201 }
    );

  } catch (error: any) {
    console.error("POST Patient Error:", error);
    return NextResponse.json(
      { error: error?.message ?? "Server error" },
      { status: 500 }
    );
  }
};
