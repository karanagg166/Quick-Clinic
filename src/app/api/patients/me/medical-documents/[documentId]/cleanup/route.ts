import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getOrCreateRequestId } from "@/lib/correlation-id";
import { getMedicalDocumentCleanupReceipt, SearchSphereServiceError } from "@/lib/search-sphere-client";

export const maxDuration = 30;

export async function GET(req: NextRequest, { params }: { params: Promise<{ documentId: string }> }) {
  const requestId = getOrCreateRequestId(req);
  const respond = (body: Record<string, unknown>, status: number) => NextResponse.json(
    { ...body, requestId }, { status, headers: { "Cache-Control": "private, no-store" } }
  );
  try {
    const user = await getAuthenticatedUser(req, { verifyDb: true });
    if (!user) return respond({ error: "Authentication required" }, 401);
    if (user.role !== "PATIENT") return respond({ error: "Patient access required" }, 403);
    const patient = await prisma.patient.findUnique({ where: { userId: user.id }, select: { id: true } });
    if (!patient) return respond({ error: "Patient record not found" }, 404);
    const { documentId } = await params;
    if (!documentId || documentId.length > 255) return respond({ error: "Invalid document identity" }, 400);
    // The receipt survives local metadata deletion. Upstream independently checks
    // client, tenant, this patient and its hashed collection before returning it.
    const cleanup = await getMedicalDocumentCleanupReceipt(documentId, { subjectId: patient.id, requestId, signal: req.signal });
    return respond({ cleanup }, 200);
  } catch (error) {
    if (error instanceof SearchSphereServiceError && [403, 404].includes(error.status)) {
      return respond({ error: "Document cleanup receipt not found" }, 404);
    }
    return respond({ error: "Document cleanup is not verified", code: "cleanup_unverified" }, 503);
  }
}
