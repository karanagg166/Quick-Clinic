import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";   // better import
import { createToken } from "@/lib/auth";

export const POST = async (req: NextRequest) => {
  try {
    const { name, email, phoneNo, age, city, state, pinCode, password } =
      await req.json();

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

    await prisma.user.create({
      data: {
        name,
        email,
        phoneNo,
        password: hashedPassword,
        age: Number(age),
        city,
        state,
        pinCode,
      },
    });

    const token = await createToken({ email });

    const res = NextResponse.json(
      { message: "User Signup successfully" },
      { status: 200 }
    );

    res.cookies.set("token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      path: "/",
      sameSite: "strict",
      maxAge: 60 * 60 * 24,
    });

    return res;
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message ?? "Server error" },
      { status: 500 }
    );
  }
};
