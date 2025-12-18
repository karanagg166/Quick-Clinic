import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const POST = async (
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) => {
  try {
    const { otp } = await request.json();
    const { userId } = await params;

    if (!otp) {
      return NextResponse.json(
        { message: "OTP is required" },
        { status: 400 }
      );
    }

    // 1️⃣ Find OTP record (bind to user)
    const record = await prisma.otp.findFirst({
      where: {
        userId,
      },
    });

    if (!record) {
      return NextResponse.json(
        { message: "Invalid OTP" },
        { status: 400 }
      );
    }

    // 2️⃣ Check OTP match
    if (record.code !== otp) {
      return NextResponse.json(
        { message: "Invalid OTP" },
        { status: 400 }
      );
    }

    // 3️⃣ Check expiry BEFORE deleting
    const now = new Date();
    if (now > record.expiresAt) {
      return NextResponse.json(
        { message: "OTP has expired" },
        { status: 400 }
      );
    }

    // 4️⃣ Mark user as verified (schema field is `emailVerified`)
    await prisma.user.update({
      where: { id: userId },
      data: { emailVerified: true },
    });

    // 5️⃣ Delete OTP record
    await prisma.otp.deleteMany({
      where: {
        userId,
      },
    });

    return NextResponse.json(
      { message: "OTP verified successfully" },
      { status: 200 }
    );
  } catch (err) {
    console.error("Error in OTP verification route:", err);
    return NextResponse.json(
      { message: "Internal Server Error" },
      { status: 500 }
    );
  }
};
