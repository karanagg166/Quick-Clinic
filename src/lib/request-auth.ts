import { NextRequest } from "next/server";
import { verifyToken } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function getAuthenticatedPatient(req: NextRequest) {
  const token = req.cookies.get("token")?.value;
  if (!token) return null;

  const { valid, payload } = await verifyToken(token);
  if (!valid || !payload || (payload as { role?: string }).role !== "PATIENT") return null;

  const userId = (payload as { id?: string }).id;
  if (!userId) return null;

  return prisma.patient.findUnique({ where: { userId }, select: { id: true, userId: true } });
}
