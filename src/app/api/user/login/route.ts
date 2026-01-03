import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { createToken } from "@/lib/auth";
import { logAudit } from "@/lib/logger";
import type { UserDetail } from "@/types/common";






export const maxDuration = 30;

export async function POST(req: NextRequest) {
  try {
    const { email, password } = await req.json();

    if (!email || !password) {
      return NextResponse.json(
        { error: "Email and password are required" },
        { status: 400 }
      );
    }

    const user = await prisma.user.findUnique({
      where: {
        email: email
      },
      include: {
        doctor: {
          select: { id: true }
        }
        , patient: {
          select: { id: true }
        }
      }
    });

    if (!user) {
      return NextResponse.json({ error: "Invalid email" }, { status: 400 });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return NextResponse.json(
        { error: "Incorrect password" },
        { status: 400 }
      );
    }

    // JWT token
    const token = await createToken({
      id: user.id,
      email: user.email,
      role: user.role
    });

    const doctorId = user.doctor?.id ?? null;
    const patientId = user.patient?.id ?? null;

    const userDetails: UserDetail = {
      id: user.id,
      name: user.name,
      email: user.email,
      phoneNo: user.phoneNo,
      age: user.age,

      gender: user.gender,
      role: user.role,

      address: user.address,
      city: user.city,
      state: user.state,
      pinCode: user.pinCode,

      profileImageUrl: user.profileImageUrl,
      emailVerified: user.emailVerified,
      doctorId,
      patientId,
    };

    // Response
    const res = NextResponse.json(
      {
        message: "Login successful",
        user: userDetails,
        doctorId,
        patientId,
      },
      { status: 200 }
    );

    res.cookies.set("token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 7,
    });
    res.cookies.set("role", user.role, {
      httpOnly: false,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
    });
    await logAudit(user.id, "User Login", userDetails);

    return res;
  } catch (error: unknown) {
    console.error("LOGIN ERROR:", error);
    const errorMessage = error instanceof Error ? error.message : "Server error";
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}
