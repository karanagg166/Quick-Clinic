import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { POST, GET } from "@/app/api/patients/me/medical-documents/route";
import {
  GET as GET_DOC,
  PATCH as PATCH_DOC,
  DELETE as DELETE_DOC,
} from "@/app/api/patients/me/medical-documents/[documentId]/route";
import { GET as GET_ACCESS } from "@/app/api/patients/me/medical-documents/[documentId]/access/route";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser } from "@/lib/auth";
import * as storageClient from "@/lib/search-sphere-client";

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
  queueMedicalDocumentIngestion: vi.fn().mockResolvedValue({ documentId: "doc_123", status: "QUEUED" }),
  deleteMedicalDocumentIndex: vi.fn().mockResolvedValue({ success: true, message: "Deleted" }),
  getMedicalDocumentProcessingStatus: vi.fn(),
  retryMedicalDocumentIngestion: vi.fn(),
}));

vi.mock("@/lib/logger", () => ({
  logAudit: vi.fn().mockResolvedValue(undefined),
}));

describe("Patient Medical Documents Backend API Suite", () => {
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
    processingStatus: "QUEUED",
    processingError: null,
    processedAt: null,
    createdAt: new Date("2026-09-16T10:00:00.000Z"),
    updatedAt: new Date("2026-09-16T10:00:00.000Z"),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("1. Authentication & Role Authorization", () => {
    it("POST /api/patients/me/medical-documents returns 401 when unauthenticated", async () => {
      vi.mocked(getAuthenticatedUser).mockResolvedValueOnce(null);

      const formData = new FormData();
      const req = new NextRequest("http://localhost:3000/api/patients/me/medical-documents", {
        method: "POST",
        body: formData,
      });

      const res = await POST(req);
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.error).toBe("Authentication required");
    });

    it("POST returns 403 when authenticated user has DOCTOR role", async () => {
      vi.mocked(getAuthenticatedUser).mockResolvedValueOnce(mockUserDoctor as any);

      const formData = new FormData();
      const req = new NextRequest("http://localhost:3000/api/patients/me/medical-documents", {
        method: "POST",
        body: formData,
      });

      const res = await POST(req);
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toContain("Access denied. Only patients can manage medical documents.");
    });

    it("POST auto-creates patient profile record if one does not exist yet", async () => {
      vi.mocked(getAuthenticatedUser).mockResolvedValueOnce(mockUserPatientA as any);
      vi.mocked(prisma.patient.findUnique).mockResolvedValueOnce(null);
      vi.mocked(prisma.patient.create).mockResolvedValueOnce({ id: "pat_auto_created" } as any);

      const formData = new FormData();
      const req = new NextRequest("http://localhost:3000/api/patients/me/medical-documents", {
        method: "POST",
        body: formData,
      });

      const res = await POST(req);
      // Validates that it checked patient and auto-created it, then progressed to file validation
      expect(res.status).toBe(400);
      expect(prisma.patient.create).toHaveBeenCalledWith({
        data: { userId: mockUserPatientA.id },
        select: { id: true },
      });
    });

    it("GET returns empty array when patient record does not exist yet", async () => {
      vi.mocked(getAuthenticatedUser).mockResolvedValueOnce(mockUserPatientA as any);
      vi.mocked(prisma.patient.findUnique).mockResolvedValueOnce(null);

      const req = new NextRequest("http://localhost:3000/api/patients/me/medical-documents", {
        method: "GET",
      });

      const res = await GET(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.documents).toEqual([]);
    });
  });

  describe("2. Document Upload (POST /api/patients/me/medical-documents)", () => {
    beforeEach(() => {
      vi.mocked(getAuthenticatedUser).mockResolvedValue(mockUserPatientA as any);
      vi.mocked(prisma.patient.findUnique).mockResolvedValue(mockPatientRecordA as any);
    });

    it("returns 400 when no file is uploaded", async () => {
      const formData = new FormData();
      formData.append("title", "Blood Test");
      formData.append("type", "LAB_REPORT");
      formData.append("reportDate", "2026-09-15");

      const req = new NextRequest("http://localhost:3000/api/patients/me/medical-documents", {
        method: "POST",
        body: formData,
      });

      const res = await POST(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("File is required and must not be empty");
    });

    it("returns 413 when file size exceeds 10MB limit", async () => {
      const formData = new FormData();
      const hugeBlob = new Blob([new Uint8Array(10 * 1024 * 1024 + 10)], {
        type: "application/pdf",
      });
      formData.append("file", hugeBlob, "huge.pdf");
      formData.append("title", "Blood Test");
      formData.append("type", "LAB_REPORT");
      formData.append("reportDate", "2026-09-15");

      const req = new NextRequest("http://localhost:3000/api/patients/me/medical-documents", {
        method: "POST",
        body: formData,
      });

      const res = await POST(req);
      expect(res.status).toBe(413);
      const data = await res.json();
      expect(data.error).toContain("exceeds 10 MB limit");
    });

    it("returns 400 when file type is not allowed (e.g. text/plain or executable)", async () => {
      const formData = new FormData();
      const textBlob = new Blob(["malicious payload"], { type: "text/plain" });
      formData.append("file", textBlob, "script.txt");
      formData.append("title", "Notes");
      formData.append("type", "OTHER");
      formData.append("reportDate", "2026-09-15");

      const req = new NextRequest("http://localhost:3000/api/patients/me/medical-documents", {
        method: "POST",
        body: formData,
      });

      const res = await POST(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("Unsupported file type");
    });

    it("returns 400 when required metadata is missing (e.g. title)", async () => {
      const formData = new FormData();
      const pdfBlob = new Blob(["%PDF-1.4 sample content"], { type: "application/pdf" });
      formData.append("file", pdfBlob, "report.pdf");
      formData.append("type", "LAB_REPORT");
      formData.append("reportDate", "2026-09-15");

      const req = new NextRequest("http://localhost:3000/api/patients/me/medical-documents", {
        method: "POST",
        body: formData,
      });

      const res = await POST(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("Document title is required");
    });

    it("returns 400 when document type is not a valid enum value", async () => {
      const formData = new FormData();
      const pdfBlob = new Blob(["%PDF-1.4 sample content"], { type: "application/pdf" });
      formData.append("file", pdfBlob, "report.pdf");
      formData.append("title", "Report");
      formData.append("type", "INVALID_TYPE_XYZ");
      formData.append("reportDate", "2026-09-15");

      const req = new NextRequest("http://localhost:3000/api/patients/me/medical-documents", {
        method: "POST",
        body: formData,
      });

      const res = await POST(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("Invalid document type");
    });

    it("successfully uploads valid PDF document and stores metadata in Neon", async () => {
      const pdfBlob = new Blob(["%PDF-1.4 valid pdf content"], { type: "application/pdf" });
      const formData = new FormData();
      formData.append("file", pdfBlob, "blood_test.pdf");
      formData.append("title", "Blood Test Results");
      formData.append("type", "LAB_REPORT");
      formData.append("reportDate", "2026-09-15");
      formData.append("hospitalOrDoctor", "Metro Diagnostics");
      formData.append("notes", "Fasting blood sugar test");

      vi.mocked(storageClient.uploadToStorage).mockResolvedValueOnce({
        storagePath: "medical-documents/pat_record_a/generated_doc_id/blood_test.pdf",
        mimeType: "application/pdf",
        fileSize: 26,
      });

      vi.mocked(prisma.medicalDocument.create).mockResolvedValueOnce(sampleDocA as any);
      vi.mocked(prisma.medicalDocument.update).mockResolvedValueOnce(sampleDocA as any);

      const req = new NextRequest("http://localhost:3000/api/patients/me/medical-documents", {
        method: "POST",
        body: formData,
      });

      const res = await POST(req);
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.document.id).toBe("doc_123");
      expect(data.document.title).toBe("Blood Test Results");

      // Verify that uploadToStorage was called with patient.id (pat_record_a), NOT user.id
      expect(storageClient.uploadToStorage).toHaveBeenCalledWith(
        expect.objectContaining({
          patientId: "pat_record_a",
          fileName: "blood_test.pdf",
        })
      );

      // Verify prisma.medicalDocument.create used patient.id
      expect(prisma.medicalDocument.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            patientId: "pat_record_a",
            title: "Blood Test Results",
            type: "LAB_REPORT",
          }),
        })
      );
    });

    it("performs compensation delete in Search Sphere if database insert fails after upload", async () => {
      const pdfBlob = new Blob(["%PDF-1.4 test"], { type: "application/pdf" });
      const formData = new FormData();
      formData.append("file", pdfBlob, "report.pdf");
      formData.append("title", "Failing DB Report");
      formData.append("type", "LAB_REPORT");
      formData.append("reportDate", "2026-09-15");

      vi.mocked(storageClient.uploadToStorage).mockResolvedValueOnce({
        storagePath: "medical-documents/pat_record_a/doc_orphan/report.pdf",
        mimeType: "application/pdf",
        fileSize: 14,
      });

      // DB insert throws an unexpected error
      vi.mocked(prisma.medicalDocument.create).mockRejectedValueOnce(
        new Error("Neon DB connection timeout")
      );

      const req = new NextRequest("http://localhost:3000/api/patients/me/medical-documents", {
        method: "POST",
        body: formData,
      });

      const res = await POST(req);
      expect(res.status).toBe(500);

      // Compensation cleanup MUST have been invoked with the uploaded storage path
      expect(storageClient.deleteFromStorage).toHaveBeenCalledWith(
        "medical-documents/pat_record_a/doc_orphan/report.pdf"
      );
    });
  });

  describe("3. Listing Documents (GET /api/patients/me/medical-documents)", () => {
    beforeEach(() => {
      vi.mocked(getAuthenticatedUser).mockResolvedValue(mockUserPatientA as any);
      vi.mocked(prisma.patient.findUnique).mockResolvedValue(mockPatientRecordA as any);
    });

    it("lists documents strictly scoped to authenticated patient", async () => {
      vi.mocked(prisma.medicalDocument.findMany).mockResolvedValueOnce([sampleDocA] as any);

      const req = new NextRequest("http://localhost:3000/api/patients/me/medical-documents");
      const res = await GET(req);

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.documents).toHaveLength(1);
      expect(data.documents[0].id).toBe("doc_123");

      // Verify scoped query
      expect(prisma.medicalDocument.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            patientId: "pat_record_a",
          }),
        })
      );
    });

    it("applies query filters: search, type, fileType, and sort", async () => {
      vi.mocked(prisma.medicalDocument.findMany).mockResolvedValueOnce([sampleDocA] as any);

      const url =
        "http://localhost:3000/api/patients/me/medical-documents?search=blood&type=LAB_REPORT&fileType=PDF&sort=oldest";
      const req = new NextRequest(url);
      const res = await GET(req);

      expect(res.status).toBe(200);

      // Verify query includes search OR condition, type, mimeType, and orderBy
      expect(prisma.medicalDocument.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            patientId: "pat_record_a",
            type: "LAB_REPORT",
            mimeType: "application/pdf",
            OR: [
              { title: { contains: "blood", mode: "insensitive" } },
              { fileName: { contains: "blood", mode: "insensitive" } },
              { hospitalOrDoctor: { contains: "blood", mode: "insensitive" } },
            ],
          }),
          orderBy: { reportDate: "asc" },
        })
      );
    });
  });

  describe("4. Document Access Signed URL (GET .../[documentId]/access)", () => {
    it("returns short-lived signed URL for document owner", async () => {
      vi.mocked(getAuthenticatedUser).mockResolvedValue(mockUserPatientA as any);
      vi.mocked(prisma.patient.findUnique).mockResolvedValue(mockPatientRecordA as any);
      vi.mocked(prisma.medicalDocument.findUnique).mockResolvedValue(sampleDocA as any);
      vi.mocked(storageClient.getSignedStorageUrl).mockResolvedValueOnce({
        url: "https://supabase.co/storage/v1/object/sign/med-docs/signed-token",
        expiresIn: 600,
      });

      const req = new NextRequest(
        "http://localhost:3000/api/patients/me/medical-documents/doc_123/access"
      );
      const res = await GET_ACCESS(req, { params: Promise.resolve({ documentId: "doc_123" }) });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.url).toBe("https://supabase.co/storage/v1/object/sign/med-docs/signed-token");
      expect(data.expiresIn).toBe(600);
      expect(storageClient.getSignedStorageUrl).toHaveBeenCalledWith(sampleDocA.storagePath, 600);
    });

    it("returns 502 if Search Sphere fails to generate signed URL", async () => {
      vi.mocked(getAuthenticatedUser).mockResolvedValue(mockUserPatientA as any);
      vi.mocked(prisma.patient.findUnique).mockResolvedValue(mockPatientRecordA as any);
      vi.mocked(prisma.medicalDocument.findUnique).mockResolvedValue(sampleDocA as any);
      vi.mocked(storageClient.getSignedStorageUrl).mockRejectedValueOnce(
        new Error("Search Sphere connection refused")
      );

      const req = new NextRequest(
        "http://localhost:3000/api/patients/me/medical-documents/doc_123/access"
      );
      const res = await GET_ACCESS(req, { params: Promise.resolve({ documentId: "doc_123" }) });

      expect(res.status).toBe(502);
      const data = await res.json();
      expect(data.error).toContain("Failed to generate temporary document access link");
    });
  });

  describe("5. Document Metadata Update (PATCH .../[documentId])", () => {
    beforeEach(() => {
      vi.mocked(getAuthenticatedUser).mockResolvedValue(mockUserPatientA as any);
      vi.mocked(prisma.patient.findUnique).mockResolvedValue(mockPatientRecordA as any);
      vi.mocked(prisma.medicalDocument.findUnique).mockResolvedValue(sampleDocA as any);
    });

    it("updates allowed metadata fields (title, notes, hospital)", async () => {
      const updatedDoc = {
        ...sampleDocA,
        title: "Updated Blood Test",
        notes: "Updated fasting notes",
      };
      vi.mocked(prisma.medicalDocument.update).mockResolvedValueOnce(updatedDoc as any);

      const req = new NextRequest(
        "http://localhost:3000/api/patients/me/medical-documents/doc_123",
        {
          method: "PATCH",
          body: JSON.stringify({
            title: "Updated Blood Test",
            notes: "Updated fasting notes",
          }),
        }
      );

      const res = await PATCH_DOC(req, { params: Promise.resolve({ documentId: "doc_123" }) });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.document.title).toBe("Updated Blood Test");
      expect(prisma.medicalDocument.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "doc_123" },
          data: expect.objectContaining({
            title: "Updated Blood Test",
            notes: "Updated fasting notes",
          }),
        })
      );
    });

    it("rejects attempt to tamper with immutable fields (patientId or storagePath)", async () => {
      const req = new NextRequest(
        "http://localhost:3000/api/patients/me/medical-documents/doc_123",
        {
          method: "PATCH",
          body: JSON.stringify({
            patientId: "pat_record_attacker",
          }),
        }
      );

      const res = await PATCH_DOC(req, { params: Promise.resolve({ documentId: "doc_123" }) });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("Modifying patientId is not permitted");
    });
  });

  describe("6. Document Deletion (DELETE .../[documentId])", () => {
    beforeEach(() => {
      vi.mocked(getAuthenticatedUser).mockResolvedValue(mockUserPatientA as any);
      vi.mocked(prisma.patient.findUnique).mockResolvedValue(mockPatientRecordA as any);
      vi.mocked(prisma.medicalDocument.findUnique).mockResolvedValue(sampleDocA as any);
    });

    it("deletes from Search Sphere storage and deletes database record", async () => {
      vi.mocked(storageClient.deleteFromStorage).mockResolvedValueOnce({
        success: true,
        message: "Deleted",
      });
      vi.mocked(prisma.medicalDocument.delete).mockResolvedValueOnce(sampleDocA as any);

      const req = new NextRequest(
        "http://localhost:3000/api/patients/me/medical-documents/doc_123",
        { method: "DELETE" }
      );

      const res = await DELETE_DOC(req, { params: Promise.resolve({ documentId: "doc_123" }) });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);

      expect(storageClient.deleteFromStorage).toHaveBeenCalledWith(sampleDocA.storagePath);
      expect(prisma.medicalDocument.delete).toHaveBeenCalledWith({
        where: { id: "doc_123" },
      });
    });

    it("returns 502 and does NOT delete database record if storage deletion fails", async () => {
      vi.mocked(storageClient.deleteFromStorage).mockRejectedValueOnce(
        new Error("Search Sphere storage unreachable")
      );

      const req = new NextRequest(
        "http://localhost:3000/api/patients/me/medical-documents/doc_123",
        { method: "DELETE" }
      );

      const res = await DELETE_DOC(req, { params: Promise.resolve({ documentId: "doc_123" }) });
      expect(res.status).toBe(502);
      const data = await res.json();
      expect(data.error).toContain("Failed to delete document from object storage");

      // Verify DB record is NOT deleted when physical storage deletion fails
      expect(prisma.medicalDocument.delete).not.toHaveBeenCalled();
    });
  });

  describe("7. Strict IDOR Security Suite (Patient A vs Patient B)", () => {
    beforeEach(() => {
      // Authenticate as Patient B
      vi.mocked(getAuthenticatedUser).mockResolvedValue(mockUserPatientB as any);
      vi.mocked(prisma.patient.findUnique).mockResolvedValue(mockPatientRecordB as any);
      // Document belongs to Patient A
      vi.mocked(prisma.medicalDocument.findUnique).mockResolvedValue(sampleDocA as any);
    });

    it("prevents Patient B from viewing Patient A's document metadata (GET)", async () => {
      const req = new NextRequest(
        "http://localhost:3000/api/patients/me/medical-documents/doc_123"
      );
      const res = await GET_DOC(req, { params: Promise.resolve({ documentId: "doc_123" }) });

      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error).toContain("Medical document not found or access denied");
    });

    it("prevents Patient B from accessing Patient A's signed URL (/access)", async () => {
      const req = new NextRequest(
        "http://localhost:3000/api/patients/me/medical-documents/doc_123/access"
      );
      const res = await GET_ACCESS(req, { params: Promise.resolve({ documentId: "doc_123" }) });

      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error).toContain("Medical document not found or access denied");
      expect(storageClient.getSignedStorageUrl).not.toHaveBeenCalled();
    });

    it("prevents Patient B from modifying Patient A's document metadata (PATCH)", async () => {
      const req = new NextRequest(
        "http://localhost:3000/api/patients/me/medical-documents/doc_123",
        {
          method: "PATCH",
          body: JSON.stringify({ title: "Attacker Malicious Rename" }),
        }
      );
      const res = await PATCH_DOC(req, { params: Promise.resolve({ documentId: "doc_123" }) });

      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error).toContain("Medical document not found or access denied");
      expect(prisma.medicalDocument.update).not.toHaveBeenCalled();
    });

    it("prevents Patient B from deleting Patient A's document (DELETE)", async () => {
      const req = new NextRequest(
        "http://localhost:3000/api/patients/me/medical-documents/doc_123",
        { method: "DELETE" }
      );
      const res = await DELETE_DOC(req, { params: Promise.resolve({ documentId: "doc_123" }) });

      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error).toContain("Medical document not found or access denied");
      expect(storageClient.deleteFromStorage).not.toHaveBeenCalled();
      expect(prisma.medicalDocument.delete).not.toHaveBeenCalled();
    });
  });
});
