import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/doctors/me/patients/[patientId]/medical-answer/route";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser } from "@/lib/auth";
import { logAccess, logAudit } from "@/lib/logger";
import { generatePatientMedicalAnswer } from "@/lib/search-sphere-client";
import { AppointmentStatus } from "@/generated/prisma";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    doctor: {
      findUnique: vi.fn(),
    },
    appointment: {
      findFirst: vi.fn(),
    },
    medicalDocument: {
      findMany: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
    accessLog: {
      create: vi.fn(),
    },
  },
}));

vi.mock("@/lib/auth", () => ({
  getAuthenticatedUser: vi.fn(),
}));

vi.mock("@/lib/logger", () => ({
  logAccess: vi.fn().mockResolvedValue(undefined),
  logAudit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/search-sphere-client", () => ({
  generatePatientMedicalAnswer: vi.fn(),
}));

describe("Doctor Medical Grounded RAG Answer API (POST /api/doctors/me/patients/[patientId]/medical-answer)", () => {
  const doctorUser = { id: "user_doc_1", role: "DOCTOR", email: "doctor@example.com" };
  const patientUser = { id: "user_pat_1", role: "PATIENT", email: "patient@example.com" };
  const doctorProfile = { id: "doc_profile_1", userId: "user_doc_1" };

  const patientId = "pat_123";
  const rogueDocId = "doc_rogue_999";

  const sampleAnswerResult = {
    answer: "The patient had a blood pressure reading of 120/80 mmHg on October 1, 2026. [1]",
    citations: [
      {
        citationId: 1,
        documentId: "doc_bp_01",
        fileName: "bp_report.pdf",
        documentType: "LAB_REPORT",
        reportDate: "2026-10-01T00:00:00.000Z",
        pageNumber: 1,
        chunkIndex: 0,
        content: "Blood Pressure: 120/80 mmHg",
        score: 0.95,
      },
    ],
    resultCount: 1,
  };

  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe("Authentication & Role Verification", () => {
    it("returns 401 when doctor is unauthenticated", async () => {
      vi.mocked(getAuthenticatedUser).mockResolvedValueOnce(null);

      const req = new NextRequest(`http://localhost:3000/api/doctors/me/patients/${patientId}/medical-answer`, {
        method: "POST",
        body: JSON.stringify({ query: "What was the BP reading?" }),
      });

      const res = await POST(req, { params: Promise.resolve({ patientId }) });
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.error).toContain("Authentication required");
      expect(generatePatientMedicalAnswer).not.toHaveBeenCalled();
    });

    it("returns 403 when user is not a DOCTOR (e.g. PATIENT role)", async () => {
      vi.mocked(getAuthenticatedUser).mockResolvedValueOnce(patientUser as any);

      const req = new NextRequest(`http://localhost:3000/api/doctors/me/patients/${patientId}/medical-answer`, {
        method: "POST",
        body: JSON.stringify({ query: "What was the BP reading?" }),
      });

      const res = await POST(req, { params: Promise.resolve({ patientId }) });
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toContain("Only doctors can access");
      expect(generatePatientMedicalAnswer).not.toHaveBeenCalled();
    });

    it("returns 404 when doctor profile does not exist", async () => {
      vi.mocked(getAuthenticatedUser).mockResolvedValueOnce(doctorUser as any);
      vi.mocked(prisma.doctor.findUnique).mockResolvedValueOnce(null);

      const req = new NextRequest(`http://localhost:3000/api/doctors/me/patients/${patientId}/medical-answer`, {
        method: "POST",
        body: JSON.stringify({ query: "What was the BP reading?" }),
      });

      const res = await POST(req, { params: Promise.resolve({ patientId }) });
      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error).toContain("Doctor profile not found");
      expect(generatePatientMedicalAnswer).not.toHaveBeenCalled();
    });
  });

  describe("Request Validation", () => {
    beforeEach(() => {
      vi.mocked(getAuthenticatedUser).mockResolvedValue(doctorUser as any);
      vi.mocked(prisma.doctor.findUnique).mockResolvedValue(doctorProfile as any);
      vi.mocked(prisma.appointment.findFirst).mockResolvedValue({
        id: "apt_1",
        doctorId: doctorProfile.id,
        patientId,
        status: AppointmentStatus.CONFIRMED,
        bookedAt: new Date(),
        slot: null,
      } as any);
    });

    it("returns 400 when query is empty or whitespace", async () => {
      const req = new NextRequest(`http://localhost:3000/api/doctors/me/patients/${patientId}/medical-answer`, {
        method: "POST",
        body: JSON.stringify({ query: "    " }),
      });

      const res = await POST(req, { params: Promise.resolve({ patientId }) });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("Question is required");
      expect(generatePatientMedicalAnswer).not.toHaveBeenCalled();
    });

    it("returns 400 when query exceeds 1000 characters", async () => {
      const longQuery = "q".repeat(1001);
      const req = new NextRequest(`http://localhost:3000/api/doctors/me/patients/${patientId}/medical-answer`, {
        method: "POST",
        body: JSON.stringify({ query: longQuery }),
      });

      const res = await POST(req, { params: Promise.resolve({ patientId }) });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("cannot exceed 1000 characters");
      expect(generatePatientMedicalAnswer).not.toHaveBeenCalled();
    });
  });

  describe("Appointment-Based Authorization Matrix", () => {
    beforeEach(() => {
      vi.mocked(getAuthenticatedUser).mockResolvedValue(doctorUser as any);
      vi.mocked(prisma.doctor.findUnique).mockResolvedValue(doctorProfile as any);
    });

    it("allows RAG answer generation when doctor has a CONFIRMED appointment", async () => {
      vi.mocked(prisma.appointment.findFirst).mockResolvedValueOnce({
        id: "apt_confirmed",
        doctorId: doctorProfile.id,
        patientId,
        status: AppointmentStatus.CONFIRMED,
        bookedAt: new Date(),
        slot: null,
      } as any);

      vi.mocked(generatePatientMedicalAnswer).mockResolvedValueOnce(sampleAnswerResult);
      vi.mocked(prisma.medicalDocument.findMany).mockResolvedValueOnce([{ id: "doc_bp_01" }] as any);

      const req = new NextRequest(`http://localhost:3000/api/doctors/me/patients/${patientId}/medical-answer`, {
        method: "POST",
        body: JSON.stringify({ query: "What was the BP reading?" }),
      });

      const res = await POST(req, { params: Promise.resolve({ patientId }) });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.answer).toContain("120/80 mmHg");
      expect(data.citations.length).toBe(1);
      expect(generatePatientMedicalAnswer).toHaveBeenCalledWith({
        patientId,
        query: "What was the BP reading?",
        limit: 8,
        documentType: undefined,
        fromDate: undefined,
        toDate: undefined,
      });
    });

    it("allows RAG answer generation when doctor has a COMPLETED appointment", async () => {
      vi.mocked(prisma.appointment.findFirst).mockResolvedValueOnce({
        id: "apt_completed",
        doctorId: doctorProfile.id,
        patientId,
        status: AppointmentStatus.COMPLETED,
        bookedAt: new Date(),
        slot: null,
      } as any);

      vi.mocked(generatePatientMedicalAnswer).mockResolvedValueOnce(sampleAnswerResult);
      vi.mocked(prisma.medicalDocument.findMany).mockResolvedValueOnce([{ id: "doc_bp_01" }] as any);

      const req = new NextRequest(`http://localhost:3000/api/doctors/me/patients/${patientId}/medical-answer`, {
        method: "POST",
        body: JSON.stringify({ query: "What was the BP reading?" }),
      });

      const res = await POST(req, { params: Promise.resolve({ patientId }) });
      expect(res.status).toBe(200);
      expect(generatePatientMedicalAnswer).toHaveBeenCalledTimes(1);
    });

    const disallowedStatuses = [
      AppointmentStatus.PENDING,
      AppointmentStatus.CANCELLED,
      AppointmentStatus.EXPIRED,
      AppointmentStatus.NO_SHOW,
      AppointmentStatus.RESCHEDULED,
    ];

    for (const status of disallowedStatuses) {
      it(`denies RAG answer generation and logs audit when appointment is ${status}`, async () => {
        vi.mocked(prisma.appointment.findFirst).mockResolvedValueOnce(null);

        const req = new NextRequest(`http://localhost:3000/api/doctors/me/patients/${patientId}/medical-answer`, {
          method: "POST",
          body: JSON.stringify({ query: "What was the BP reading?" }),
        });

        const res = await POST(req, { params: Promise.resolve({ patientId }) });
        expect(res.status).toBe(403);
        const data = await res.json();
        expect(data.error).toContain("Access denied");

        expect(generatePatientMedicalAnswer).not.toHaveBeenCalled();

        expect(logAudit).toHaveBeenCalledWith(
          doctorUser.id,
          "MEDICAL_RAG_QUERY_DENIED",
          expect.objectContaining({
            patientId,
            doctorId: doctorProfile.id,
            reason: "NO_ELIGIBLE_APPOINTMENT",
          }),
          "MEDICAL_RECORD"
        );
      });
    }

    it("denies access when doctor has no appointments with patient (Cross-Doctor IDOR protection)", async () => {
      vi.mocked(prisma.appointment.findFirst).mockResolvedValueOnce(null);

      const req = new NextRequest(`http://localhost:3000/api/doctors/me/patients/${patientId}/medical-answer`, {
        method: "POST",
        body: JSON.stringify({ query: "Current medications" }),
      });

      const res = await POST(req, { params: Promise.resolve({ patientId }) });
      expect(res.status).toBe(403);
      expect(generatePatientMedicalAnswer).not.toHaveBeenCalled();
      expect(logAudit).toHaveBeenCalledWith(
        doctorUser.id,
        "MEDICAL_RAG_QUERY_DENIED",
        expect.objectContaining({
          patientId,
          doctorId: doctorProfile.id,
        }),
        "MEDICAL_RECORD"
      );
    });
  });

  describe("Citation Authorization Validation (Cross-Patient Defense-in-Depth)", () => {
    beforeEach(() => {
      vi.mocked(getAuthenticatedUser).mockResolvedValue(doctorUser as any);
      vi.mocked(prisma.doctor.findUnique).mockResolvedValue(doctorProfile as any);
      vi.mocked(prisma.appointment.findFirst).mockResolvedValue({
        id: "apt_1",
        doctorId: doctorProfile.id,
        patientId,
        status: AppointmentStatus.CONFIRMED,
        bookedAt: new Date(),
        slot: null,
      } as any);
    });

    it("fails closed with 500 and logs MEDICAL_RAG_SECURITY_ANOMALY when citation references document not owned by patient", async () => {
      // Search Sphere returns a rogue citation not belonging to patientId
      const contaminatedResult = {
        answer: "Patient BP was 150/95 mmHg. [1]",
        citations: [
          {
            citationId: 1,
            documentId: rogueDocId, // Cross-patient document!
            fileName: "rogue_doc.pdf",
            documentType: "LAB_REPORT",
            reportDate: "2026-10-01T00:00:00.000Z",
            pageNumber: 1,
            chunkIndex: 0,
            content: "BP 150/95",
            score: 0.99,
          },
        ],
        resultCount: 1,
      };

      vi.mocked(generatePatientMedicalAnswer).mockResolvedValueOnce(contaminatedResult);
      // Prisma finds NO matching documents for patientId with rogueDocId
      vi.mocked(prisma.medicalDocument.findMany).mockResolvedValueOnce([]);

      const req = new NextRequest(`http://localhost:3000/api/doctors/me/patients/${patientId}/medical-answer`, {
        method: "POST",
        body: JSON.stringify({ query: "What was the BP reading?" }),
      });

      const res = await POST(req, { params: Promise.resolve({ patientId }) });
      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data.error).toContain("Security validation failed");

      // Verify security anomaly audit log
      expect(logAudit).toHaveBeenCalledWith(
        doctorUser.id,
        "MEDICAL_RAG_SECURITY_ANOMALY",
        expect.objectContaining({
          patientId,
          doctorId: doctorProfile.id,
          reason: "CROSS_PATIENT_CITATION_DETECTED",
        }),
        "MEDICAL_RECORD"
      );

      // Verify access log was NOT recorded for contaminated response
      expect(logAccess).not.toHaveBeenCalled();
    });
  });

  describe("PHI Preservation in Logging", () => {
    beforeEach(() => {
      vi.mocked(getAuthenticatedUser).mockResolvedValue(doctorUser as any);
      vi.mocked(prisma.doctor.findUnique).mockResolvedValue(doctorProfile as any);
      vi.mocked(prisma.appointment.findFirst).mockResolvedValue({
        id: "apt_1",
        doctorId: doctorProfile.id,
        patientId,
        status: AppointmentStatus.CONFIRMED,
        bookedAt: new Date(),
        slot: null,
      } as any);
    });

    it("strictly preserves PHI: never logs raw question, generated answer, or clinical values", async () => {
      const sensitiveQuestion = "Does this patient have HIV positive viral load or take retrovirals?";
      vi.mocked(generatePatientMedicalAnswer).mockResolvedValueOnce(sampleAnswerResult);
      vi.mocked(prisma.medicalDocument.findMany).mockResolvedValueOnce([{ id: "doc_bp_01" }] as any);

      const req = new NextRequest(`http://localhost:3000/api/doctors/me/patients/${patientId}/medical-answer`, {
        method: "POST",
        body: JSON.stringify({ query: sensitiveQuestion }),
      });

      const res = await POST(req, { params: Promise.resolve({ patientId }) });
      expect(res.status).toBe(200);

      // Verify Access Log
      expect(logAccess).toHaveBeenCalledWith(
        doctorUser.id,
        patientId,
        "MEDICAL_RAG_QUERY",
        "MEDICAL_RECORD"
      );

      // Verify Audit Log
      expect(logAudit).toHaveBeenCalledWith(
        doctorUser.id,
        "MEDICAL_RAG_QUERY",
        {
          patientId,
          citationCount: 1,
          resultCount: 1,
        },
        "MEDICAL_RECORD"
      );

      // Verify NO PHI is present in any call arguments
      const accessCalls = vi.mocked(logAccess).mock.calls;
      for (const call of accessCalls) {
        const text = JSON.stringify(call);
        expect(text).not.toContain(sensitiveQuestion);
        expect(text).not.toContain("120/80");
        expect(text).not.toContain("HIV");
      }

      const auditCalls = vi.mocked(logAudit).mock.calls;
      for (const call of auditCalls) {
        const text = JSON.stringify(call);
        expect(text).not.toContain(sensitiveQuestion);
        expect(text).not.toContain("120/80");
        expect(text).not.toContain("HIV");
      }
    });

    it("handles service failures cleanly with MEDICAL_RAG_GENERATION_FAILED and zero PHI", async () => {
      vi.mocked(generatePatientMedicalAnswer).mockRejectedValueOnce(
        new Error("Cohere rate limit exceeded")
      );

      const req = new NextRequest(`http://localhost:3000/api/doctors/me/patients/${patientId}/medical-answer`, {
        method: "POST",
        body: JSON.stringify({ query: "Patient cancer staging" }),
      });

      const res = await POST(req, { params: Promise.resolve({ patientId }) });
      expect(res.status).toBe(500);

      expect(logAudit).toHaveBeenCalledWith(
        doctorUser.id,
        "MEDICAL_RAG_GENERATION_FAILED",
        expect.objectContaining({
          patientId,
          doctorId: doctorProfile.id,
          reason: "SERVICE_ERROR",
        }),
        "MEDICAL_RECORD"
      );

      const auditCalls = vi.mocked(logAudit).mock.calls;
      for (const call of auditCalls) {
        const text = JSON.stringify(call);
        expect(text).not.toContain("cancer staging");
      }
    });
  });
});
