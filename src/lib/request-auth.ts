import { NextRequest } from "next/server";
import { verifyToken } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function getAuthenticatedPatient(req: NextRequest) {
  try {
    const authHeader = req.headers.get("authorization");
    const headerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
    const cookieToken = req.cookies.get("token")?.value;
    const token = headerToken || cookieToken;
    if (!token) return null;

    const { valid, payload } = await verifyToken(token);
    if (!valid || !payload) return null;

    const userId = (payload as { id?: string; userId?: string }).id || (payload as { id?: string; userId?: string }).userId;
    if (!userId) return null;

    let patient = await prisma.patient.findUnique({ where: { userId }, select: { id: true, userId: true } });
    if (!patient) {
      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (user) {
        patient = await prisma.patient.create({
          data: { userId },
          select: { id: true, userId: true },
        });
      }
    }

    return patient;
  } catch (error) {
    console.error("getAuthenticatedPatient error:", error);
    return null;
  }
}
