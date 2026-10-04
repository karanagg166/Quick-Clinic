import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/doctors/me/patients/[patientId]/medical-search/route";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser } from "@/lib/auth";
import { logAccess, logAudit } from "@/lib/logger";
import { searchPatientMedicalRecords } from "@/lib/search-sphere-client";
import { AppointmentStatus } from "@/generated/prisma";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    doctor: {
      findUnique: vi.fn(),
    },
    appointment: {
      findFirst: vi.fn(),
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
  searchPatientMedicalRecords: vi.fn(),
}));

describe("Doctor Medical Record Search API (POST /api/doctors/me/patients/[patientId]/medical-search)", () => {
  const doctorUser = { id: "user_doc_1", role: "DOCTOR", email: "doctor@example.com" };
  const patientUser = { id: "user_pat_1", role: "PATIENT", email: "patient@example.com" };
  const doctorProfile = { id: "doc_profile_1", userId: "user_doc_1" };

  const patientId = "pat_123";
  const crossPatientId = "pat_rogue_999";

  const sampleChunks = [
    {
      score: 0.92,
      content: "Patient blood pressure is 120/80 mmHg, heart rate 72 bpm.",
      documentId: "doc_lab_1",
      documentType: "LAB_REPORT",
      reportDate: "2026-10-01T00:00:00.000Z",
      fileName: "vitals_oct2026.pdf",
      pageNumber: 1,
      chunkIndex: 0,
      patientId: patientId,
    },
    {
      score: 0.85,
      content: "Patient reports normal recovery, no dizziness recorded.",
      documentId: "doc_lab_1",
      documentType: "LAB_REPORT",
      reportDate: "2026-10-01T00:00:00.000Z",
      fileName: "vitals_oct2026.pdf",
      pageNumber: 1,
      chunkIndex: 1,
      patientId: patientId,
    },
  ];

  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe("Authentication & Role Verification", () => {
    it("returns 401 when doctor is unauthenticated", async () => {
      vi.mocked(getAuthenticatedUser).mockResolvedValueOnce(null);

      const req = new NextRequest(`http://localhost:3000/api/doctors/me/patients/${patientId}/medical-search`, {
        method: "POST",
        body: JSON.stringify({ query: "blood pressure" }),
      });

      const res = await POST(req, { params: Promise.resolve({ patientId }) });
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.error).toContain("Authentication required");
      expect(searchPatientMedicalRecords).not.toHaveBeenCalled();
    });

    it("returns 403 when user is not a DOCTOR (e.g. PATIENT role)", async () => {
      vi.mocked(getAuthenticatedUser).mockResolvedValueOnce(patientUser as any);

      const req = new NextRequest(`http://localhost:3000/api/doctors/me/patients/${patientId}/medical-search`, {
        method: "POST",
        body: JSON.stringify({ query: "blood pressure" }),
      });

      const res = await POST(req, { params: Promise.resolve({ patientId }) });
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toContain("Only doctors can access");
      expect(searchPatientMedicalRecords).not.toHaveBeenCalled();
    });

    it("returns 404 when doctor profile does not exist", async () => {
      vi.mocked(getAuthenticatedUser).mockResolvedValueOnce(doctorUser as any);
      vi.mocked(prisma.doctor.findUnique).mockResolvedValueOnce(null);

      const req = new NextRequest(`http://localhost:3000/api/doctors/me/patients/${patientId}/medical-search`, {
        method: "POST",
        body: JSON.stringify({ query: "blood pressure" }),
      });

      const res = await POST(req, { params: Promise.resolve({ patientId }) });
      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error).toContain("Doctor profile not found");
      expect(searchPatientMedicalRecords).not.toHaveBeenCalled();
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
      const req = new NextRequest(`http://localhost:3000/api/doctors/me/patients/${patientId}/medical-search`, {
        method: "POST",
        body: JSON.stringify({ query: "   " }),
      });

      const res = await POST(req, { params: Promise.resolve({ patientId }) });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("Search query is required");
      expect(searchPatientMedicalRecords).not.toHaveBeenCalled();
    });

    it("returns 400 when query exceeds 500 characters", async () => {
      const longQuery = "a".repeat(501);
      const req = new NextRequest(`http://localhost:3000/api/doctors/me/patients/${patientId}/medical-search`, {
        method: "POST",
        body: JSON.stringify({ query: longQuery }),
      });

      const res = await POST(req, { params: Promise.resolve({ patientId }) });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("cannot exceed 500 characters");
      expect(searchPatientMedicalRecords).not.toHaveBeenCalled();
    });
  });

  describe("Appointment-Based Authorization Matrix", () => {
    beforeEach(() => {
      vi.mocked(getAuthenticatedUser).mockResolvedValue(doctorUser as any);
      vi.mocked(prisma.doctor.findUnique).mockResolvedValue(doctorProfile as any);
    });

    it("allows retrieval when doctor has a CONFIRMED appointment", async () => {
      vi.mocked(prisma.appointment.findFirst).mockResolvedValueOnce({
        id: "apt_confirmed",
        doctorId: doctorProfile.id,
        patientId,
        status: AppointmentStatus.CONFIRMED,
        bookedAt: new Date(),
        slot: null,
      } as any);

      vi.mocked(searchPatientMedicalRecords).mockResolvedValueOnce({
        results: sampleChunks,
      });

      const req = new NextRequest(`http://localhost:3000/api/doctors/me/patients/${patientId}/medical-search`, {
        method: "POST",
        body: JSON.stringify({ query: "blood pressure", limit: 5 }),
      });

      const res = await POST(req, { params: Promise.resolve({ patientId }) });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.results.length).toBe(2);
      expect(data.results[0].content).toContain("120/80 mmHg");

      expect(searchPatientMedicalRecords).toHaveBeenCalledWith({
        patientId,
        query: "blood pressure",
        limit: 5,
      });
    });

    it("allows retrieval when doctor has a COMPLETED appointment", async () => {
      vi.mocked(prisma.appointment.findFirst).mockResolvedValueOnce({
        id: "apt_completed",
        doctorId: doctorProfile.id,
        patientId,
        status: AppointmentStatus.COMPLETED,
        bookedAt: new Date(),
        slot: null,
      } as any);

      vi.mocked(searchPatientMedicalRecords).mockResolvedValueOnce({
        results: sampleChunks,
      });

      const req = new NextRequest(`http://localhost:3000/api/doctors/me/patients/${patientId}/medical-search`, {
        method: "POST",
        body: JSON.stringify({ query: "blood pressure" }),
      });

      const res = await POST(req, { params: Promise.resolve({ patientId }) });
      expect(res.status).toBe(200);
      expect(searchPatientMedicalRecords).toHaveBeenCalledTimes(1);
    });

    const disallowedStatuses = [
      AppointmentStatus.PENDING,
      AppointmentStatus.CANCELLED,
      AppointmentStatus.EXPIRED,
      AppointmentStatus.NO_SHOW,
      AppointmentStatus.RESCHEDULED,
    ];

    for (const status of disallowedStatuses) {
      it(`denies retrieval and logs audit when appointment is ${status}`, async () => {
        // prisma.appointment.findFirst with CONFIRMED/COMPLETED returns null
        vi.mocked(prisma.appointment.findFirst).mockResolvedValueOnce(null);

        const req = new NextRequest(`http://localhost:3000/api/doctors/me/patients/${patientId}/medical-search`, {
          method: "POST",
          body: JSON.stringify({ query: "blood pressure" }),
        });

        const res = await POST(req, { params: Promise.resolve({ patientId }) });
        expect(res.status).toBe(403);
        const data = await res.json();
        expect(data.error).toContain("Access denied");

        expect(searchPatientMedicalRecords).not.toHaveBeenCalled();

        // Verify audit log for denied search attempt
        expect(logAudit).toHaveBeenCalledWith(
          doctorUser.id,
          "MEDICAL_RECORD_SEARCH_DENIED",
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

      const req = new NextRequest(`http://localhost:3000/api/doctors/me/patients/${patientId}/medical-search`, {
        method: "POST",
        body: JSON.stringify({ query: "allergies" }),
      });

      const res = await POST(req, { params: Promise.resolve({ patientId }) });
      expect(res.status).toBe(403);
      expect(searchPatientMedicalRecords).not.toHaveBeenCalled();
      expect(logAudit).toHaveBeenCalledWith(
        doctorUser.id,
        "MEDICAL_RECORD_SEARCH_DENIED",
        expect.objectContaining({
          patientId,
          doctorId: doctorProfile.id,
        }),
        "MEDICAL_RECORD"
      );
    });
  });

  describe("Defense-in-Depth & PHI-Safe Logging", () => {
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

    it("drops cross-patient chunks returned from Search Sphere and logs security anomaly", async () => {
      const mixedResults = [
        sampleChunks[0],
        {
          score: 0.99,
          content: "Rogue patient record snippet with private health information",
          documentId: "doc_rogue_99",
          documentType: "PRESCRIPTION",
          reportDate: "2026-10-02T00:00:00.000Z",
          fileName: "other_patient.pdf",
          pageNumber: 1,
          chunkIndex: 0,
          patientId: crossPatientId, // Mismatched!
        },
      ];

      vi.mocked(searchPatientMedicalRecords).mockResolvedValueOnce({
        results: mixedResults,
      });

      const req = new NextRequest(`http://localhost:3000/api/doctors/me/patients/${patientId}/medical-search`, {
        method: "POST",
        body: JSON.stringify({ query: "blood pressure" }),
      });

      const res = await POST(req, { params: Promise.resolve({ patientId }) });
      expect(res.status).toBe(200);
      const data = await res.json();

      // Only patientId chunk should be returned
      expect(data.results.length).toBe(1);
      expect(data.results[0].patientId).toBe(patientId);
      expect(data.results.some((r: any) => r.patientId === crossPatientId)).toBe(false);

      // Verify anomaly audit log
      expect(logAudit).toHaveBeenCalledWith(
        doctorUser.id,
        "MEDICAL_RECORD_SEARCH_ANOMALY",
        expect.objectContaining({
          patientId,
          doctorId: doctorProfile.id,
          reason: "CROSS_PATIENT_METADATA_DETECTED",
        }),
        "MEDICAL_RECORD"
      );
    });

    it("strictly preserves PHI: never logs raw query string or chunk contents in logs", async () => {
      const privateQuery = "Patient takes 50mg Sertraline daily for severe anxiety";

      vi.mocked(searchPatientMedicalRecords).mockResolvedValueOnce({
        results: sampleChunks,
      });

      const req = new NextRequest(`http://localhost:3000/api/doctors/me/patients/${patientId}/medical-search`, {
        method: "POST",
        body: JSON.stringify({ query: privateQuery }),
      });

      const res = await POST(req, { params: Promise.resolve({ patientId }) });
      expect(res.status).toBe(200);

      // Verify AccessLog call
      expect(logAccess).toHaveBeenCalledWith(
        doctorUser.id,
        patientId,
        "MEDICAL_RECORD_SEARCH",
        "MEDICAL_RECORD"
      );

      // Verify AuditLog call
      expect(logAudit).toHaveBeenCalledWith(
        doctorUser.id,
        "MEDICAL_RECORD_SEARCH",
        {
          patientId,
          resultCount: 2,
        },
        "MEDICAL_RECORD"
      );

      // Inspect all mock calls to logAccess and logAudit to ensure no PHI was leaked
      const accessLogCalls = vi.mocked(logAccess).mock.calls;
      for (const call of accessLogCalls) {
        const serialized = JSON.stringify(call);
        expect(serialized).not.toContain(privateQuery);
        expect(serialized).not.toContain("120/80 mmHg");
      }

      const auditLogCalls = vi.mocked(logAudit).mock.calls;
      for (const call of auditLogCalls) {
        const serialized = JSON.stringify(call);
        expect(serialized).not.toContain(privateQuery);
        expect(serialized).not.toContain("120/80 mmHg");
      }
    });

    it("returns 500 cleanly if Search Sphere service fails", async () => {
      vi.mocked(searchPatientMedicalRecords).mockRejectedValueOnce(
        new Error("Medical retrieval failed (502): Bad Gateway")
      );

      const req = new NextRequest(`http://localhost:3000/api/doctors/me/patients/${patientId}/medical-search`, {
        method: "POST",
        body: JSON.stringify({ query: "blood pressure" }),
      });

      const res = await POST(req, { params: Promise.resolve({ patientId }) });
      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data.error).toContain("Medical retrieval failed");
    });
  });
});
