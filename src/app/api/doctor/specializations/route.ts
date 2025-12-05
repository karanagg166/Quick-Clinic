import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const specializations = Object.keys(prisma.Specialty);

    return NextResponse.json(
      { specializations },
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
