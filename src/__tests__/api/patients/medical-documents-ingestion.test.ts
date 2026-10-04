import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/patients/me/medical-documents/route";
import { DELETE as DELETE_DOC } from "@/app/api/patients/me/medical-documents/[documentId]/route";
import { GET as GET_STATUS } from "@/app/api/patients/me/medical-documents/[documentId]/processing-status/route";
import { POST as RETRY_PROCESSING } from "@/app/api/patients/me/medical-documents/[documentId]/retry-processing/route";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser } from "@/lib/auth";
import * as searchSphereClient from "@/lib/search-sphere-client";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    patient: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    medicalDocument: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

vi.mock("@/lib/auth", () => ({
  getAuthenticatedUser: vi.fn(),
}));

vi.mock("@/lib/search-sphere-client", () => ({
  uploadToStorage: vi.fn(),
  getSignedStorageUrl: vi.fn(),
  deleteFromStorage: vi.fn(),
  queueMedicalDocumentIngestion: vi.fn(),
  getMedicalDocumentProcessingStatus: vi.fn(),
  deleteMedicalDocumentIndex: vi.fn(),
  retryMedicalDocumentIngestion: vi.fn(),
}));

vi.mock("@/lib/logger", () => ({
  logAudit: vi.fn().mockResolvedValue(undefined),
}));

