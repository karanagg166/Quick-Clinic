import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { GET as GET_DOCUMENTS } from "@/app/api/doctors/me/patients/[patientId]/medical-documents/route";
import { GET as GET_DOCUMENT_ACCESS } from "@/app/api/doctors/me/patients/[patientId]/medical-documents/[documentId]/access/route";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser } from "@/lib/auth";
import { logAccess, logAudit } from "@/lib/logger";
import { getSignedStorageUrl } from "@/lib/search-sphere-client";
import { AppointmentStatus, MedicalDocumentType } from "@/generated/prisma";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    doctor: {
      findUnique: vi.fn(),
    },
    appointment: {
      findFirst: vi.fn(),
    },
    patient: {
      findUnique: vi.fn(),
    },
    medicalDocument: {
      findMany: vi.fn(),
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
  getSignedStorageUrl: vi.fn(),
}));

describe("Doctor Medical Document Access & Audit Suite", () => {
  const doctorAUser = { id: "user_doc_a", role: "DOCTOR", email: "doc_a@example.com" };
  const doctorBUser = { id: "user_doc_b", role: "DOCTOR", email: "doc_b@example.com" };
  const patientUser = { id: "user_pat_1", role: "PATIENT", email: "patient@example.com" };

  const doctorAProfile = { id: "doc_profile_a", userId: "user_doc_a" };
  const doctorBProfile = { id: "doc_profile_b", userId: "user_doc_b" };

  const patientAId = "pat_alpha";
  const patientBId = "pat_bravo";

  const docPatientA = {
    id: "doc_101",
    patientId: patientAId,
    title: "Complete Blood Count",
    type: MedicalDocumentType.LAB_REPORT,
    fileName: "cbc_report.pdf",
    mimeType: "application/pdf",
    fileSize: 102400,
    reportDate: new Date("2026-10-01T00:00:00Z"),
    hospitalOrDoctor: "Metro Hospital",
    notes: "Platelets normal",
    storagePath: "patients/pat_alpha/medical-documents/doc_101.pdf",
    processingStatus: "READY",
    processingError: null,
    processedAt: new Date("2026-10-01T01:00:00Z"),
    createdAt: new Date("2026-10-01T00:00:00Z"),
    updatedAt: new Date("2026-10-01T00:00:00Z"),
  };

  const docPatientB = {
    id: "doc_202",
    patientId: patientBId,
    title: "Chest X-Ray",
    type: MedicalDocumentType.RADIOLOGY_SCAN,
    fileName: "xray.png",
    mimeType: "image/png",
    fileSize: 204800,
    reportDate: new Date("2026-09-15T00:00:00Z"),
    hospitalOrDoctor: "City Imaging Center",
    notes: null,
    storagePath: "patients/pat_bravo/medical-documents/doc_202.png",
    processingStatus: "READY",
    processingError: null,
    processedAt: new Date("2026-09-15T01:00:00Z"),
    createdAt: new Date("2026-09-15T00:00:00Z"),
    updatedAt: new Date("2026-09-15T00:00:00Z"),
  };

  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe("PART 14 & 15: Appointment Authorization & Cross-Doctor Isolation (GET /medical-documents)", () => {
    it("returns 401 when doctor is unauthenticated", async () => {
      vi.mocked(getAuthenticatedUser).mockResolvedValueOnce(null);

      const req = new NextRequest(`http://localhost:3000/api/doctors/me/patients/${patientAId}/medical-documents`);
      const res = await GET_DOCUMENTS(req, { params: Promise.resolve({ patientId: patientAId }) });

      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.error).toContain("Authentication required");
    });

    it("returns 403 when non-doctor user attempts access", async () => {
      vi.mocked(getAuthenticatedUser).mockResolvedValueOnce(patientUser as any);

      const req = new NextRequest(`http://localhost:3000/api/doctors/me/patients/${patientAId}/medical-documents`);
      const res = await GET_DOCUMENTS(req, { params: Promise.resolve({ patientId: patientAId }) });

      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toContain("Access denied");
    });

    it("grants access to Patient A documents when Doctor A has a CONFIRMED appointment", async () => {
      vi.mocked(getAuthenticatedUser).mockResolvedValueOnce(doctorAUser as any);
      vi.mocked(prisma.doctor.findUnique).mockResolvedValueOnce(doctorAProfile as any);
      vi.mocked(prisma.appointment.findFirst).mockResolvedValueOnce({
        id: "appt_conf_1",
        doctorId: doctorAProfile.id,
        patientId: patientAId,
        status: AppointmentStatus.CONFIRMED,
        bookedAt: new Date("2026-10-04T10:00:00Z"),
        slot: { date: new Date("2026-10-06T00:00:00Z") },
      } as any);

      vi.mocked(prisma.medicalDocument.findMany).mockResolvedValueOnce([docPatientA as any]);
      vi.mocked(prisma.patient.findUnique).mockResolvedValueOnce({
        id: patientAId,
        user: { name: "Alice Johnson", age: 30, gender: "FEMALE", profileImageUrl: null },
      } as any);

      const req = new NextRequest(`http://localhost:3000/api/doctors/me/patients/${patientAId}/medical-documents`);
      const res = await GET_DOCUMENTS(req, { params: Promise.resolve({ patientId: patientAId }) });

      expect(res.status).toBe(200);
      const data = await res.json();

      expect(data.patient.name).toBe("Alice Johnson");
      expect(data.patient.qualifyingAppointment.status).toBe(AppointmentStatus.CONFIRMED);
      expect(data.documents.length).toBe(1);
      expect(data.documents[0].id).toBe("doc_101");
      expect(data.documents[0].title).toBe("Complete Blood Count");
      // Critical check: storagePath must NEVER be leaked in client response
      expect(data.documents[0].storagePath).toBeUndefined();

      // Verify AccessLog was recorded
      expect(logAccess).toHaveBeenCalledWith(
        doctorAUser.id,
        patientAId,
        "MEDICAL_DOCUMENT_LIST",
        "MEDICAL_RECORD"
      );
    });

    it("grants access to Patient A documents when Doctor A has a COMPLETED appointment", async () => {
      vi.mocked(getAuthenticatedUser).mockResolvedValueOnce(doctorAUser as any);
      vi.mocked(prisma.doctor.findUnique).mockResolvedValueOnce(doctorAProfile as any);
      vi.mocked(prisma.appointment.findFirst).mockResolvedValueOnce({
        id: "appt_comp_1",
        doctorId: doctorAProfile.id,
        patientId: patientAId,
        status: AppointmentStatus.COMPLETED,
        bookedAt: new Date("2026-09-01T10:00:00Z"),
        slot: null,
      } as any);

      vi.mocked(prisma.medicalDocument.findMany).mockResolvedValueOnce([docPatientA as any]);
      vi.mocked(prisma.patient.findUnique).mockResolvedValueOnce({
        id: patientAId,
        user: { name: "Alice Johnson", age: 30, gender: "FEMALE", profileImageUrl: null },
      } as any);

      const req = new NextRequest(`http://localhost:3000/api/doctors/me/patients/${patientAId}/medical-documents`);
      const res = await GET_DOCUMENTS(req, { params: Promise.resolve({ patientId: patientAId }) });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.patient.qualifyingAppointment.status).toBe(AppointmentStatus.COMPLETED);
    });

    it("denies access and logs audit when Doctor B attempts to access Patient A (no qualifying appointment)", async () => {
      vi.mocked(getAuthenticatedUser).mockResolvedValueOnce(doctorBUser as any);
      vi.mocked(prisma.doctor.findUnique).mockResolvedValueOnce(doctorBProfile as any);
      // No qualifying appointment for Doctor B + Patient A
      vi.mocked(prisma.appointment.findFirst).mockResolvedValueOnce(null);

      const req = new NextRequest(`http://localhost:3000/api/doctors/me/patients/${patientAId}/medical-documents`);
      const res = await GET_DOCUMENTS(req, { params: Promise.resolve({ patientId: patientAId }) });

      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toContain("Access denied");

      // Verify AuditLog for denied attempt
      expect(logAudit).toHaveBeenCalledWith(
        doctorBUser.id,
        "MEDICAL_DOCUMENT_ACCESS_DENIED",
        expect.objectContaining({
          patientId: patientAId,
          doctorId: doctorBProfile.id,
          reason: "NO_ELIGIBLE_APPOINTMENT",
        }),
        "MEDICAL_RECORD"
      );
      // Verify documents were not fetched
      expect(prisma.medicalDocument.findMany).not.toHaveBeenCalled();
    });

    it("denies access when appointment status is only PENDING, CANCELLED, EXPIRED, NO_SHOW, or RESCHEDULED", async () => {
      vi.mocked(getAuthenticatedUser).mockResolvedValueOnce(doctorAUser as any);
      vi.mocked(prisma.doctor.findUnique).mockResolvedValueOnce(doctorAProfile as any);
      // findFirst returns null because status filter excludes non-confirmed/non-completed
      vi.mocked(prisma.appointment.findFirst).mockResolvedValueOnce(null);

      const req = new NextRequest(`http://localhost:3000/api/doctors/me/patients/${patientAId}/medical-documents`);
      const res = await GET_DOCUMENTS(req, { params: Promise.resolve({ patientId: patientAId }) });

      expect(res.status).toBe(403);
      expect(logAudit).toHaveBeenCalledWith(
        doctorAUser.id,
        "MEDICAL_DOCUMENT_ACCESS_DENIED",
        expect.objectContaining({
          patientId: patientAId,
          doctorId: doctorAProfile.id,
          reason: "NO_ELIGIBLE_APPOINTMENT",
        }),
        "MEDICAL_RECORD"
      );
    });

    it("supports search and document type filters", async () => {
      vi.mocked(getAuthenticatedUser).mockResolvedValueOnce(doctorAUser as any);
      vi.mocked(prisma.doctor.findUnique).mockResolvedValueOnce(doctorAProfile as any);
      vi.mocked(prisma.appointment.findFirst).mockResolvedValueOnce({
        id: "appt_1",
        status: AppointmentStatus.CONFIRMED,
      } as any);

      vi.mocked(prisma.medicalDocument.findMany).mockResolvedValueOnce([]);
      vi.mocked(prisma.patient.findUnique).mockResolvedValueOnce(null);

      const req = new NextRequest(
        `http://localhost:3000/api/doctors/me/patients/${patientAId}/medical-documents?search=blood&type=LAB_REPORT`
      );
      const res = await GET_DOCUMENTS(req, { params: Promise.resolve({ patientId: patientAId }) });

      expect(res.status).toBe(200);
      expect(prisma.medicalDocument.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            patientId: patientAId,
            type: MedicalDocumentType.LAB_REPORT,
            OR: expect.arrayContaining([
              { title: { contains: "blood", mode: "insensitive" } },
            ]),
          }),
        })
      );
    });
  });

  describe("PART 16 & 17: Secure Document Access URL & IDOR Defense (GET .../access)", () => {
    it("returns short-lived signed URL and logs MEDICAL_DOCUMENT_VIEW on default view access", async () => {
      vi.mocked(getAuthenticatedUser).mockResolvedValueOnce(doctorAUser as any);
      vi.mocked(prisma.doctor.findUnique).mockResolvedValueOnce(doctorAProfile as any);
      vi.mocked(prisma.appointment.findFirst).mockResolvedValueOnce({
        id: "appt_conf_1",
        status: AppointmentStatus.CONFIRMED,
      } as any);

      vi.mocked(prisma.medicalDocument.findFirst).mockResolvedValueOnce({
        id: "doc_101",
        patientId: patientAId,
        title: "Complete Blood Count",
        fileName: "cbc_report.pdf",
        mimeType: "application/pdf",
        fileSize: 102400,
        storagePath: "patients/pat_alpha/medical-documents/doc_101.pdf",
      } as any);

      vi.mocked(getSignedStorageUrl).mockResolvedValueOnce({
        url: "https://storage.supabase.co/signed/pat_alpha/doc_101.pdf?token=xyz",
        expiresIn: 600,
      });

      const req = new NextRequest(
        `http://localhost:3000/api/doctors/me/patients/${patientAId}/medical-documents/doc_101/access`
      );
      const res = await GET_DOCUMENT_ACCESS(req, {
        params: Promise.resolve({ patientId: patientAId, documentId: "doc_101" }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();

      expect(data.url).toContain("https://storage.supabase.co/signed/");
      expect(data.expiresIn).toBe(600);
      expect(data.document.id).toBe("doc_101");
      // Backend calls Search Sphere with verified storagePath
      expect(getSignedStorageUrl).toHaveBeenCalledWith(
        "patients/pat_alpha/medical-documents/doc_101.pdf",
        600
      );

      // Verify AccessLog with MEDICAL_DOCUMENT_VIEW action
      expect(logAccess).toHaveBeenCalledWith(
        doctorAUser.id,
        "doc_101",
        "MEDICAL_DOCUMENT_VIEW",
        "MEDICAL_RECORD"
      );
    });

    it("logs MEDICAL_DOCUMENT_DOWNLOAD when action=download is requested", async () => {
      vi.mocked(getAuthenticatedUser).mockResolvedValueOnce(doctorAUser as any);
      vi.mocked(prisma.doctor.findUnique).mockResolvedValueOnce(doctorAProfile as any);
      vi.mocked(prisma.appointment.findFirst).mockResolvedValueOnce({
        id: "appt_conf_1",
        status: AppointmentStatus.CONFIRMED,
      } as any);

      vi.mocked(prisma.medicalDocument.findFirst).mockResolvedValueOnce({
        id: "doc_101",
        patientId: patientAId,
        title: "Complete Blood Count",
        fileName: "cbc_report.pdf",
        mimeType: "application/pdf",
        fileSize: 102400,
        storagePath: "patients/pat_alpha/medical-documents/doc_101.pdf",
      } as any);

      vi.mocked(getSignedStorageUrl).mockResolvedValueOnce({
        url: "https://storage.supabase.co/signed/pat_alpha/doc_101.pdf?token=xyz",
        expiresIn: 600,
      });

      const req = new NextRequest(
        `http://localhost:3000/api/doctors/me/patients/${patientAId}/medical-documents/doc_101/access?action=download`
      );
      const res = await GET_DOCUMENT_ACCESS(req, {
        params: Promise.resolve({ patientId: patientAId, documentId: "doc_101" }),
      });

      expect(res.status).toBe(200);
      expect(logAccess).toHaveBeenCalledWith(
        doctorAUser.id,
        "doc_101",
        "MEDICAL_DOCUMENT_DOWNLOAD",
        "MEDICAL_RECORD"
      );
    });

    it("PART 16: Cross-patient document ID test (IDOR defense) - Doctor A accesses Patient A route with Document B belonging to Patient B", async () => {
      vi.mocked(getAuthenticatedUser).mockResolvedValueOnce(doctorAUser as any);
      vi.mocked(prisma.doctor.findUnique).mockResolvedValueOnce(doctorAProfile as any);
      // Doctor A is authorized for Patient A
      vi.mocked(prisma.appointment.findFirst).mockResolvedValueOnce({
        id: "appt_conf_1",
        status: AppointmentStatus.CONFIRMED,
      } as any);

      // But doc_202 belongs to Patient B, so findFirst with { id: "doc_202", patientId: patientAId } returns null
      vi.mocked(prisma.medicalDocument.findFirst).mockResolvedValueOnce(null);

      const req = new NextRequest(
        `http://localhost:3000/api/doctors/me/patients/${patientAId}/medical-documents/doc_202/access`
      );
      const res = await GET_DOCUMENT_ACCESS(req, {
        params: Promise.resolve({ patientId: patientAId, documentId: "doc_202" }),
      });

      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error).toContain("Medical document not found or access denied");

      // Verify signed URL was never generated
      expect(getSignedStorageUrl).not.toHaveBeenCalled();

      // Verify security audit log was created
      expect(logAudit).toHaveBeenCalledWith(
        doctorAUser.id,
        "MEDICAL_DOCUMENT_ACCESS_DENIED",
        expect.objectContaining({
          patientId: patientAId,
          documentId: "doc_202",
          reason: "DOCUMENT_NOT_FOUND_OR_PATIENT_MISMATCH",
        }),
        "MEDICAL_RECORD"
      );
    });

    it("returns 502 if Search Sphere fails to generate signed URL", async () => {
      vi.mocked(getAuthenticatedUser).mockResolvedValueOnce(doctorAUser as any);
      vi.mocked(prisma.doctor.findUnique).mockResolvedValueOnce(doctorAProfile as any);
      vi.mocked(prisma.appointment.findFirst).mockResolvedValueOnce({
        id: "appt_conf_1",
        status: AppointmentStatus.CONFIRMED,
      } as any);

      vi.mocked(prisma.medicalDocument.findFirst).mockResolvedValueOnce({
        id: "doc_101",
        patientId: patientAId,
        title: "Complete Blood Count",
        storagePath: "patients/pat_alpha/medical-documents/doc_101.pdf",
      } as any);

      vi.mocked(getSignedStorageUrl).mockRejectedValueOnce(new Error("Search Sphere timeout"));

      const req = new NextRequest(
        `http://localhost:3000/api/doctors/me/patients/${patientAId}/medical-documents/doc_101/access`
      );
      const res = await GET_DOCUMENT_ACCESS(req, {
        params: Promise.resolve({ patientId: patientAId, documentId: "doc_101" }),
      });

      expect(res.status).toBe(502);
      const data = await res.json();
      expect(data.error).toContain("Failed to generate temporary document access link");
    });
  });
});
