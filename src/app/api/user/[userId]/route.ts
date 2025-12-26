import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import type { UserDetail } from "@/types/common";

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

    // 3. Map DB result to unified UserDetail shape
    const userData: UserDetail = {
      id: userDB.id,
      name: userDB.name,
      email: userDB.email,
      phoneNo: userDB.phoneNo || "",
      age: userDB.age,
      gender: userDB.gender as "MALE" | "FEMALE" | "BINARY",
      role: userDB.role as "ADMIN" | "DOCTOR" | "PATIENT",
      address: userDB.address || "",
      city: userDB.city || "",
      state: userDB.state || "",
      pinCode: userDB.pinCode || 0,
      profileImageUrl: userDB.profileImageUrl ?? undefined,
      emailVerified: userDB.emailVerified,
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

    const updatedUserData: UserDetail = {
      id: updatedDB.id,
      name: updatedDB.name,
      email: updatedDB.email,
      phoneNo: updatedDB.phoneNo || "",
      age: updatedDB.age,
      gender: updatedDB.gender as "MALE" | "FEMALE" | "BINARY",
      role: updatedDB.role as "ADMIN" | "DOCTOR" | "PATIENT",
      address: updatedDB.address || "",
      city: updatedDB.city || "",
      state: updatedDB.state || "",
      pinCode: updatedDB.pinCode || 0,
      profileImageUrl: updatedDB.profileImageUrl ?? undefined,
      emailVerified: updatedDB.emailVerified,
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