import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// GET - Fetch all doctors or a specific doctor
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

    // Only ADMIN and PATIENT can view all doctors, DOCTOR can only view their own data
    if (userRole === "DOCTOR") {
      const doctor = await prisma.doctor.findUnique({
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
          { error: "Doctor profile not found" },
          { status: 404 }
        );
      }

      return NextResponse.json({ doctor }, { status: 200 });
    }

    // ADMIN or PATIENT - fetch all doctors
    const doctors = await prisma.doctor.findMany({
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
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    return NextResponse.json({ doctors, count: doctors.length }, { status: 200 });

  } catch (error: any) {
    console.error("GET Doctors Error:", error);
    return NextResponse.json(
      { error: error?.message ?? "Server error" },
      { status: 500 }
    );
  }
};

// POST - Create a new doctor profile
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

    // Check if user role is DOCTOR
    if (userRole !== "DOCTOR") {
      return NextResponse.json(
        { error: "Only users with DOCTOR role can create doctor profiles" },
        { status: 403 }
      );
    }

    // Check if doctor profile already exists
    const existingDoctor = await prisma.doctor.findUnique({
      where: { userId }
    });

    if (existingDoctor) {
      return NextResponse.json(
        { error: "Doctor profile already exists for this user" },
        { status: 400 }
      );
    }

    const {
      specialty,
      experience = 0,
      qualifications = [],
      fees = 0
    } = await req.json();

    // Validate required fields
    if (!specialty) {
      return NextResponse.json(
        { error: "Specialty is required" },
        { status: 400 }
      );
    }

    // Create doctor profile
    const doctor = await prisma.doctor.create({
      data: {
        userId,
        specialty,
        experience: Number(experience),
        qualifications,
        fees: Number(fees)
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
        message: "Doctor profile created successfully", 
        doctor 
      },
      { status: 201 }
    );

  } catch (error: any) {
    console.error("POST Doctor Error:", error);
    return NextResponse.json(
      { error: error?.message ?? "Server error" },
      { status: 500 }
    );
  }
};
