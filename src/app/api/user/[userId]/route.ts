import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import type { UserDetail } from "@/types/common";
import { logAccess, logAudit } from "@/lib/logger";
import { verifyToken } from "@/lib/auth";

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

    // 2. Fetch User + Relations
    const userDB = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        doctor: { select: { id: true } },
        patient: { select: { id: true } },
        location: true,
      },
    });

    if (!userDB) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Log Access
    const token = req.cookies.get("token")?.value;
    let viewerId = null;
    if (token) {
      const { payload } = await verifyToken(token);
      if (payload) viewerId = (payload as any).id;
    }
    await logAccess(viewerId, userId, "Viewed Profile");

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
      city: userDB.location?.city || "",
      state: userDB.location?.state || "",
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

    // Build update data
    const updateData: any = {
      name,
      phoneNo,
      age: age ? Number(age) : undefined,
      address,
      gender,
    };

    if (pinCode) {
      updateData.location = {
        connectOrCreate: {
          where: { pincode: Number(pinCode) },
          create: {
            pincode: Number(pinCode),
            city: city || "",
            state: state || "",
          },
        }
      };
    }

    // Perform Update
    const updatedDB = await prisma.user.update({
      where: { id: userId },
      data: updateData,
      include: {
        doctor: { select: { id: true } },
        patient: { select: { id: true } },
        location: true,
      },
    });

    // Log Audit
    await logAudit(userId, "Updated Profile", { updatedFields: Object.keys(updateData) });

    const updatedUserData: UserDetail = {
      id: updatedDB.id,
      name: updatedDB.name,
      email: updatedDB.email,
      phoneNo: updatedDB.phoneNo || "",
      age: updatedDB.age,
      gender: updatedDB.gender as "MALE" | "FEMALE" | "BINARY",
      role: updatedDB.role as "ADMIN" | "DOCTOR" | "PATIENT",
      address: updatedDB.address || "",
      city: updatedDB.location?.city || "",
      state: updatedDB.location?.state || "",
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