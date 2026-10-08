import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/logger";

export async function POST(req: NextRequest) {
  try {
    const { email, otp, newPassword } = await req.json();

    if (!email || !newPassword || typeof otp !== "string" || !otp.trim()) {
      return NextResponse.json(
        { error: "Email, OTP and newPassword are required" },
        { status: 400 }
      );
    }

    if (newPassword.length < 6) {
      return NextResponse.json(
        { error: "New password must be at least 6 characters long" },
        { status: 400 }
      );
    }

    // 1. Find user by email
    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // 2. Verify and atomically consume the required OTP
    if (otp) {
      const record = await prisma.otp.findFirst({
        where: { email },
      });

      if (!record || record.code !== otp) {
        return NextResponse.json(
          { error: "Invalid or expired OTP" },
          { status: 400 }
        );
      }

      if (new Date() > record.expiresAt) {
        return NextResponse.json(
          { error: "OTP has expired" },
          { status: 400 }
        );
      }

      // Only one concurrent request may consume this proof.
      const consumed = await prisma.otp.deleteMany({
        where: { id: record.id, userId: user.id, code: otp, expiresAt: { gt: new Date() } },
      });
      if (consumed.count !== 1) {
        return NextResponse.json({ error: "Invalid or expired OTP" }, { status: 400 });
      }
    }

    // 3. Hash new password & update
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({
      where: { id: user.id },
      data: { password: hashedPassword },
    });

    // 4. Log audit
    await logAudit(user.id, "Reset Password", { role: user.role });

    return NextResponse.json(
      { message: "Password reset successfully" },
      { status: 200 }
    );
  } catch (error: any) {
    console.error("RESET PASSWORD ERROR:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    );
  }
}
