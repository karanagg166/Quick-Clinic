import { NextRequest } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function getAuthenticatedPatient(req: NextRequest) {
  try {
    const user = await getAuthenticatedUser(req, { verifyDb: true });
    if (!user || user.role !== "PATIENT") return null;
    const userId = user.id;

    let patient = await prisma.patient.findUnique({ where: { userId }, select: { id: true, userId: true } });
    if (!patient) {
      patient = await prisma.patient.create({
        data: { userId },
        select: { id: true, userId: true },
      });
    }

    return patient;
  } catch (error) {
    console.error("getAuthenticatedPatient error:", error);
    return null;
  }
}
