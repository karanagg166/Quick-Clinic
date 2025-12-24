import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { createToken } from "@/lib/auth";
import type { User } from "@/types/common";






export const maxDuration = 30; // Increase timeout to 30 seconds for Vercel

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
         email:email    
       },
       include:{
        doctor:{
          select:{ id:true}
        }
        ,patient:{
          select:{ id:true}
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

    const userDetails: User = {
      userId: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
      gender: user.gender,
      age: user.age,
      doctorId: user.doctor?.id,
      patientId: user.patient?.id,
    };

    // Use doctor/patient IDs from the initial query (already included)
    const doctorId = user.doctor?.id ?? null;
    const patientId = user.patient?.id ?? null;

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
