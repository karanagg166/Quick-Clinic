import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser } from "@/lib/auth";
import { logAccess, logAudit } from "@/lib/logger";
import { verifyDoctorPatientMedicalAccess } from "@/lib/medical-record-access";
import { searchPatientMedicalRecords } from "@/lib/search-sphere-client";
import { getOrCreateRequestId, runWithRequestId } from "@/lib/correlation-id";
import { checkDoctorMedicalRateLimit } from "@/lib/rate-limiter";
import { sanitizeErrorMessage } from "@/lib/error-sanitizer";

interface RouteParams {
  params: Promise<{
    patientId: string;
  }>;
}

const searchSchema = z.object({
  query: z
    .string()
    .trim()
    .min(1, "Search query is required")
    .max(500, "Search query cannot exceed 500 characters"),
  limit: z.coerce.number().int().min(1).max(20).default(8).optional(),
});

export async function POST(req: NextRequest, { params }: RouteParams) {
  const requestId = getOrCreateRequestId(req);

  return runWithRequestId(requestId, async () => {
    try {
      const authUser = await getAuthenticatedUser(req);
      if (!authUser) {
        return NextResponse.json(
          { error: "Authentication required" },
          { status: 401 }
        );
      }

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

      const cleanPatientId = patientId.trim();

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

      // Rate limiting per doctor identity
      const rateLimit = await checkDoctorMedicalRateLimit(doctor.id, "search");
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
          "MEDICAL_RECORD_SEARCH_DENIED",
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
      const parsed = searchSchema.safeParse(bodyJson);
      if (!parsed.success) {
        const issue = parsed.error.issues[0]?.message || "Invalid search request";
        return NextResponse.json(
          { error: issue },
          { status: 400 }
        );
      }

      const { query, limit = 8 } = parsed.data;

      // Call Search Sphere internal retrieval API
      const searchResponse = await searchPatientMedicalRecords({
        patientId: cleanPatientId,
        query,
        limit,
      });

      // Defense-in-depth: Validate returned chunk metadata patient isolation
      let detectedAnomaly = false;
      const validResults = (searchResponse.results || []).filter((chunk) => {
        if (chunk.patientId !== cleanPatientId) {
          detectedAnomaly = true;
          console.error(
            `[SECURITY ALERT][RequestId: ${requestId}] Search Sphere returned cross-patient chunk: expected ${cleanPatientId}, received ${chunk.patientId}`
          );
          return false;
        }
        return true;
      });

      if (detectedAnomaly) {
        await logAudit(
          authUser.id,
          "MEDICAL_RECORD_SEARCH_ANOMALY",
          {
            patientId: cleanPatientId,
            doctorId: doctor.id,
            reason: "CROSS_PATIENT_METADATA_DETECTED",
          },
          "MEDICAL_RECORD"
        );
      }

      // Audit and access logging (Strict PHI protection: never log raw query or medical chunk excerpts)
      await logAccess(
        authUser.id,
        cleanPatientId,
        "MEDICAL_RECORD_SEARCH",
        "MEDICAL_RECORD"
      );

      await logAudit(
        authUser.id,
        "MEDICAL_RECORD_SEARCH",
        {
          patientId: cleanPatientId,
          resultCount: validResults.length,
        },
        "MEDICAL_RECORD"
      );

      return NextResponse.json(
        {
          results: validResults,
        },
        { status: 200 }
      );
    } catch (error: any) {
      console.error(`[RequestId: ${requestId}] Doctor medical search error:`, error);
      const sanitizedError = sanitizeErrorMessage(
        error,
        "Medical record search is temporarily unavailable."
      );
      return NextResponse.json(
        { error: sanitizedError },
        { status: 500 }
      );
    }
  });
}
