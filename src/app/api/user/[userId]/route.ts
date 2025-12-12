import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import type { User } from "@/types/common"; // 1. Import the User type

// 1. GET: Fetch User Details
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const { userId } = await params;

    if (!userId) {
      return NextResponse.json({ error: "User ID is required" }, { status: 400 });
    }

    // 2. Fetch User + Relations (to get doctorId/patientId)
    const userDB = await prisma.user.findUnique({
      where: { id: userId }, // Prisma usually uses 'id', not 'userId'
      include: {
        doctor: { select: { id: true } },
        patient: { select: { id: true } },
      },
    });

    if (!userDB) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // 3. Map DB result to your User type format
    // This ensures the frontend receives exactly what it expects
    const userData: User & { 
      // Add extra profile fields if they aren't in your base User type
      address: string; city: string; state: string; pinCode: number; phoneNo: string 
    } = {
      userId: userDB.id,
      name: userDB.name,
      email: userDB.email,
      role: userDB.role as "DOCTOR" | "PATIENT",
      gender: userDB.gender as "MALE" | "FEMALE" | "BINARY",
      age: userDB.age,
      phoneNo: userDB.phoneNo || "",
      address: userDB.address || "",
      city: userDB.city || "",
      state: userDB.state || "",
      pinCode: userDB.pinCode || 0,
      
      // Handle optional relations safely
      doctorId: userDB.doctor?.id ?? null,
      patientId: userDB.patient?.id ?? null,
    };

    return NextResponse.json(userData, { status: 200 });

  } catch (error: any) {
    console.error("SERVER ERROR (GET PROFILE):", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    );
  }
}

// 2. PATCH: Update User Details
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const { userId } = await params;
    const body = await req.json();

    const { name, phoneNo, age, address, city, state, pinCode, gender } = body;

    // Perform Update
    const updatedDB = await prisma.user.update({
      where: { id: userId },
      data: {
        name,
        phoneNo,
        age: age ? Number(age) : undefined,
        address,
        city,
        state,
        pinCode: pinCode ? Number(pinCode) : undefined,
        gender,
      },
      // Include relations again to return the full User object
      include: {
        doctor: { select: { id: true } },
        patient: { select: { id: true } },
      },
    });

    // Map updated result to User type
    const updatedUserData: User & { 
       address: string; city: string; state: string; pinCode: number; phoneNo: string 
    } = {
      userId: updatedDB.id,
      name: updatedDB.name,
      email: updatedDB.email,
      role: updatedDB.role as "DOCTOR" | "PATIENT",
      gender: updatedDB.gender as "MALE" | "FEMALE" | "BINARY",
      age: updatedDB.age,
      phoneNo: updatedDB.phoneNo || "",
      address: updatedDB.address || "",
      city: updatedDB.city || "",
      state: updatedDB.state || "",
      pinCode: updatedDB.pinCode || 0,
      doctorId: updatedDB.doctor?.id ?? null,
      patientId: updatedDB.patient?.id ?? null,
    };

    return NextResponse.json(updatedUserData, { status: 200 });

  } catch (error: any) {
    console.error("SERVER ERROR (UPDATE PROFILE):", error);
    
    if (error.code === 'P2025') {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    return NextResponse.json(
      { error: error.message || "Internal Server Error" },
      { status: 500 }
    );
  }
}