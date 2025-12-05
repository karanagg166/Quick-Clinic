import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { createToken } from "@/lib/auth";

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
      role,
      gender
    } = await req.json();

    

    // Convert role to uppercase to match Prisma enum
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

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user
    const user=await prisma.user.create({
      data: {
        name,
        email,
        phoneNo,
        password: hashedPassword,
        age: Number(age),
        city,
        state,
        pinCode: Number(pinCode),
        role: normalizedRole, 
        gender:gender
      },
    });

    // Optionally store role in token
    const token = await createToken({ id: user.id,email: user.email,
       role: normalizedRole 
      });

    const res = NextResponse.json(
      { message: "User Signup successfully" },
      { status: 200 }
    );

    // Set cookie
    res.cookies.set("token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      path: "/",
      sameSite: "strict",
      maxAge: 60 * 60 * 24,
    });

    return res;

  } catch (error: any) {
    console.error("Signup Error:", error);

    return NextResponse.json(
      { error: error?.message ?? "Server error" },
      { status: 500 }
    );
  }
};
