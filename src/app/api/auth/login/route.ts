import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { createToken } from "@/lib/auth";

export async function POST(req: NextRequest) {
  try {
    const { email, password } = await req.json();

    const user = await prisma.user.findUnique({
      where: { email },
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

    const token = await createToken({
      id: user.id,
      email: user.email,
      role: user.role,
    });

    const res = NextResponse.json(
      {
        message: "Login successful",
        role: user.role,
      },
      { status: 200 }
    );

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
    console.error("LOGIN ERROR:", error);
    return NextResponse.json(
      { error: error?.message ?? "Server error" },
      { status: 500 }
    );
  }
}
