import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { createToken } from "@/lib/auth";




interface User {
  userId: string;
  email: string;
  role: string;
  name: string;
  gender: string;
  age: number;
  doctorId: string | null;
  patientId: string | null;
}



export async function POST(req: NextRequest) {
  try {
    const { email, password } = await req.json();

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

    // Fetch linked doctor/patient ids
    let doctorId: string | null = null;
    let patientId: string | null = null;

    if (user.role === "DOCTOR") {
      const doctor = await prisma.doctor.findUnique({
        where: { userId: user.id },
        select: { id: true },
      });
      doctorId = doctor?.id ?? null;
    } else if (user.role === "PATIENT") {
      const patient = await prisma.patient.findUnique({
        where: { userId: user.id },
        select: { id: true },
      });
      patientId = patient?.id ?? null;
    }

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
