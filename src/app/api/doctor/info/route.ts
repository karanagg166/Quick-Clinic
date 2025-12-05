import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUserId } from "@/lib/auth";

// 📌 GET: Get doctor record for logged-in user

export async function GET(req: NextRequest) {
  try {
    const token = req.cookies.get("token")?.value;
        if (!token) return NextResponse.json({ error: "No token" }, { status: 401 });

    const result = await getUserId(token);
        if (!result.valid) return NextResponse.json({ error: "Invalid token" }, { status: 401 });

    const userId = result.userId;

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const doctor = await prisma.doctor.findUnique({
      where: { userId },
      include: {
        user: true,
      },
    });

    if (!doctor) {
      return NextResponse.json(
        { error: "Doctor profile not found" },
        { status: 404 }
      );
    }
const res= NextResponse.json(doctor, { status: 201 });
    res.cookies.set("doctorId", doctor.id, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
    });
    return res;

  } catch (err: any) {
    console.error("GET Doctor Error:", err);
    return NextResponse.json(
      { error: err?.message ?? "Server error" },
      { status: 500 }
    );
  }
}

// 📌 POST: Create doctor 

export async function POST(req: NextRequest) {
  try {
    const token = req.cookies.get("token")?.value;
        if (!token) return NextResponse.json({ error: "No token" }, { status: 401 });

    const result = await getUserId(token);
        if (!result.valid) return NextResponse.json({ error: "Invalid token" }, { status: 401 });

    const userId = result.userId;

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const {
      specialty,
      experience,
      qualification,
      fees,
    } = await req.json();

    const existingDoctor = await prisma.doctor.findUnique({
      where: { userId },
    });

    if (existingDoctor) {
      return NextResponse.json(
        { error: "Doctor profile already exists" },
        { status: 400 }
      );
    }

    const doctor = await prisma.doctor.create({
      data: {
        userId,
        specialty,
        experience: Number(experience) || 0,
        qualifications: qualification || [],
        fees: Number(fees) || 0,
      },
    });

    return NextResponse.json(doctor, { status: 201 });

  } catch (err: any) {
    console.error("POST Doctor Error:", err);
    return NextResponse.json(
      { error: err?.message ?? "Server error" },
      { status: 500 }
    );
  }
}

// 📌 PUT: Update doctor record

export async function PUT(req: NextRequest) {
  try {
    const token = req.cookies.get("token")?.value;
        if (!token) return NextResponse.json({ error: "No token" }, { status: 401 });

    const result = await getUserId(token);
        if (!result.valid) return NextResponse.json({ error: "Invalid token" }, { status: 401 });

    const userId = result.userId;

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const {
      specialty,
      experience,
      qualification,
      fees,
    } = await req.json();

    const existingDoctor = await prisma.doctor.findUnique({
      where: { userId },
    });

    if (!existingDoctor) {
      return NextResponse.json(
        { error: "Doctor profile not found" },
        { status: 404 }
      );
    }

    const updated = await prisma.doctor.update({
      where: { userId },
      data: {
        specialty,
        experience: Number(experience) ,
        qualifications: qualification ,
        fees: Number(fees) ,
      },
    });

    return NextResponse.json(updated, { status: 200 });

  } catch (err: any) {
    console.error("PUT Doctor Error:", err);
    return NextResponse.json(
      { error: err?.message ?? "Server error" },
      { status: 500 }
    );
  }
}
