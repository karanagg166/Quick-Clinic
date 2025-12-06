import { NextRequest, NextResponse } from "next/server";
import { Specialty } from "@/generated/prisma";

export async function GET() {
  try {
    const specialties = Object.keys(Specialty);

    return NextResponse.json(
      { specialties },
      { status: 200 }
    );

  } catch (err: any) {
    console.error("Specializations fetch error:", err);

    return NextResponse.json(
      { error: err?.message || "Server error" },
      { status: 500 }
    );
  }
}
