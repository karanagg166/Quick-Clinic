import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    status: "ok",
    service: "quick-clinic-web",
    environment: process.env.NODE_ENV || "development",
    timestamp: new Date().toISOString(),
  });
}
