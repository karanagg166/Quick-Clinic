import { NextRequest, NextResponse } from "next/server";
import { Qualification } from "@/generated/prisma";

export async function GET(req: NextRequest) {
  try {
    const qualifications = Object.keys(Qualification);

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