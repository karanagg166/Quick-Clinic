import { NextResponse } from "next/server";
import { checkDatabaseReadiness } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  const dbCheck = await checkDatabaseReadiness(7000);

  if (!dbCheck.ok) {
    const requestId = crypto.randomUUID();
    console.error(`[/api/ready][${requestId}] Database readiness check failed:`, dbCheck.error);
    return NextResponse.json(
      {
        status: "unready",
        service: "quick-clinic-web",
        database: "disconnected",
        latencyMs: dbCheck.latencyMs,
        error: "DATABASE_UNAVAILABLE",
        requestId,
        environment: process.env.NODE_ENV || "development",
        timestamp: new Date().toISOString(),
      },
      { status: 503 }
    );
  }

  return NextResponse.json({
    status: "ready",
    service: "quick-clinic-web",
    database: "connected",
    latencyMs: dbCheck.latencyMs,
    environment: process.env.NODE_ENV || "development",
    timestamp: new Date().toISOString(),
  });
}
