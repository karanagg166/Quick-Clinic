import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { createToken } from "@/lib/auth-token";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest) {
  return handleTokenRequest(req);
}

export async function GET(req: NextRequest) {
  return handleTokenRequest(req);
}

async function handleTokenRequest(req: NextRequest) {
  try {
    const user = await getAuthenticatedUser(req, { verifyDb: true });
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Extract relationId if client requested ticket for a specific chat relation
    let relationId: string | undefined;
    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      if (typeof body?.relationId === "string" && body.relationId.trim()) {
        relationId = body.relationId.trim();
      }
    }
    if (!relationId) {
      const queryRel = req.nextUrl.searchParams.get("relationId");
      if (queryRel && queryRel.trim()) {
        relationId = queryRel.trim();
      }
    }

    if (relationId) {
      const relation = await prisma.doctorPatientRelation.findUnique({
        where: { id: relationId },
        select: { id: true, doctorsUserId: true, patientsUserId: true },
      });

      if (!relation) {
        return NextResponse.json({ error: "Relation not found" }, { status: 404 });
      }

      if (
        user.role !== "ADMIN" &&
        relation.doctorsUserId !== user.id &&
        relation.patientsUserId !== user.id
      ) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }

    // Create a short-lived (10m) audience-bound token
    const token = await createToken(
      {
        id: user.id,
        userId: user.id,
        role: user.role,
        name: user.name,
        email: user.email,
        aud: "quick-clinic-socket",
        relationId: relationId || undefined,
      },
      "10m"
    );

    const socketUrl =
      process.env.NEXT_PUBLIC_SOCKET_URL ||
      (process.env.NODE_ENV !== "production" ? "http://localhost:4000" : "");

    return NextResponse.json(
      {
        success: true,
        token,
        socketUrl,
        user: { id: user.id, name: user.name, role: user.role },
      },
      {
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
          Pragma: "no-cache",
          Expires: "0",
        },
      }
    );
  } catch (error: any) {
    console.error("Socket token issuance error:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    );
  }
}
