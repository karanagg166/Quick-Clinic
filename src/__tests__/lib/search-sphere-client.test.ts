import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  uploadToStorage,
  getSignedStorageUrl,
  deleteFromStorage,
  queueMedicalDocumentIngestion,
  getMedicalDocumentProcessingStatus,
  deleteMedicalDocumentIndex,
  searchPatientMedicalRecords,
  generatePatientMedicalAnswer,
} from "@/lib/search-sphere-client";

describe("Search Sphere Client (src/lib/search-sphere-client.ts)", () => {
  const originalEnv = { ...process.env };
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.resetAllMocks();
    process.env.SEARCH_SPHERE_API_URL = "http://localhost:8000";
    process.env.SEARCH_SPHERE_SERVICE_SECRET = "test-service-secret-123";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    global.fetch = originalFetch;
  });

  describe("Fail-Closed Configuration", () => {
    it("throws error when SEARCH_SPHERE_SERVICE_SECRET is missing", async () => {
      delete process.env.SEARCH_SPHERE_SERVICE_SECRET;

      await expect(
        generatePatientMedicalAnswer({
          patientId: "pat_1",
          query: "test query",
        })
      ).rejects.toThrow("SEARCH_SPHERE_SERVICE_SECRET is not configured");
    });

    it("throws error when SEARCH_SPHERE_API_URL is missing", async () => {
      delete process.env.SEARCH_SPHERE_API_URL;

      await expect(
        generatePatientMedicalAnswer({
          patientId: "pat_1",
          query: "test query",
        })
      ).rejects.toThrow("SEARCH_SPHERE_API_URL is not configured");
    });
  });

  describe("generatePatientMedicalAnswer()", () => {
    it("calls /internal/medical-rag/answer with correct headers, correlation ID, and payload", async () => {
      const mockResponse = {
        answer: "Blood pressure was 120/80 mmHg on Oct 1. [1]",
        citations: [
          {
            citationId: 1,
            documentId: "doc_1",
            fileName: "bp.pdf",
            documentType: "LAB_REPORT",
            reportDate: "2026-10-01T00:00:00Z",
            pageNumber: 1,
            chunkIndex: 0,
            content: "BP 120/80",
            score: 0.95,
          },
        ],
        resultCount: 1,
      };

      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as any);

      const result = await generatePatientMedicalAnswer(
        {
          patientId: "pat_123",
          query: "What is the BP?",
          limit: 5,
          documentType: "LAB_REPORT",
        },
        { requestId: "req-custom-correlation-123" }
      );

      expect(global.fetch).toHaveBeenCalledWith(
        "http://localhost:8000/internal/medical-rag/answer",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            Authorization: "Bearer test-service-secret-123",
            "Content-Type": "application/json",
            "X-Request-ID": "req-custom-correlation-123",
          }),
          body: JSON.stringify({
            patientId: "pat_123",
            query: "What is the BP?",
            limit: 5,
            documentType: "LAB_REPORT",
          }),
        })
      );

      expect(result.answer).toBe(mockResponse.answer);
      expect(result.citations.length).toBe(1);
      expect(result.citations[0].documentId).toBe("doc_1");
      // Citations should have internal reranker score stripped
      expect(result.citations[0].score).toBeUndefined();
      expect(result.resultCount).toBe(1);
    });

    it("retries on retryable 503 response and succeeds on second attempt", async () => {
      global.fetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: false,
          status: 503,
          text: async () => "Service Unavailable",
        } as any)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ answer: "Recovered answer", citations: [] }),
        } as any);

      const res = await generatePatientMedicalAnswer({
        patientId: "pat_123",
        query: "What is the BP?",
      });

      expect(res.answer).toBe("Recovered answer");
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it("does not retry non-retryable 401 client/auth errors", async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => JSON.stringify({ detail: "Unauthorized service secret" }),
      } as any);

      await expect(
        generatePatientMedicalAnswer({
          patientId: "pat_123",
          query: "BP?",
        })
      ).rejects.toThrow("Medical RAG generation failed (401)");

      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it("handles error response cleanly and throws informative error", async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => JSON.stringify({ detail: "Cohere API key missing" }),
      } as any);

      await expect(
        generatePatientMedicalAnswer({
          patientId: "pat_123",
          query: "BP?",
        })
      ).rejects.toThrow("Medical RAG generation failed (500): Cohere API key missing");
    });
  });

  describe("searchPatientMedicalRecords()", () => {
    it("calls /internal/medical-retrieval/search with proper payload and correlation ID", async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: [] }),
      } as any);

      const res = await searchPatientMedicalRecords({
        patientId: "pat_abc",
        query: "glucose level",
        limit: 10,
      });

      expect(global.fetch).toHaveBeenCalledWith(
        "http://localhost:8000/internal/medical-retrieval/search",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            Authorization: "Bearer test-service-secret-123",
            "Content-Type": "application/json",
            "X-Request-ID": expect.any(String),
          }),
          body: JSON.stringify({
            patientId: "pat_abc",
            query: "glucose level",
            limit: 10,
          }),
        })
      );
      expect(res.results).toEqual([]);
    });
  });

  describe("Storage Operations", () => {
    it("uploadToStorage sends multipart FormData and correlation ID", async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          storagePath: "quick_clinic/pat_1/doc_1.pdf",
          mimeType: "application/pdf",
          fileSize: 1024,
        }),
      } as any);

      const blob = new Blob(["fake pdf content"], { type: "application/pdf" });
      const res = await uploadToStorage({
        file: blob,
        fileName: "test.pdf",
        patientId: "pat_1",
        documentId: "doc_1",
      });

      expect(global.fetch).toHaveBeenCalledWith(
        "http://localhost:8000/internal/medical-documents",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            Authorization: "Bearer test-service-secret-123",
            "X-Request-ID": expect.any(String),
          }),
        })
      );
      expect(res.storagePath).toBe("quick_clinic/pat_1/doc_1.pdf");
    });

    it("getSignedStorageUrl calls signed-url GET endpoint with correlation ID", async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          url: "https://storage.example.com/signed/token",
          expiresIn: 300,
        }),
      } as any);

      const res = await getSignedStorageUrl("quick_clinic/pat_1/doc_1.pdf", 300);

      expect(global.fetch).toHaveBeenCalledWith(
        "http://localhost:8000/internal/medical-documents/signed-url?storagePath=quick_clinic%2Fpat_1%2Fdoc_1.pdf&expiresIn=300",
        expect.objectContaining({
          method: "GET",
          headers: expect.objectContaining({
            Authorization: "Bearer test-service-secret-123",
            "X-Request-ID": expect.any(String),
          }),
        })
      );
      expect(res.url).toContain("storage.example.com");
    });

    it("deleteFromStorage calls DELETE endpoint", async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, message: "Deleted" }),
      } as any);

      const res = await deleteFromStorage("quick_clinic/pat_1/doc_1.pdf");
      expect(res.success).toBe(true);
    });
  });

  describe("Ingestion & Status", () => {
    it("queueMedicalDocumentIngestion posts to /ingest with correlation ID", async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({ documentId: "doc_1", status: "QUEUED" }),
      } as any);

      const res = await queueMedicalDocumentIngestion({
        documentId: "doc_1",
        patientId: "pat_1",
        storagePath: "path/doc_1.pdf",
        fileName: "doc_1.pdf",
        mimeType: "application/pdf",
        fileSize: 500,
        documentType: "LAB_REPORT",
      });

      expect(res.status).toBe("QUEUED");
      expect(global.fetch).toHaveBeenCalledWith(
        "http://localhost:8000/internal/medical-documents/doc_1/ingest",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            Authorization: "Bearer test-service-secret-123",
            "Content-Type": "application/json",
            "X-Request-ID": expect.any(String),
          }),
        })
      );
    });

    it("getMedicalDocumentProcessingStatus gets /status", async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          documentId: "doc_1",
          status: "READY",
          processedAt: "2026-10-01T00:00:00Z",
          error: null,
        }),
      } as any);

      const res = await getMedicalDocumentProcessingStatus("doc_1");
      expect(res.status).toBe("READY");
    });

    it("deleteMedicalDocumentIndex calls DELETE /index", async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, message: "Indexed vectors deleted" }),
      } as any);

      const res = await deleteMedicalDocumentIndex("doc_1");
      expect(res.success).toBe(true);
    });
  });
});
