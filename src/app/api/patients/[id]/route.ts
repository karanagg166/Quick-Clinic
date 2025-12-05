import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// GET - Fetch a specific patient by ID
export const GET = async (
  req: NextRequest,
  { params }: { params: { id: string } }
) => {
  try {
    const { id } = params;

    const patient = await prisma.patient.findUnique({
      where: { id },
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
        { error: "Patient not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ patient }, { status: 200 });

  } catch (error: any) {
    console.error("GET Patient by ID Error:", error);
    return NextResponse.json(
      { error: error?.message ?? "Server error" },
      { status: 500 }
    );
  }
};

// PUT/PATCH - Update a specific patient by ID
export const PUT = async (
  req: NextRequest,
  { params }: { params: { id: string } }
) => {
  try {
    const userId = req.headers.get("x-user-id");
    const userRole = req.headers.get("x-user-role");
    const { id } = params;

    if (!userId) {
      return NextResponse.json(
        { error: "User ID not found" },
        { status: 400 }
      );
    }

    // Check if patient exists
    const existingPatient = await prisma.patient.findUnique({
      where: { id }
    });

    if (!existingPatient) {
      return NextResponse.json(
        { error: "Patient not found" },
        { status: 404 }
      );
    }

    // Only the patient themselves or admin can update
    if (userRole !== "ADMIN" && existingPatient.userId !== userId) {
      return NextResponse.json(
        { error: "Forbidden - You can only update your own profile" },
        { status: 403 }
      );
    }

    const {
      medicalHistory,
      allergies,
      currentMedications
    } = await req.json();

    // Update patient profile
    const updatedPatient = await prisma.patient.update({
      where: { id },
      data: {
        ...(medicalHistory !== undefined && { medicalHistory }),
        ...(allergies !== undefined && { allergies }),
        ...(currentMedications !== undefined && { currentMedications })
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
        message: "Patient profile updated successfully", 
        patient: updatedPatient 
      },
      { status: 200 }
    );

  } catch (error: any) {
    console.error("PUT Patient Error:", error);
    return NextResponse.json(
      { error: error?.message ?? "Server error" },
      { status: 500 }
    );
  }
};

// DELETE - Delete a specific patient by ID
export const DELETE = async (
  req: NextRequest,
  { params }: { params: { id: string } }
) => {
  try {
    const userId = req.headers.get("x-user-id");
    const userRole = req.headers.get("x-user-role");
    const { id } = params;

    if (!userId) {
      return NextResponse.json(
        { error: "User ID not found" },
        { status: 400 }
      );
    }

    // Check if patient exists
    const existingPatient = await prisma.patient.findUnique({
      where: { id }
    });

    if (!existingPatient) {
      return NextResponse.json(
        { error: "Patient not found" },
        { status: 404 }
      );
    }

    // Only admin can delete
    if (userRole !== "ADMIN") {
      return NextResponse.json(
        { error: "Forbidden - Only admins can delete patient profiles" },
        { status: 403 }
      );
    }

    await prisma.patient.delete({
      where: { id }
    });

    return NextResponse.json(
      { message: "Patient profile deleted successfully" },
      { status: 200 }
    );

  } catch (error: any) {
    console.error("DELETE Patient Error:", error);
    return NextResponse.json(
      { error: error?.message ?? "Server error" },
      { status: 500 }
    );
  }
};
