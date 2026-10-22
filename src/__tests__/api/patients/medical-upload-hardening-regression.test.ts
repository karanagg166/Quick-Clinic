import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/patients/me/medical-documents/route";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser } from "@/lib/auth";
import * as storageClient from "@/lib/search-sphere-client";
import { clearInMemoryRateLimits } from "@/lib/rate-limiter";
import { clearInMemoryDocumentGuards } from "@/lib/medical-document-validator";
import fs from "fs";
import path from "path";

const FIXTURES_DIR = path.resolve(__dirname, "../../fixtures");
function getFixture(name: string): Buffer {
  const fixturePath = path.join(FIXTURES_DIR, name);
  if (!fs.existsSync(fixturePath)) {
    throw new Error(`Required test fixture not found: ${fixturePath}`);
  }
  return fs.readFileSync(fixturePath);
}

vi.mock("@/lib/prisma", () => ({
  prisma: {
    patient: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    medicalDocument: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

vi.mock("@/lib/auth", () => ({
  getAuthenticatedUser: vi.fn(),
}));

vi.mock("@/lib/search-sphere-client", async (importOriginal) => {
  const actual = await importOriginal<typeof storageClient>();
  return {
    ...actual,
    uploadToStorage: vi.fn(),
    getSignedStorageUrl: vi.fn(),
    deleteFromStorage: vi.fn(),
    queueMedicalDocumentIngestion: vi.fn(),
    deleteMedicalDocumentIndex: vi.fn(),
    getMedicalDocumentProcessingStatus: vi.fn(),
    retryMedicalDocumentIngestion: vi.fn(),
  };
});

vi.mock("@/lib/logger", () => ({
  logAudit: vi.fn().mockResolvedValue(undefined),
  logAccess: vi.fn().mockResolvedValue(undefined),
}));

describe("A3. Medical Document Upload Hardening & Adversarial Regression Suite", () => {
  const mockPatientUser = { id: "user_patient_1", role: "PATIENT", email: "patient1@example.com" };
  const mockDoctorUser = { id: "user_doctor_1", role: "DOCTOR", email: "doctor1@example.com" };
  const mockPatientRecord = { id: "pat_rec_001", userId: "user_patient_1" };

  // Deterministic file fixture byte providers using real structural test assets
  const createPdfBytes = () => getFixture("one_page_digital.pdf");
  const createLabReportPdfBytes = () => getFixture("lab_report_units.pdf");
  const createMedicalDatesPdfBytes = () => getFixture("medical_report_multiple_dates.pdf");
  const createTablePdfBytes = () => getFixture("tables.pdf");
  const createJpegBytes = () => Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
  const createPngBytes = () => Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
  const createWebpBytes = () => Buffer.from([
    0x52, 0x49, 0x46, 0x46, // "RIFF"
    0x24, 0x00, 0x00, 0x00, // file size
    0x57, 0x45, 0x42, 0x50, // "WEBP"
    0x56, 0x50, 0x38, 0x20, // "VP8 "
  ]);
  const createExeBytes = () => getFixture("renamed_pe.pdf"); // "MZ" DOS/PE executable
  const createElfBytes = () => getFixture("renamed_elf.pdf"); // ELF executable
  const createShellScriptBytes = () => Buffer.from("#!/bin/bash\nrm -rf / --no-preserve-root\n");
  const createZipBytes = () => getFixture("renamed_zip.pdf"); // PK zip archive

  function buildUploadForm(params: {
    fileBytes?: Buffer;
    fileName?: string;
    mimeType?: string;
    title?: string;
    type?: string;
    reportDate?: string;
    hospitalOrDoctor?: string;
    notes?: string;
    idempotencyKey?: string;
  }): FormData {
    const form = new FormData();
    if (params.fileBytes !== undefined) {
      const blob = new Blob([params.fileBytes], { type: params.mimeType ?? "application/pdf" });
      form.append("file", blob, params.fileName ?? "report.pdf");
    }
    if (params.title !== undefined) form.append("title", params.title);
    if (params.type !== undefined) form.append("type", params.type);
    if (params.reportDate !== undefined) form.append("reportDate", params.reportDate);
    if (params.hospitalOrDoctor !== undefined) form.append("hospitalOrDoctor", params.hospitalOrDoctor);
    if (params.notes !== undefined) form.append("notes", params.notes);
    if (params.idempotencyKey !== undefined) form.append("idempotencyKey", params.idempotencyKey);
    return form;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    clearInMemoryRateLimits();
    clearInMemoryDocumentGuards();
    vi.mocked(getAuthenticatedUser).mockResolvedValue(mockPatientUser as any);
    vi.mocked(prisma.patient.findUnique).mockResolvedValue(mockPatientRecord as any);
    vi.mocked(prisma.medicalDocument.findMany).mockResolvedValue([]);
    vi.mocked(prisma.medicalDocument.findFirst).mockResolvedValue(null);
  });

  describe("1. Binary File Signature & Format Defense", () => {
    it("successfully validates and uploads small valid PDF", async () => {
      const form = buildUploadForm({
        fileBytes: createPdfBytes(),
        fileName: "lab_report.pdf",
        mimeType: "application/pdf",
        title: "Complete Blood Count",
        type: "LAB_REPORT",
        reportDate: "2026-10-01",
      });

      vi.mocked(storageClient.uploadToStorage).mockResolvedValueOnce({
        storagePath: "medical-documents/pat_rec_001/doc_abc/lab_report.pdf",
        mimeType: "application/pdf",
        fileSize: 100,
      });

      vi.mocked(prisma.medicalDocument.create).mockResolvedValueOnce({
        id: "doc_abc",
        patientId: "pat_rec_001",
        title: "Complete Blood Count",
        type: "LAB_REPORT",
        fileName: "lab_report.pdf",
        mimeType: "application/pdf",
        fileSize: 100,
        storagePath: "medical-documents/pat_rec_001/doc_abc/lab_report.pdf",
        processingStatus: "PENDING",
      } as any);

      const req = new NextRequest("http://localhost:3000/api/patients/me/medical-documents", {
        method: "POST",
        body: form,
      });

      const res = await POST(req);
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.document.id).toBe("doc_abc");
      expect(data.requestId).toBeDefined();
    });

    it("successfully validates and uploads valid JPEG image", async () => {
      const form = buildUploadForm({
        fileBytes: createJpegBytes(),
        fileName: "xray.jpg",
        mimeType: "image/jpeg",
        title: "Chest X-Ray",
        type: "RADIOLOGY_SCAN",
        reportDate: "2026-10-02",
      });

      vi.mocked(storageClient.uploadToStorage).mockResolvedValueOnce({
        storagePath: "medical-documents/pat_rec_001/doc_j/xray.jpg",
        mimeType: "image/jpeg",
        fileSize: 12,
      });

      vi.mocked(prisma.medicalDocument.create).mockResolvedValueOnce({
        id: "doc_j",
        title: "Chest X-Ray",
        type: "RADIOLOGY_SCAN",
      } as any);

      const req = new NextRequest("http://localhost:3000/api/patients/me/medical-documents", {
        method: "POST",
        body: form,
      });

      const res = await POST(req);
      expect(res.status).toBe(201);
    });

    it("successfully validates and uploads valid PNG image", async () => {
      const form = buildUploadForm({
        fileBytes: createPngBytes(),
        fileName: "mri.png",
        mimeType: "image/png",
        title: "Brain MRI",
        type: "RADIOLOGY_SCAN",
        reportDate: "2026-10-02",
      });

      vi.mocked(storageClient.uploadToStorage).mockResolvedValueOnce({
        storagePath: "medical-documents/pat_rec_001/doc_png/mri.png",
        mimeType: "image/png",
        fileSize: 12,
      });

      vi.mocked(prisma.medicalDocument.create).mockResolvedValueOnce({
        id: "doc_png",
        title: "Brain MRI",
      } as any);

      const req = new NextRequest("http://localhost:3000/api/patients/me/medical-documents", {
        method: "POST",
        body: form,
      });

      const res = await POST(req);
      expect(res.status).toBe(201);
    });

    it("successfully validates and uploads valid WebP image", async () => {
      const form = buildUploadForm({
        fileBytes: createWebpBytes(),
        fileName: "scan.webp",
        mimeType: "image/webp",
        title: "Ultrasound Scan",
        type: "RADIOLOGY_SCAN",
        reportDate: "2026-10-02",
      });

      vi.mocked(storageClient.uploadToStorage).mockResolvedValueOnce({
        storagePath: "medical-documents/pat_rec_001/doc_w/scan.webp",
        mimeType: "image/webp",
        fileSize: 16,
      });

      vi.mocked(prisma.medicalDocument.create).mockResolvedValueOnce({
        id: "doc_w",
        title: "Ultrasound Scan",
      } as any);

      const req = new NextRequest("http://localhost:3000/api/patients/me/medical-documents", {
        method: "POST",
        body: form,
      });

      const res = await POST(req);
      expect(res.status).toBe(201);
    });

    it("rejects empty file (0 bytes) with 400 EMPTY_FILE", async () => {
      const form = buildUploadForm({
        fileBytes: Buffer.alloc(0),
        fileName: "empty.pdf",
        title: "Empty Report",
        type: "LAB_REPORT",
        reportDate: "2026-10-01",
      });

      const req = new NextRequest("http://localhost:3000/api/patients/me/medical-documents", {
        method: "POST",
        body: form,
      });

      const res = await POST(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.code).toBe("EMPTY_FILE");
      expect(data.retryable).toBe(false);
    });

    it("rejects renamed Windows PE executable disguised as PDF (MZ header)", async () => {
      const form = buildUploadForm({
        fileBytes: createExeBytes(),
        fileName: "malicious_report.pdf",
        mimeType: "application/pdf",
        title: "Trojan disguised as PDF",
        type: "LAB_REPORT",
        reportDate: "2026-10-01",
      });

      const req = new NextRequest("http://localhost:3000/api/patients/me/medical-documents", {
        method: "POST",
        body: form,
      });

      const res = await POST(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.code).toBe("MALICIOUS_FILE_CONTENT");
      expect(data.error).toContain("Executable files are strictly forbidden");
      expect(storageClient.uploadToStorage).not.toHaveBeenCalled();
    });

    it("rejects renamed Linux ELF binary disguised as PNG", async () => {
      const form = buildUploadForm({
        fileBytes: createElfBytes(),
        fileName: "rootkit.png",
        mimeType: "image/png",
        title: "Fake PNG",
        type: "LAB_REPORT",
        reportDate: "2026-10-01",
      });

      const req = new NextRequest("http://localhost:3000/api/patients/me/medical-documents", {
        method: "POST",
        body: form,
      });

      const res = await POST(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.code).toBe("MALICIOUS_FILE_CONTENT");
    });

    it("rejects renamed shell script disguised as PDF (#!/bin/bash header)", async () => {
      const form = buildUploadForm({
        fileBytes: createShellScriptBytes(),
        fileName: "exploit.pdf",
        mimeType: "application/pdf",
        title: "Script Exploit",
        type: "OTHER",
        reportDate: "2026-10-01",
      });

      const req = new NextRequest("http://localhost:3000/api/patients/me/medical-documents", {
        method: "POST",
        body: form,
      });

      const res = await POST(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.code).toBe("MALICIOUS_FILE_CONTENT");
    });

    it("rejects ZIP archive disguised as PDF (PK.. header)", async () => {
      const form = buildUploadForm({
        fileBytes: createZipBytes(),
        fileName: "archive.pdf",
        mimeType: "application/pdf",
        title: "ZIP Bomb",
        type: "LAB_REPORT",
        reportDate: "2026-10-01",
      });

      const req = new NextRequest("http://localhost:3000/api/patients/me/medical-documents", {
        method: "POST",
        body: form,
      });

      const res = await POST(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.code).toBe("UNSUPPORTED_FORMAT");
    });

    it("rejects MIME mismatch (reported as application/pdf but actual bytes are JPEG)", async () => {
      const form = buildUploadForm({
        fileBytes: createJpegBytes(),
        fileName: "fake.pdf",
        mimeType: "application/pdf",
        title: "Mismatched MIME",
        type: "LAB_REPORT",
        reportDate: "2026-10-01",
      });

      const req = new NextRequest("http://localhost:3000/api/patients/me/medical-documents", {
        method: "POST",
        body: form,
      });

      const res = await POST(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.code).toBe("FILE_SIGNATURE_MISMATCH");
      expect(data.error).toContain("File signature mismatch");
    });
  });

  describe("2. Path Traversal & Filename Sanitization", () => {
    it("sanitizes path traversal in filename (../../etc/passwd.pdf)", async () => {
      const form = buildUploadForm({
        fileBytes: createPdfBytes(),
        fileName: "../../etc/passwd.pdf",
        mimeType: "application/pdf",
        title: "Path Traversal Test",
        type: "LAB_REPORT",
        reportDate: "2026-10-01",
      });

      vi.mocked(storageClient.uploadToStorage).mockResolvedValueOnce({
        storagePath: "medical-documents/pat_rec_001/doc_id/passwd.pdf",
        mimeType: "application/pdf",
        fileSize: 100,
      });

      vi.mocked(prisma.medicalDocument.create).mockResolvedValueOnce({
        id: "doc_id",
        fileName: "passwd.pdf",
      } as any);

      const req = new NextRequest("http://localhost:3000/api/patients/me/medical-documents", {
        method: "POST",
        body: form,
      });

      const res = await POST(req);
      expect(res.status).toBe(201);
      expect(storageClient.uploadToStorage).toHaveBeenCalledWith(
        expect.objectContaining({
          fileName: "passwd.pdf", // traversal removed
        })
      );
    });

    it("sanitizes null bytes and Windows backslashes in filename", async () => {
      const form = buildUploadForm({
        fileBytes: createPdfBytes(),
        fileName: "C:\\Windows\\System32\\test\0.pdf",
        mimeType: "application/pdf",
        title: "Windows Path Test",
        type: "LAB_REPORT",
        reportDate: "2026-10-01",
      });

      vi.mocked(storageClient.uploadToStorage).mockResolvedValueOnce({
        storagePath: "medical-documents/pat_rec_001/doc_w/test.pdf",
        mimeType: "application/pdf",
        fileSize: 100,
      });

      vi.mocked(prisma.medicalDocument.create).mockResolvedValueOnce({ id: "doc_w" } as any);

      const req = new NextRequest("http://localhost:3000/api/patients/me/medical-documents", {
        method: "POST",
        body: form,
      });

      const res = await POST(req);
      expect(res.status).toBe(201);
      expect(storageClient.uploadToStorage).toHaveBeenCalledWith(
        expect.objectContaining({
          fileName: "test.pdf",
        })
      );
    });
  });

  describe("3. Upstream Failure Modes & User-Facing Error Mapping", () => {
    it("handles Search-Sphere 502/503 by returning structured 502/503 STORAGE_UNAVAILABLE with retryable: true", async () => {
      const form = buildUploadForm({
        fileBytes: createPdfBytes(),
        fileName: "report.pdf",
        title: "Downstream Outage",
        type: "LAB_REPORT",
        reportDate: "2026-10-01",
      });

      vi.mocked(storageClient.uploadToStorage).mockRejectedValueOnce(
        new storageClient.SearchSphereUploadError(
          "Upstream storage provider temporarily unavailable.",
          503,
          true,
          "STORAGE_UNAVAILABLE"
        )
      );

      const req = new NextRequest("http://localhost:3000/api/patients/me/medical-documents", {
        method: "POST",
        body: form,
      });

      const res = await POST(req);
      expect(res.status).toBe(503);
      const data = await res.json();
      expect(data.code).toBe("STORAGE_UNAVAILABLE");
      expect(data.retryable).toBe(true);
      expect(data.requestId).toBeDefined();
    });

    it("handles storage network timeout by returning 504 GATEWAY_TIMEOUT with retryable: true", async () => {
      const form = buildUploadForm({
        fileBytes: createPdfBytes(),
        fileName: "report.pdf",
        title: "Timeout Test",
        type: "LAB_REPORT",
        reportDate: "2026-10-01",
      });

      vi.mocked(storageClient.uploadToStorage).mockRejectedValueOnce(
        new storageClient.SearchSphereUploadError(
          "Storage upload request timed out.",
          504,
          true,
          "GATEWAY_TIMEOUT"
        )
      );

      const req = new NextRequest("http://localhost:3000/api/patients/me/medical-documents", {
        method: "POST",
        body: form,
      });

      const res = await POST(req);
      expect(res.status).toBe(504);
      const data = await res.json();
      expect(data.code).toBe("GATEWAY_TIMEOUT");
      expect(data.retryable).toBe(true);
    });

    it("handles unconfigured Search Sphere service with 503 PROCESSING_SERVICE_UNAVAILABLE and retryable: false", async () => {
      const form = buildUploadForm({
        fileBytes: createPdfBytes(),
        fileName: "report.pdf",
        title: "Unconfigured Test",
        type: "LAB_REPORT",
        reportDate: "2026-10-01",
      });

      vi.mocked(storageClient.uploadToStorage).mockRejectedValueOnce(
        new storageClient.SearchSphereConfigError("SEARCH_SPHERE_API_KEY is not configured")
      );

      const req = new NextRequest("http://localhost:3000/api/patients/me/medical-documents", {
        method: "POST",
        body: form,
      });

      const res = await POST(req);
      expect(res.status).toBe(503);
      const data = await res.json();
      expect(data.code).toBe("PROCESSING_SERVICE_UNAVAILABLE");
      expect(data.retryable).toBe(false);
    });
  });

  describe("4. Rate Limiting, Storage Quota & Idempotency", () => {
    it("enforces patient upload rate limiting (rejects 11th upload within window with 429)", async () => {
      vi.mocked(storageClient.uploadToStorage).mockResolvedValue({
        storagePath: "medical-documents/pat_rec_001/doc/report.pdf",
        mimeType: "application/pdf",
        fileSize: 100,
      });
      vi.mocked(prisma.medicalDocument.create).mockResolvedValue({ id: "doc" } as any);

      // Submit 10 uploads (allowed limit)
      for (let i = 0; i < 10; i++) {
        const form = buildUploadForm({
          fileBytes: createPdfBytes(),
          fileName: `report_${i}.pdf`,
          title: `Report ${i}`,
          type: "LAB_REPORT",
          reportDate: "2026-10-01",
        });
        const req = new NextRequest("http://localhost:3000/api/patients/me/medical-documents", {
          method: "POST",
          body: form,
        });
        const res = await POST(req);
        expect(res.status).toBe(201);
      }

      // 11th upload should trigger 429 RATE_LIMIT_EXCEEDED
      const formOverLimit = buildUploadForm({
        fileBytes: createPdfBytes(),
        fileName: "report_11.pdf",
        title: "Report 11",
        type: "LAB_REPORT",
        reportDate: "2026-10-01",
      });
      const reqOverLimit = new NextRequest("http://localhost:3000/api/patients/me/medical-documents", {
        method: "POST",
        body: formOverLimit,
      });
      const resOverLimit = await POST(reqOverLimit);
      expect(resOverLimit.status).toBe(429);
      const data = await resOverLimit.json();
      expect(data.code).toBe("RATE_LIMIT_EXCEEDED");
      expect(data.retryable).toBe(true);
    });

    it("enforces patient document quota limit (rejects when patient reaches 100 documents)", async () => {
      // Mock existing 100 documents in database
      const existing100Docs = Array.from({ length: 100 }, (_, i) => ({ fileSize: 1000 }));
      vi.mocked(prisma.medicalDocument.findMany).mockResolvedValueOnce(existing100Docs as any);

      const form = buildUploadForm({
        fileBytes: createPdfBytes(),
        fileName: "doc101.pdf",
        title: "Doc 101",
        type: "LAB_REPORT",
        reportDate: "2026-10-01",
      });

      const req = new NextRequest("http://localhost:3000/api/patients/me/medical-documents", {
        method: "POST",
        body: form,
      });

      const res = await POST(req);
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.code).toBe("QUOTA_EXCEEDED");
      expect(data.error).toContain("Storage quota exceeded");
    });

    it("enforces patient storage bytes quota limit (rejects when cumulative bytes exceed 100 MB)", async () => {
      // 99.5 MB already used
      const existingDocs = [{ fileSize: 99.5 * 1024 * 1024 }];
      vi.mocked(prisma.medicalDocument.findMany).mockResolvedValueOnce(existingDocs as any);

      // Uploading 1 MB more would push it to 100.5 MB (> 100 MB)
      const oneMbBuffer = Buffer.concat([createPdfBytes(), Buffer.alloc(1024 * 1024)]);
      const form = buildUploadForm({
        fileBytes: oneMbBuffer,
        fileName: "large_report.pdf",
        title: "Large Report",
        type: "LAB_REPORT",
        reportDate: "2026-10-01",
      });

      const req = new NextRequest("http://localhost:3000/api/patients/me/medical-documents", {
        method: "POST",
        body: form,
      });

      const res = await POST(req);
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.code).toBe("QUOTA_EXCEEDED");
      expect(data.error).toContain("100 MB");
    });

    it("enforces FAIL-CLOSED quota policy: returns 503 STORAGE_QUOTA_UNAVAILABLE when quota database check errors", async () => {
      vi.mocked(prisma.medicalDocument.findMany).mockRejectedValueOnce(
        new Error("PostgreSQL connection failure during quota verification")
      );

      const form = buildUploadForm({
        fileBytes: createPdfBytes(),
        fileName: "report.pdf",
        title: "Lab Report",
        type: "LAB_REPORT",
        reportDate: "2026-10-01",
      });

      const req = new NextRequest("http://localhost:3000/api/patients/me/medical-documents", {
        method: "POST",
        body: form,
      });

      const res = await POST(req);
      expect(res.status).toBe(503);
      const data = await res.json();
      expect(data.code).toBe("STORAGE_QUOTA_UNAVAILABLE");
      expect(data.retryable).toBe(true);
      expect(storageClient.uploadToStorage).not.toHaveBeenCalled();
    });

    it("supports idempotent re-upload with identical idempotencyKey and same payload (returns 200 with idempotencyHit: true)", async () => {
      vi.mocked(storageClient.uploadToStorage).mockResolvedValueOnce({
        storagePath: "medical-documents/pat_rec_001/doc_orig/report.pdf",
        mimeType: "application/pdf",
        fileSize: 100,
      });
      vi.mocked(prisma.medicalDocument.create).mockResolvedValueOnce({
        id: "server_gen_uuid_001",
        patientId: "pat_rec_001",
        title: "Blood Test",
        type: "LAB_REPORT",
        fileName: "report.pdf",
        storagePath: "medical-documents/pat_rec_001/doc_orig/report.pdf",
        processingStatus: "PENDING",
        fileSize: 100,
        reportDate: new Date("2026-10-01"),
      } as any);

      const formFirst = buildUploadForm({
        fileBytes: createPdfBytes(),
        fileName: "report.pdf",
        title: "Blood Test",
        type: "LAB_REPORT",
        reportDate: "2026-10-01",
        idempotencyKey: "idem_key_patient_alpha_12345",
      });

      // 1. Initial upload
      const resFirst = await POST(new NextRequest("http://localhost:3000/api/patients/me/medical-documents", {
        method: "POST",
        body: formFirst,
      }));
      expect(resFirst.status).toBe(201);
      const dataFirst = await resFirst.json();
      expect(dataFirst.document.id).toBe("server_gen_uuid_001");

      // 2. Client retry with identical idempotency key and identical payload
      const formRetry = buildUploadForm({
        fileBytes: createPdfBytes(),
        fileName: "report.pdf",
        title: "Blood Test",
        type: "LAB_REPORT",
        reportDate: "2026-10-01",
        idempotencyKey: "idem_key_patient_alpha_12345",
      });

      const resRetry = await POST(new NextRequest("http://localhost:3000/api/patients/me/medical-documents", {
        method: "POST",
        body: formRetry,
      }));
      expect(resRetry.status).toBe(200);
      const dataRetry = await resRetry.json();
      expect(dataRetry.idempotencyHit).toBe(true);
      expect(dataRetry.document.id).toBe("server_gen_uuid_001");
      // Upstream storage and DB create should not be called again
      expect(storageClient.uploadToStorage).toHaveBeenCalledTimes(1);
      expect(prisma.medicalDocument.create).toHaveBeenCalledTimes(1);
    });

    it("rejects reuse of idempotencyKey with different request payload (409 IDEMPOTENCY_CONFLICT)", async () => {
      vi.mocked(storageClient.uploadToStorage).mockResolvedValueOnce({
        storagePath: "medical-documents/pat_rec_001/doc_orig/report.pdf",
        mimeType: "application/pdf",
        fileSize: 100,
      });
      vi.mocked(prisma.medicalDocument.create).mockResolvedValueOnce({
        id: "server_gen_uuid_001",
        patientId: "pat_rec_001",
        title: "Blood Test Original",
        type: "LAB_REPORT",
      } as any);

      // Initial upload
      const form1 = buildUploadForm({
        fileBytes: createPdfBytes(),
        fileName: "report.pdf",
        title: "Blood Test Original",
        type: "LAB_REPORT",
        reportDate: "2026-10-01",
        idempotencyKey: "idem_key_patient_conflict_test",
      });
      await POST(new NextRequest("http://localhost:3000/api/patients/me/medical-documents", {
        method: "POST",
        body: form1,
      }));

      // Different payload (different title) with same idempotency key
      const form2 = buildUploadForm({
        fileBytes: createPdfBytes(),
        fileName: "report.pdf",
        title: "DIFFERENT TITLE CONFLICT",
        type: "LAB_REPORT",
        reportDate: "2026-10-01",
        idempotencyKey: "idem_key_patient_conflict_test",
      });
      const resConflict = await POST(new NextRequest("http://localhost:3000/api/patients/me/medical-documents", {
        method: "POST",
        body: form2,
      }));
      expect(resConflict.status).toBe(409);
      const data = await resConflict.json();
      expect(data.code).toBe("IDEMPOTENCY_CONFLICT");
      expect(data.error).toContain("previously used with a different request payload");
    });

    it("isolates idempotency keys across different patients (no cross-patient collision)", async () => {
      const sharedKey = "idem_shared_key_between_patients";

      // Patient A upload
      vi.mocked(storageClient.uploadToStorage).mockResolvedValue({
        storagePath: "medical-documents/pat_rec_001/doc/report.pdf",
        mimeType: "application/pdf",
        fileSize: 100,
      });
      vi.mocked(prisma.medicalDocument.create).mockResolvedValue({ id: "doc_patient_a" } as any);

      const formA = buildUploadForm({
        fileBytes: createPdfBytes(),
        title: "Patient A Report",
        type: "LAB_REPORT",
        reportDate: "2026-10-01",
        idempotencyKey: sharedKey,
      });
      const resA = await POST(new NextRequest("http://localhost:3000/api/patients/me/medical-documents", {
        method: "POST",
        body: formA,
      }));
      expect(resA.status).toBe(201);

      // Switch to Patient B
      vi.mocked(getAuthenticatedUser).mockResolvedValue({ id: "user_patient_2", role: "PATIENT" } as any);
      vi.mocked(prisma.patient.findUnique).mockResolvedValue({ id: "pat_rec_002", userId: "user_patient_2" } as any);

      const formB = buildUploadForm({
        fileBytes: createPdfBytes(),
        title: "Patient B Report",
        type: "LAB_REPORT",
        reportDate: "2026-10-01",
        idempotencyKey: sharedKey,
      });
      const resB = await POST(new NextRequest("http://localhost:3000/api/patients/me/medical-documents", {
        method: "POST",
        body: formB,
      }));
      // Patient B succeeds independently without false idempotency hit or conflict
      expect(resB.status).toBe(201);
    });

    it("rejects invalid or oversized idempotency keys with 400 INVALID_IDEMPOTENCY_KEY", async () => {
      // Too short (< 8 chars)
      const formShort = buildUploadForm({
        fileBytes: createPdfBytes(),
        title: "Test",
        type: "LAB_REPORT",
        reportDate: "2026-10-01",
        idempotencyKey: "short",
      });
      const resShort = await POST(new NextRequest("http://localhost:3000/api/patients/me/medical-documents", {
        method: "POST",
        body: formShort,
      }));
      expect(resShort.status).toBe(400);
      expect((await resShort.json()).code).toBe("INVALID_IDEMPOTENCY_KEY");

      // Invalid characters
      const formInvalidChars = buildUploadForm({
        fileBytes: createPdfBytes(),
        title: "Test",
        type: "LAB_REPORT",
        reportDate: "2026-10-01",
        idempotencyKey: "key with spaces!@#$%^",
      });
      const resInvalidChars = await POST(new NextRequest("http://localhost:3000/api/patients/me/medical-documents", {
        method: "POST",
        body: formInvalidChars,
      }));
      expect(resInvalidChars.status).toBe(400);
      expect((await resInvalidChars.json()).code).toBe("INVALID_IDEMPOTENCY_KEY");
    });

    it("guarantees server-generated document ID invariant (never accepts client string as primary key)", async () => {
      vi.mocked(storageClient.uploadToStorage).mockResolvedValueOnce({
        storagePath: "medical-documents/pat_rec_001/doc/report.pdf",
        mimeType: "application/pdf",
        fileSize: 100,
      });
      vi.mocked(prisma.medicalDocument.create).mockImplementationOnce(async ({ data }: any) => {
        return { ...data, createdAt: new Date(), updatedAt: new Date() };
      });

      const clientKey = "client_supplied_idem_key_999999";
      const form = buildUploadForm({
        fileBytes: createPdfBytes(),
        fileName: "report.pdf",
        title: "UUID Verification",
        type: "LAB_REPORT",
        reportDate: "2026-10-01",
        idempotencyKey: clientKey,
      });

      const res = await POST(new NextRequest("http://localhost:3000/api/patients/me/medical-documents", {
        method: "POST",
        body: form,
      }));
      expect(res.status).toBe(201);
      const data = await res.json();
      // Server generated ID must NOT be the client idempotency key
      expect(data.document.id).not.toBe(clientKey);
      // Must be a valid UUID format
      expect(data.document.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      );
    });
  });

  describe("5. Role Authorization & Cross-Role Attack Defense", () => {
    it("strictly blocks DOCTOR from uploading documents through patient upload route", async () => {
      vi.mocked(getAuthenticatedUser).mockResolvedValueOnce(mockDoctorUser as any);

      const form = buildUploadForm({
        fileBytes: createPdfBytes(),
        fileName: "doctor_report.pdf",
        title: "Doctor Report",
        type: "LAB_REPORT",
        reportDate: "2026-10-01",
      });

      const req = new NextRequest("http://localhost:3000/api/patients/me/medical-documents", {
        method: "POST",
        body: form,
      });

      const res = await POST(req);
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.code).toBe("UNAUTHORIZED");
      expect(storageClient.uploadToStorage).not.toHaveBeenCalled();
    });
  });

  describe("6. Upstream Timeout, Cold Start & Error Classification", () => {
    it("maps storage client timeout to HTTP 504 GATEWAY_TIMEOUT with retryable=true and releases locks", async () => {
      vi.mocked(storageClient.uploadToStorage).mockRejectedValueOnce(
        new storageClient.SearchSphereUploadError(
          "Storage upload request timed out.",
          504,
          true,
          "GATEWAY_TIMEOUT"
        )
      );

      const idemKey = "timeout-retry-key-12345";
      const form = buildUploadForm({
        fileBytes: createPdfBytes(),
        fileName: "report.pdf",
        title: "Cold Start Timeout Test",
        type: "LAB_REPORT",
        reportDate: "2026-10-01",
        idempotencyKey: idemKey,
      });

      const res = await POST(
        new NextRequest("http://localhost:3000/api/patients/me/medical-documents", {
          method: "POST",
          body: form,
        })
      );

      expect(res.status).toBe(504);
      const data = await res.json();
      expect(data.code).toBe("GATEWAY_TIMEOUT");
      expect(data.retryable).toBe(true);
      expect(data.error).toContain("timed out");

      // Verify that after timeout, the same idempotency key can immediately be retried without 409 conflict
      vi.mocked(storageClient.uploadToStorage).mockResolvedValueOnce({
        storagePath: "medical-documents/pat_rec_001/doc/report.pdf",
        mimeType: "application/pdf",
        fileSize: 100,
      });
      vi.mocked(prisma.medicalDocument.create).mockResolvedValueOnce({
        id: "doc_retry_ok",
        patientId: "pat_rec_001",
        title: "Cold Start Timeout Test",
        type: "LAB_REPORT",
      } as any);

      const retryRes = await POST(
        new NextRequest("http://localhost:3000/api/patients/me/medical-documents", {
          method: "POST",
          body: form,
        })
      );
      expect(retryRes.status).toBe(201);
    });

    it("maps upstream 503 to HTTP 503 STORAGE_UNAVAILABLE with retryable=true", async () => {
      vi.mocked(storageClient.uploadToStorage).mockRejectedValueOnce(
        new storageClient.SearchSphereUploadError(
          "Storage service is temporarily unavailable.",
          503,
          true,
          "STORAGE_UNAVAILABLE"
        )
      );

      const form = buildUploadForm({
        fileBytes: createPdfBytes(),
        fileName: "report.pdf",
        title: "Upstream 503 Test",
        type: "LAB_REPORT",
        reportDate: "2026-10-01",
      });

      const res = await POST(
        new NextRequest("http://localhost:3000/api/patients/me/medical-documents", {
          method: "POST",
          body: form,
        })
      );

      expect(res.status).toBe(503);
      const data = await res.json();
      expect(data.code).toBe("STORAGE_UNAVAILABLE");
      expect(data.retryable).toBe(true);
    });

    it("maps missing Search-Sphere credentials to 503 PROCESSING_SERVICE_UNAVAILABLE with retryable=false", async () => {
      vi.mocked(storageClient.uploadToStorage).mockRejectedValueOnce(
        new storageClient.SearchSphereConfigError(
          "SEARCH_SPHERE_API_KEY or SEARCH_SPHERE_SERVICE_SECRET is not configured"
        )
      );

      const form = buildUploadForm({
        fileBytes: createPdfBytes(),
        fileName: "report.pdf",
        title: "Config Error Test",
        type: "LAB_REPORT",
        reportDate: "2026-10-01",
      });

      const res = await POST(
        new NextRequest("http://localhost:3000/api/patients/me/medical-documents", {
          method: "POST",
          body: form,
        })
      );

      expect(res.status).toBe(503);
      const data = await res.json();
      expect(data.code).toBe("PROCESSING_SERVICE_UNAVAILABLE");
      expect(data.retryable).toBe(false);
    });
  });
});
