import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser } from "@/lib/auth";
import { logAccess, logAudit } from "@/lib/logger";
import { verifyDoctorPatientMedicalAccess } from "@/lib/medical-record-access";
import { queryPatientMedicalObservations } from "@/lib/search-sphere-client";
import { getOrCreateRequestId, runWithRequestId } from "@/lib/correlation-id";
import { checkDoctorMedicalRateLimit } from "@/lib/rate-limiter";
import { sanitizeErrorMessage } from "@/lib/error-sanitizer";

interface RouteParams {
  params: Promise<{
    patientId: string;
  }>;
}

const querySchema = z.object({
  observationTypes: z.array(z.string().trim().min(1)).optional(),
  fromDate: z.string().trim().optional(),
  toDate: z.string().trim().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100).optional(),
  sort: z.enum(["asc", "desc"]).default("asc").optional(),
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
      const rateLimit = await checkDoctorMedicalRateLimit(doctor.id, "observations");
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
          "MEDICAL_OBSERVATION_ACCESS_DENIED",
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
      const bodyJson = await req.json().catch(() => ({}));
      const parsed = querySchema.safeParse(bodyJson);
      if (!parsed.success) {
        const issue = parsed.error.issues[0]?.message || "Invalid query request";
        return NextResponse.json(
          { error: issue },
          { status: 400 }
        );
      }

      const { observationTypes, fromDate, toDate, limit = 100, sort = "asc" } = parsed.data;

      // Call Search Sphere internal observations API
      const response = await queryPatientMedicalObservations({
        patientId: cleanPatientId,
        observationTypes,
        fromDate,
        toDate,
        limit,
        sort,
      });

      const observations = response.observations || [];

      // Strictly PHI-safe logging: log patientId, count, types; never numeric readings or clinical text
      await logAccess(
        authUser.id,
        cleanPatientId,
        "MEDICAL_OBSERVATIONS_QUERY",
        "MEDICAL_RECORD"
      );

      await logAudit(
        authUser.id,
        "MEDICAL_STRUCTURED_QUERY",
        {
          patientId: cleanPatientId,
          observationCount: observations.length,
          observationTypes: observationTypes || null,
        },
        "MEDICAL_RECORD"
      );

      return NextResponse.json(
        {
          observations,
          totalCount: response.totalCount ?? observations.length,
        },
        { status: 200 }
      );
    } catch (error: any) {
      console.error(`[RequestId: ${requestId}] Doctor medical observations query error:`, error);
      const sanitizedError = sanitizeErrorMessage(
        error,
        "Patient medical observations are temporarily unavailable."
      );
      return NextResponse.json(
        { error: sanitizedError },
        { status: 500 }
      );
    }
  });
}