describe("Patient Medical Document Ingestion & Status API Suite", () => {
  const mockUserPatientA = { id: "user_pat_a", role: "PATIENT", email: "pat_a@example.com" };
  const mockUserPatientB = { id: "user_pat_b", role: "PATIENT", email: "pat_b@example.com" };
  const mockUserDoctor = { id: "user_doc_1", role: "DOCTOR", email: "doc@example.com" };

  const mockPatientRecordA = { id: "pat_record_a", userId: "user_pat_a" };
  const mockPatientRecordB = { id: "pat_record_b", userId: "user_pat_b" };

  const sampleDocA = {
    id: "doc_123",
    patientId: "pat_record_a",
    title: "Blood Test Results",
    type: "LAB_REPORT",
    fileName: "blood_test.pdf",
    mimeType: "application/pdf",
    fileSize: 1024 * 100,
    storagePath: "medical-documents/pat_record_a/doc_123/blood_test.pdf",
    reportDate: new Date("2026-09-15T00:00:00.000Z"),
    hospitalOrDoctor: "Metro Diagnostics",
    notes: "Fasting blood sugar test",
    processingStatus: "PENDING",
    processingError: null,
    processedAt: null,
    createdAt: new Date("2026-09-16T10:00:00.000Z"),
    updatedAt: new Date("2026-09-16T10:00:00.000Z"),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("1. Upload and Ingestion Trigger Flow", () => {
    it("successfully uploads to storage, saves metadata, and enqueues ingestion to QUEUED status", async () => {
      vi.mocked(getAuthenticatedUser).mockResolvedValueOnce(mockUserPatientA as any);
      vi.mocked(prisma.patient.findUnique).mockResolvedValueOnce(mockPatientRecordA as any);

      vi.mocked(searchSphereClient.uploadToStorage).mockResolvedValueOnce({
        storagePath: "medical-documents/pat_record_a/doc_123/blood_test.pdf",
        mimeType: "application/pdf",
        fileSize: 1024,
      });

      vi.mocked(prisma.medicalDocument.create).mockResolvedValueOnce(sampleDocA as any);
      vi.mocked(searchSphereClient.queueMedicalDocumentIngestion).mockResolvedValueOnce({
        documentId: "doc_123",
        status: "QUEUED",
      });

      const queuedDoc = { ...sampleDocA, processingStatus: "QUEUED" };
      vi.mocked(prisma.medicalDocument.update).mockResolvedValueOnce(queuedDoc as any);

      const formData = new FormData();
      const pdfBlob = new Blob([new Uint8Array([37, 80, 68, 70])], { type: "application/pdf" });
      formData.append("file", pdfBlob, "blood_test.pdf");
      formData.append("title", "Blood Test Results");
      formData.append("type", "LAB_REPORT");
      formData.append("reportDate", "2026-09-15");

      const req = new NextRequest("http://localhost:3000/api/patients/me/medical-documents", {
        method: "POST",
        body: formData,
      });

      const res = await POST(req);
      expect(res.status).toBe(201);
      const data = await res.json();

      expect(data.document.processingStatus).toBe("QUEUED");
      expect(searchSphereClient.queueMedicalDocumentIngestion).toHaveBeenCalledWith(
        expect.objectContaining({
          documentId: expect.any(String),
          patientId: "pat_record_a",
          fileName: "blood_test.pdf",
          mimeType: "application/pdf",
          documentType: "LAB_REPORT",
        })
      );
    });

    it("if ingestion queue fails, preserves document in Neon and sets status to FAILED (does not delete document)", async () => {
      vi.mocked(getAuthenticatedUser).mockResolvedValueOnce(mockUserPatientA as any);
      vi.mocked(prisma.patient.findUnique).mockResolvedValueOnce(mockPatientRecordA as any);

      vi.mocked(searchSphereClient.uploadToStorage).mockResolvedValueOnce({
        storagePath: "medical-documents/pat_record_a/doc_123/blood_test.pdf",
        mimeType: "application/pdf",
        fileSize: 1024,
      });

      vi.mocked(prisma.medicalDocument.create).mockResolvedValueOnce(sampleDocA as any);
      vi.mocked(searchSphereClient.queueMedicalDocumentIngestion).mockRejectedValueOnce(
        new Error("Search Sphere ingestion service unavailable")
      );

      const failedDoc = {
        ...sampleDocA,
        processingStatus: "FAILED",
        processingError: "Search Sphere ingestion service unavailable",
      };
      vi.mocked(prisma.medicalDocument.update).mockResolvedValueOnce(failedDoc as any);

      const formData = new FormData();
      const pdfBlob = new Blob([new Uint8Array([37, 80, 68, 70])], { type: "application/pdf" });
      formData.append("file", pdfBlob, "blood_test.pdf");
      formData.append("title", "Blood Test Results");
      formData.append("type", "LAB_REPORT");
      formData.append("reportDate", "2026-09-15");

      const req = new NextRequest("http://localhost:3000/api/patients/me/medical-documents", {
        method: "POST",
        body: formData,
      });

      const res = await POST(req);
      expect(res.status).toBe(201);
      const data = await res.json();

      // Document was preserved and returned in FAILED state
      expect(data.document.processingStatus).toBe("FAILED");
      expect(data.document.processingError).toContain("Search Sphere ingestion service unavailable");

      // Verify compensation delete was NOT called (file & DB metadata kept safe)
      expect(searchSphereClient.deleteFromStorage).not.toHaveBeenCalled();
      expect(prisma.medicalDocument.delete).not.toHaveBeenCalled();
    });
  });

  describe("2. Processing Status Endpoint (GET .../processing-status)", () => {
    it("returns 401 when unauthenticated", async () => {
      vi.mocked(getAuthenticatedUser).mockResolvedValueOnce(null);

      const req = new NextRequest("http://localhost:3000/api/patients/me/medical-documents/doc_123/processing-status");
      const res = await GET_STATUS(req, { params: Promise.resolve({ documentId: "doc_123" }) });

      expect(res.status).toBe(401);
    });

    it("returns 403 when caller is not a patient", async () => {
      vi.mocked(getAuthenticatedUser).mockResolvedValueOnce(mockUserDoctor as any);

      const req = new NextRequest("http://localhost:3000/api/patients/me/medical-documents/doc_123/processing-status");
      const res = await GET_STATUS(req, { params: Promise.resolve({ documentId: "doc_123" }) });

      expect(res.status).toBe(403);
    });

    it("prevents IDOR: returns 404 when Patient B attempts to check Patient A's document status", async () => {
      vi.mocked(getAuthenticatedUser).mockResolvedValueOnce(mockUserPatientB as any);
      vi.mocked(prisma.patient.findUnique).mockResolvedValueOnce(mockPatientRecordB as any);
      vi.mocked(prisma.medicalDocument.findUnique).mockResolvedValueOnce(sampleDocA as any);

      const req = new NextRequest("http://localhost:3000/api/patients/me/medical-documents/doc_123/processing-status");
      const res = await GET_STATUS(req, { params: Promise.resolve({ documentId: "doc_123" }) });

      expect(res.status).toBe(404);
      expect(searchSphereClient.getMedicalDocumentProcessingStatus).not.toHaveBeenCalled();
    });

    it("returns live processing status for the document owner and updates Neon DB when status changed", async () => {
      vi.mocked(getAuthenticatedUser).mockResolvedValueOnce(mockUserPatientA as any);
      vi.mocked(prisma.patient.findUnique).mockResolvedValueOnce(mockPatientRecordA as any);
      vi.mocked(prisma.medicalDocument.findUnique).mockResolvedValueOnce(sampleDocA as any);

      vi.mocked(searchSphereClient.getMedicalDocumentProcessingStatus).mockResolvedValueOnce({
        documentId: "doc_123",
        status: "READY",
        processedAt: "2026-10-04T05:00:00.000Z",
        error: null,
      });

      const req = new NextRequest("http://localhost:3000/api/patients/me/medical-documents/doc_123/processing-status");
      const res = await GET_STATUS(req, { params: Promise.resolve({ documentId: "doc_123" }) });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.documentId).toBe("doc_123");
      expect(data.status).toBe("READY");

      // Verify Neon DB sync
      expect(prisma.medicalDocument.update).toHaveBeenCalledWith({
        where: { id: "doc_123" },
        data: expect.objectContaining({
          processingStatus: "READY",
          processingError: null,
        }),
      });
    });
  });

  describe("3. Retry Processing Endpoint (POST .../retry-processing)", () => {
    it("returns 401 when unauthenticated", async () => {
      vi.mocked(getAuthenticatedUser).mockResolvedValueOnce(null);

      const req = new NextRequest("http://localhost:3000/api/patients/me/medical-documents/doc_123/retry-processing", {
        method: "POST",
      });
      const res = await RETRY_PROCESSING(req, { params: Promise.resolve({ documentId: "doc_123" }) });

      expect(res.status).toBe(401);
    });

    it("prevents IDOR: returns 404 when Patient B attempts to retry Patient A's document", async () => {
      vi.mocked(getAuthenticatedUser).mockResolvedValueOnce(mockUserPatientB as any);
      vi.mocked(prisma.patient.findUnique).mockResolvedValueOnce(mockPatientRecordB as any);
      vi.mocked(prisma.medicalDocument.findUnique).mockResolvedValueOnce(sampleDocA as any);

      const req = new NextRequest("http://localhost:3000/api/patients/me/medical-documents/doc_123/retry-processing", {
        method: "POST",
      });
      const res = await RETRY_PROCESSING(req, { params: Promise.resolve({ documentId: "doc_123" }) });

      expect(res.status).toBe(404);
      expect(searchSphereClient.retryMedicalDocumentIngestion).not.toHaveBeenCalled();
    });

    it("allows owning patient to retry processing: calls Search Sphere and updates status to QUEUED", async () => {
      vi.mocked(getAuthenticatedUser).mockResolvedValueOnce(mockUserPatientA as any);
      vi.mocked(prisma.patient.findUnique).mockResolvedValueOnce(mockPatientRecordA as any);
      vi.mocked(prisma.medicalDocument.findUnique).mockResolvedValueOnce({
        ...sampleDocA,
        processingStatus: "FAILED",
        processingError: "Temporary timeout",
      } as any);

      vi.mocked(searchSphereClient.retryMedicalDocumentIngestion).mockResolvedValueOnce({
        documentId: "doc_123",
        status: "QUEUED",
      });

      vi.mocked(prisma.medicalDocument.update).mockResolvedValueOnce({
        ...sampleDocA,
        processingStatus: "QUEUED",
        processingError: null,
      } as any);

      const req = new NextRequest("http://localhost:3000/api/patients/me/medical-documents/doc_123/retry-processing", {
        method: "POST",
      });
      const res = await RETRY_PROCESSING(req, { params: Promise.resolve({ documentId: "doc_123" }) });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.status).toBe("QUEUED");

      expect(searchSphereClient.retryMedicalDocumentIngestion).toHaveBeenCalledWith(
        expect.objectContaining({
          documentId: "doc_123",
          patientId: "pat_record_a",
        })
      );
      expect(prisma.medicalDocument.update).toHaveBeenCalledWith({
        where: { id: "doc_123" },
        data: {
          processingStatus: "QUEUED",
          processingError: null,
        },
      });
    });
  });

  describe("4. Vector Index Deletion on Document Removal", () => {
    it("deletes vector index from Search Sphere before deleting storage object and database record", async () => {
      vi.mocked(getAuthenticatedUser).mockResolvedValueOnce(mockUserPatientA as any);
      vi.mocked(prisma.patient.findUnique).mockResolvedValueOnce(mockPatientRecordA as any);
      vi.mocked(prisma.medicalDocument.findUnique).mockResolvedValueOnce(sampleDocA as any);

      vi.mocked(searchSphereClient.deleteMedicalDocumentIndex).mockResolvedValueOnce({
        success: true,
        message: "Index deleted",
      });
      vi.mocked(searchSphereClient.deleteFromStorage).mockResolvedValueOnce({
        success: true,
        message: "File deleted",
      });
      vi.mocked(prisma.medicalDocument.delete).mockResolvedValueOnce(sampleDocA as any);

      const req = new NextRequest("http://localhost:3000/api/patients/me/medical-documents/doc_123", {
        method: "DELETE",
      });
      const res = await DELETE_DOC(req, { params: Promise.resolve({ documentId: "doc_123" }) });

      expect(res.status).toBe(200);
      expect(searchSphereClient.deleteMedicalDocumentIndex).toHaveBeenCalledWith("doc_123");
      expect(searchSphereClient.deleteFromStorage).toHaveBeenCalledWith(sampleDocA.storagePath);
      expect(prisma.medicalDocument.delete).toHaveBeenCalledWith({ where: { id: "doc_123" } });
    });
  });
});
