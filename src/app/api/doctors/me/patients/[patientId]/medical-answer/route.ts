import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser } from "@/lib/auth";
import { logAccess, logAudit } from "@/lib/logger";
import { verifyDoctorPatientMedicalAccess } from "@/lib/medical-record-access";
import { generatePatientMedicalAnswer } from "@/lib/search-sphere-client";
import { getOrCreateRequestId, runWithRequestId } from "@/lib/correlation-id";
import { checkDoctorMedicalRateLimit } from "@/lib/rate-limiter";
import { sanitizeErrorMessage } from "@/lib/error-sanitizer";

interface RouteParams {
  params: Promise<{
    patientId: string;
  }>;
}

const answerSchema = z.object({
  query: z
    .string()
    .trim()
    .min(1, "Question is required")
    .max(1000, "Question cannot exceed 1000 characters"),
  limit: z.coerce.number().int().min(1).max(20).default(8).optional(),
  documentType: z.string().optional(),
  fromDate: z.string().optional(),
  toDate: z.string().optional(),
});

export async function POST(req: NextRequest, { params }: RouteParams) {
  const requestId = getOrCreateRequestId(req);

  return runWithRequestId(requestId, async () => {
    let authUserId: string | null = null;
    let cleanPatientId: string | null = null;
    let doctorId: string | null = null;

    try {
      const authUser = await getAuthenticatedUser(req, { verifyDb: true });
      if (!authUser) {
        return NextResponse.json(
          { error: "Authentication required" },
          { status: 401 }
        );
      }
      authUserId = authUser.id;

      if (authUser.role !== "DOCTOR") {
        return NextResponse.json(
          { error: "Access denied. Only doctors can access this endpoint." },
          { status: 403 }
        );
      }

      const { patientId } = await params;
      if (!patientId || typeof patientId !== "string" || !patientId.trim()) {
        return NextResponse.json(
          { error: "Patient ID is required" },
          { status: 400 }
        );
      }

      cleanPatientId = patientId.trim();

      const doctor = await prisma.doctor.findUnique({
        where: { userId: authUser.id },
        select: { id: true },
      });

      if (!doctor) {
        return NextResponse.json(
          { error: "Doctor profile not found" },
          { status: 404 }
        );
      }
      doctorId = doctor.id;

      // Rate limiting per doctor identity
      const rateLimit = await checkDoctorMedicalRateLimit(doctor.id, "answer");
      if (!rateLimit.allowed) {
        return NextResponse.json(
          { error: "Too many requests. Please slow down and try again later." },
          {
            status: 429,
            headers: {
              "Retry-After": rateLimit.resetSeconds.toString(),
              "X-RateLimit-Limit": rateLimit.limit.toString(),
              "X-RateLimit-Remaining": rateLimit.remaining.toString(),
            },
          }
        );
      }

      // Verify doctor-patient relationship authorization (CONFIRMED or COMPLETED appointments only)
      const accessCheck = await verifyDoctorPatientMedicalAccess(doctor.id, cleanPatientId);
      if (!accessCheck.allowed) {
        await logAudit(
          authUser.id,
          "MEDICAL_RAG_QUERY_DENIED",
          {
            patientId: cleanPatientId,
            doctorId: doctor.id,
            reason: accessCheck.reason || "NO_ELIGIBLE_APPOINTMENT",
          },
          "MEDICAL_RECORD"
        );

        return NextResponse.json(
          { error: "Access denied. You do not have an active or completed appointment with this patient." },
          { status: 403 }
        );
      }

      // Validate request body
      const bodyJson = await req.json().catch(() => null);
      const parsed = answerSchema.safeParse(bodyJson);
      if (!parsed.success) {
        const issue = parsed.error.issues[0]?.message || "Invalid medical question request";
        return NextResponse.json(
          { error: issue },
          { status: 400 }
        );
      }

      const { query, limit = 8, documentType, fromDate, toDate } = parsed.data;

      // Generate grounded medical answer via Search Sphere internal RAG
      let ragResponse;
      try {
        ragResponse = await generatePatientMedicalAnswer({
          patientId: cleanPatientId,
          query,
          limit,
          documentType,
          fromDate,
          toDate,
        });
      } catch (ragError: any) {
        console.error(`[RequestId: ${requestId}] Medical RAG generation failed:`, ragError);
        await logAudit(
          authUser.id,
          "MEDICAL_RAG_GENERATION_FAILED",
          {
            patientId: cleanPatientId,
            doctorId: doctor.id,
            reason: "SERVICE_ERROR",
          },
          "MEDICAL_RECORD"
        );

        const sanitizedError = sanitizeErrorMessage(
          ragError,
          "AI answer generation is temporarily unavailable."
        );
        return NextResponse.json(
          { error: sanitizedError },
          { status: 500 }
        );
      }

      // Citation authorization validation (Defense-in-depth against cross-patient contamination)
      if (ragResponse.citations && ragResponse.citations.length > 0) {
        const citedDocIds = Array.from(
          new Set(ragResponse.citations.map((c) => c.documentId).filter(Boolean))
        );

        const matchingDocs = await prisma.medicalDocument.findMany({
          where: {
            id: { in: citedDocIds },
            patientId: cleanPatientId,
          },
          select: { id: true },
        });

        const matchingDocIdSet = new Set(matchingDocs.map((d) => d.id));
        const hasInvalidCitation = citedDocIds.some((id) => !matchingDocIdSet.has(id));

        if (hasInvalidCitation) {
          console.error(
            `[SECURITY ANOMALY][RequestId: ${requestId}] Search Sphere returned citations for documents not belonging to patient ${cleanPatientId}`
          );
          await logAudit(
            authUser.id,
            "MEDICAL_RAG_SECURITY_ANOMALY",
            {
              patientId: cleanPatientId,
              doctorId: doctor.id,
              reason: "CROSS_PATIENT_CITATION_DETECTED",
            },
            "MEDICAL_RECORD"
          );

          return NextResponse.json(
            { error: "Security validation failed: invalid citation references detected" },
            { status: 500 }
          );
        }
      }

      // Access and Audit logging (Strict PHI protection: never log raw query or generated answer)
      await logAccess(
        authUser.id,
        cleanPatientId,
        "MEDICAL_RAG_QUERY",
        "MEDICAL_RECORD"
      );

      await logAudit(
        authUser.id,
        "MEDICAL_RAG_QUERY",
        {
          patientId: cleanPatientId,
          citationCount: ragResponse.citations.length,
          resultCount: ragResponse.resultCount,
        },
        "MEDICAL_RECORD"
      );

      return NextResponse.json(
        {
          answer: ragResponse.answer,
          citations: ragResponse.citations,
          resultCount: ragResponse.resultCount,
        },
        { status: 200 }
      );
    } catch (error: any) {
      console.error(`[RequestId: ${requestId}] Doctor medical answer endpoint error:`, error);

      if (authUserId && cleanPatientId) {
        await logAudit(
          authUserId,
          "MEDICAL_RAG_GENERATION_FAILED",
          {
            patientId: cleanPatientId,
            doctorId: doctorId ?? "UNKNOWN",
            reason: "UNEXPECTED_SERVER_ERROR",
          },
          "MEDICAL_RECORD"
        );
      }

      const sanitizedError = sanitizeErrorMessage(
        error,
        "AI answer generation is temporarily unavailable."
      );
      return NextResponse.json(
        { error: sanitizedError },
        { status: 500 }
      );
    }
  });
}
