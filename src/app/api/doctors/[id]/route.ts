import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// GET - Fetch a specific doctor by ID
export const GET = async (
  req: NextRequest,
  { params }: { params: { id: string } }
) => {
  try {
    const { id } = params;

    const doctor = await prisma.doctor.findUnique({
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
        },
        schedule: true,
        leaves: {
          orderBy: {
            startDate: 'desc'
          }
        }
      }
    });

    if (!doctor) {
      return NextResponse.json(
        { error: "Doctor not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ doctor }, { status: 200 });

  } catch (error: any) {
    console.error("GET Doctor by ID Error:", error);
    return NextResponse.json(
      { error: error?.message ?? "Server error" },
      { status: 500 }
    );
  }
};

// PUT/PATCH - Update a specific doctor by ID
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

    // Check if doctor exists
    const existingDoctor = await prisma.doctor.findUnique({
      where: { id }
    });

    if (!existingDoctor) {
      return NextResponse.json(
        { error: "Doctor not found" },
        { status: 404 }
      );
    }

    // Only the doctor themselves or admin can update
    if (userRole !== "ADMIN" && existingDoctor.userId !== userId) {
      return NextResponse.json(
        { error: "Forbidden - You can only update your own profile" },
        { status: 403 }
      );
    }

    const {
      specialty,
      experience,
      qualifications,
      fees
    } = await req.json();

    // Update doctor profile
    const updatedDoctor = await prisma.doctor.update({
      where: { id },
      data: {
        ...(specialty && { specialty }),
        ...(experience !== undefined && { experience: Number(experience) }),
        ...(qualifications && { qualifications }),
        ...(fees !== undefined && { fees: Number(fees) })
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
        message: "Doctor profile updated successfully", 
        doctor: updatedDoctor 
      },
      { status: 200 }
    );

  } catch (error: any) {
    console.error("PUT Doctor Error:", error);
    return NextResponse.json(
      { error: error?.message ?? "Server error" },
      { status: 500 }
    );
  }
};

// DELETE - Delete a specific doctor by ID
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

    // Check if doctor exists
    const existingDoctor = await prisma.doctor.findUnique({
      where: { id }
    });

    if (!existingDoctor) {
      return NextResponse.json(
        { error: "Doctor not found" },
        { status: 404 }
      );
    }

    // Only admin can delete
    if (userRole !== "ADMIN") {
      return NextResponse.json(
        { error: "Forbidden - Only admins can delete doctor profiles" },
        { status: 403 }
      );
    }

    await prisma.doctor.delete({
      where: { id }
    });

    return NextResponse.json(
      { message: "Doctor profile deleted successfully" },
      { status: 200 }
    );

  } catch (error: any) {
    console.error("DELETE Doctor Error:", error);
    return NextResponse.json(
      { error: error?.message ?? "Server error" },
      { status: 500 }
    );
  }
};
