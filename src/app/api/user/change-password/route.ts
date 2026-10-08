import { getAuthenticatedUser } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/logger";

export async function POST(req: NextRequest) {
  try {
    const authUser = await getAuthenticatedUser(req, { verifyDb: true });
    if (!authUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { email, userId, currentPassword, newPassword } = await req.json();

    if ((!email && !userId) || !newPassword) {
      return NextResponse.json(
        { error: "Email or userId, and newPassword are required" },
        { status: 400 }
      );
    }

    if (newPassword.length < 6) {
      return NextResponse.json(
        { error: "New password must be at least 6 characters long" },
        { status: 400 }
      );
    }

    // 1. Find user by email or userId
    const user = await prisma.user.findFirst({
      where: email ? { email } : { id: userId },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    if (user.id !== authUser.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (typeof currentPassword !== "string" || !currentPassword) {
      return NextResponse.json({ error: "Current password is required" }, { status: 400 });
    }

    // 2. Verify the required current password
    if (currentPassword) {
      const isPasswordValid = await bcrypt.compare(currentPassword, user.password);
      if (!isPasswordValid) {
        return NextResponse.json(
          { error: "Current password is incorrect" },
          { status: 400 }
        );
      }
    }

    // 3. Hash new password and update user
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({
      where: { id: user.id },
      data: { password: hashedPassword },
    });

    // 4. Log audit
    await logAudit(user.id, "Changed Password", { role: user.role });

    return NextResponse.json(
      { message: "Password changed successfully" },
      { status: 200 }
    );
  } catch (error: any) {
    console.error("CHANGE PASSWORD ERROR:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    );
  }
}
