import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { createToken } from "@/lib/auth";
import type { UserDetail } from "@/types/common";
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
        city,
        address,
        state,
        pinCode: Number(pinCode),
        role: normalizedRole, 
        gender
      },
      
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
      city: user.city,
      state: user.state,
      pinCode: user.pinCode,
      profileImageUrl: user.profileImageUrl ?? undefined,
      emailVerified: user.emailVerified,
      doctorId: null,
      patientId: null,
    };
    const res = NextResponse.json(
      
      { message: "User created successfully",user:userDetails },
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
    sameSite: "strict",});
    
    return res;

  } catch (error: any) {
    console.error("Signup Error:", error);

    return NextResponse.json(
      { error: error?.message ?? "Server error" },
      { status: 500 }
    );
  }
};
