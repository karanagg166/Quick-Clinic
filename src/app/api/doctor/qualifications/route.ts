import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  try {
    const qualifications = Object.keys(prisma.Qualification);

    return NextResponse.json(
      { qualifications },
      { status: 200 }
    );

  } catch (err: any) {
    console.error("Qualifications fetch error:", err);

    return NextResponse.json(
      { error: err?.message || "Server error" },
      { status: 500 }
    );
  }
}