import "server-only";
import { getAuthenticatedUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { verifyDoctorPatientMedicalAccess } from "@/lib/medical-record-access";

export class MedicalResponseAccessError extends Error {
  constructor() { super("Medical response access changed."); }
}

/** Refresh the consumer-owned grant after upstream generation/retrieval. */
export async function assertMedicalResponseAccess(
  request: Request, userId: string, doctorId: string, patientId: string, conversationId?: string
) {
  const current = await getAuthenticatedUser(request, { verifyDb: true });
  if (!current || current.id !== userId || current.role !== "DOCTOR") throw new MedicalResponseAccessError();
  const doctor = await prisma.doctor.findUnique({ where: { userId }, select: { id: true } });
  if (!doctor || doctor.id !== doctorId) throw new MedicalResponseAccessError();
  if (!(await verifyDoctorPatientMedicalAccess(doctorId, patientId)).allowed) throw new MedicalResponseAccessError();
  if (conversationId) {
    const thread = await prisma.medicalAiConversation.findUnique({
      where: { id: conversationId }, select: { id: true, doctorId: true, patientId: true },
    });
    if (!thread || thread.doctorId !== doctorId || thread.patientId !== patientId) throw new MedicalResponseAccessError();
  }
}
