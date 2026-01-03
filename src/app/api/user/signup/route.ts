import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { createToken } from "@/lib/auth";
import { logAudit } from "@/lib/logger";
import type { UserDetail } from "@/types/common";
import { metadata } from "@/app/layout";
export const POST = async (req: NextRequest) => {
  try {
    const {
      name,
      email,
      phoneNo,
      age,
      city,
      state,
      pinCode,
      password,
      address,
      role,
      gender
    } = await req.json();

    const normalizedRole = role.toUpperCase();

    // Check if user exists
    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      return NextResponse.json(
        { error: "User already exists" },
        { status: 400 }
      );
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: {
        name,
        email,
        phoneNo,
        password: hashedPassword,
        age: Number(age),
        address,
        role: normalizedRole,
        gender,
        location: {
          connectOrCreate: {
            where: { pincode: Number(pinCode) },
            create: {
              pincode: Number(pinCode),
              city: city,
              state: state,
            },
          },
        },
      },
      include: {
        location: true
      }
    });

    console.log("New User Created:", user);

    const userDetails: UserDetail = {
      id: user.id,
      email: user.email,
      phoneNo: user.phoneNo ?? "",
      name: user.name,
      age: user.age,
      gender: user.gender as "MALE" | "FEMALE" | "BINARY",
      role: user.role as "ADMIN" | "DOCTOR" | "PATIENT",
      address: user.address,
      city: user.location.city,
      state: user.location.state,
      pinCode: user.location.pincode,
      profileImageUrl: user.profileImageUrl ?? undefined,
      emailVerified: user.emailVerified,
      doctorId: null,
      patientId: null,
    };
    const res = NextResponse.json(

      { message: "User created successfully", user: userDetails },
      { status: 201 }
    );
    const token = await createToken({
      id: user.id,
      email: user.email,
      role: user.role
    });
    res.cookies.set("token", token, {
      httpOnly: true,
      secure: false,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 7,
    });
    res.cookies.set("role", user.role, {
      httpOnly: false,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
    });
    await logAudit(user.id, "User Created", user);

    return res;

  } catch (error: any) {
    console.error("Signup Error:", error);

    return NextResponse.json(
      { error: error?.message ?? "Server error" },
      { status: 500 }
    );
  }
};
