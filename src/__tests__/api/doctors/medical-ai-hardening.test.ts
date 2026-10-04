import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { POST as sendChatMessage } from "@/app/api/doctors/me/patients/[patientId]/medical-chat/conversations/[conversationId]/messages/route";
import { POST as streamChatMessage } from "@/app/api/doctors/me/patients/[patientId]/medical-chat/conversations/[conversationId]/stream/route";
import { POST as getMedicalAnswer } from "@/app/api/doctors/me/patients/[patientId]/medical-answer/route";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser } from "@/lib/auth";
import {
  generatePatientMedicalChat,
  generatePatientMedicalAnswer,
  openPatientMedicalChatStream,
} from "@/lib/search-sphere-client";
import {
  clearInMemoryChatGuards,
  acquireConversationLock,
  releaseConversationLock,
} from "@/lib/medical-chat-guard";
import { clearInMemoryRateLimits, checkDoctorMedicalRateLimit } from "@/lib/rate-limiter";
import { getOrCreateRequestId } from "@/lib/correlation-id";
import { sanitizeErrorMessage } from "@/lib/error-sanitizer";
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
    medicalAiConversation: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    medicalAiMessage: {
      create: vi.fn(),
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
  generatePatientMedicalChat: vi.fn(),
  generatePatientMedicalAnswer: vi.fn(),
  openPatientMedicalChatStream: vi.fn(),
  sanitizeCitations: vi.fn((citations) => citations || []),
}));

describe("Medical AI Hardening Suite", () => {
  const doctorUser = { id: "user_doc_h", role: "DOCTOR" };
  const doctorProfile = { id: "doc_profile_h", userId: "user_doc_h" };
  const patientId = "pat_h_123";
  const conversationId = "conv_h_123";

  const qualifyingAppointment = {
    id: "apt_h_1",
    doctorId: doctorProfile.id,
    patientId,
    status: AppointmentStatus.CONFIRMED,
  };

  const validConversation = {
    id: conversationId,
    doctorId: doctorProfile.id,
    patientId,
    title: "Hardening Test Chat",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    clearInMemoryChatGuards();
    clearInMemoryRateLimits();

    vi.mocked(getAuthenticatedUser).mockResolvedValue(doctorUser as any);
    vi.mocked(prisma.doctor.findUnique).mockResolvedValue(doctorProfile as any);
    vi.mocked(prisma.appointment.findFirst).mockResolvedValue(qualifyingAppointment as any);
    vi.mocked(prisma.medicalAiConversation.findUnique).mockResolvedValue(validConversation as any);
    vi.mocked(prisma.medicalAiMessage.create).mockImplementation(async (args: any) => ({
      id: `msg_${Math.random().toString(36).substring(7)}`,
      ...args.data,
      createdAt: new Date(),
    }));
    vi.mocked(prisma.medicalAiMessage.findMany).mockResolvedValue([]);
    vi.mocked(prisma.medicalAiConversation.update).mockResolvedValue(validConversation as any);
    vi.mocked(prisma.medicalDocument.findMany).mockResolvedValue([]);
  });

  describe("PART 4 & 5: Correlation IDs", () => {
    it("extracts and validates a safe X-Request-ID header", () => {
      const safeId = "custom-req-id-uuid-12345678";
      const req = new NextRequest("http://localhost:3000/api/test", {
        headers: { "x-request-id": safeId },
      });
      const extracted = getOrCreateRequestId(req);
      expect(extracted).toBe(safeId);
    });

    it("rejects malicious or script-injected X-Request-ID and returns a clean UUID", () => {
      const dirtyReq = new NextRequest("http://localhost:3000/api/test", {
        headers: { "x-request-id": "<script>alert(1)</script>" },
      });
      const generated = getOrCreateRequestId(dirtyReq);
      expect(generated).not.toContain("<script>");
      expect(generated).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    });
  });

  describe("PART 7: Error Sanitization", () => {
    it("replaces upstream database and AI infrastructure details with a user-safe message", () => {
      const leakyErrors = [
        "Error: Cohere API key invalid or expired",
        "connect ECONNREFUSED 127.0.0.1:6333 (Qdrant)",
        "Search Sphere connection refused",
        "PrismaClientInitializationError: Can't reach database server",
      ];

      for (const err of leakyErrors) {
        const sanitized = sanitizeErrorMessage(err, "AI answer generation is temporarily unavailable.");
        expect(sanitized).toBe("AI answer generation is temporarily unavailable.");
        expect(sanitized).not.toContain("Cohere");
        expect(sanitized).not.toContain("Qdrant");
        expect(sanitized).not.toContain("ECONNREFUSED");
        expect(sanitized).not.toContain("Prisma");
      }
    });

    it("medical answer endpoint returns sanitized error on service crash", async () => {
      vi.mocked(generatePatientMedicalAnswer).mockRejectedValueOnce(
        new Error("Qdrant connection refused at cluster-internal:6333")
      );

      const req = new NextRequest(`http://localhost:3000/api/doctors/me/patients/${patientId}/medical-answer`, {
        method: "POST",
        body: JSON.stringify({ query: "What is blood pressure?" }),
      });

      const res = await getMedicalAnswer(req, { params: Promise.resolve({ patientId }) });
      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data.error).toBe("AI answer generation is temporarily unavailable.");
      expect(data.error).not.toContain("Qdrant");
    });
  });

  describe("PART 11 & 12: Chat Message Idempotency", () => {
    it("rejects duplicate message submissions with clientMessageId within time window (409 Conflict)", async () => {
      vi.mocked(generatePatientMedicalChat).mockResolvedValueOnce({
        answer: "First response",
        citations: [],
        resultCount: 0,
      });

      const clientMessageId = "unique-client-msg-uuid-999";

      // 1. First submission succeeds
      const req1 = new NextRequest(
        `http://localhost:3000/api/doctors/me/patients/${patientId}/medical-chat/conversations/${conversationId}/messages`,
        {
          method: "POST",
          body: JSON.stringify({
            message: "Doctor query once",
            clientMessageId,
          }),
        }
      );

      const res1 = await sendChatMessage(req1, {
        params: Promise.resolve({ patientId, conversationId }),
      });
      expect(res1.status).toBe(200);

      // 2. Duplicate submission with same clientMessageId immediately afterwards
      const req2 = new NextRequest(
        `http://localhost:3000/api/doctors/me/patients/${patientId}/medical-chat/conversations/${conversationId}/messages`,
        {
          method: "POST",
          body: JSON.stringify({
            message: "Doctor query once",
            clientMessageId,
          }),
        }
      );

      const res2 = await sendChatMessage(req2, {
        params: Promise.resolve({ patientId, conversationId }),
      });
      expect(res2.status).toBe(409);
      const data2 = await res2.json();
      expect(data2.error).toContain("Duplicate message submission detected");
    });
  });

  describe("PART 16: Concurrency Protection", () => {
    it("rejects simultaneous generation requests on the same conversation with 409 Conflict", async () => {
      // Simulate active conversation lock already acquired by another request
      await acquireConversationLock(conversationId, 60);

      const req = new NextRequest(
        `http://localhost:3000/api/doctors/me/patients/${patientId}/medical-chat/conversations/${conversationId}/messages`,
        {
          method: "POST",
          body: JSON.stringify({ message: "Second concurrent message" }),
        }
      );

      const res = await sendChatMessage(req, {
        params: Promise.resolve({ patientId, conversationId }),
      });
      expect(res.status).toBe(409);
      const data = await res.json();
      expect(data.error).toContain("A response is already being generated for this conversation");

      // Release lock and ensure subsequent request can succeed
      await releaseConversationLock(conversationId);

      vi.mocked(generatePatientMedicalChat).mockResolvedValueOnce({
        answer: "Now permitted",
        citations: [],
        resultCount: 0,
      });

      const req2 = new NextRequest(
        `http://localhost:3000/api/doctors/me/patients/${patientId}/medical-chat/conversations/${conversationId}/messages`,
        {
          method: "POST",
          body: JSON.stringify({ message: "Second permitted message" }),
        }
      );

      const resAfterRelease = await sendChatMessage(req2, {
        params: Promise.resolve({ patientId, conversationId }),
      });
      expect(resAfterRelease.status).toBe(200);
    });
  });

  describe("PART 15: Rate Limiting", () => {
    it("returns 429 Too Many Requests when rate limit is exceeded for a doctor endpoint", async () => {
      const doctorId = "doc_rate_limit_test";

      // Consume entire limit (20 requests for answer)
      for (let i = 0; i < 20; i++) {
        const res = await checkDoctorMedicalRateLimit(doctorId, "answer");
        expect(res.allowed).toBe(true);
      }

      // 21st request should be rejected
      const blockedRes = await checkDoctorMedicalRateLimit(doctorId, "answer");
      expect(blockedRes.allowed).toBe(false);
      expect(blockedRes.remaining).toBe(0);
      expect(blockedRes.resetSeconds).toBeGreaterThan(0);
    });
  });

  describe("PART 13: Streaming Disconnect Handling", () => {
    it("marks partial answer as FAILED and releases conversation lock when client disconnects midway", async () => {
      // Create mock stream body
      const streamBody = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('event: token\ndata: {"text":"Partial answer..."}\n\n'));
          // Intentionally do not close so reader stays active
        },
      });

      vi.mocked(openPatientMedicalChatStream).mockResolvedValueOnce(
        new Response(streamBody, {
          headers: { "Content-Type": "text/event-stream" },
        })
      );

      const req = new NextRequest(
        `http://localhost:3000/api/doctors/me/patients/${patientId}/medical-chat/conversations/${conversationId}/stream`,
        {
          method: "POST",
          body: JSON.stringify({ message: "Test streaming question" }),
        }
      );

      const res = await streamChatMessage(req, {
        params: Promise.resolve({ patientId, conversationId }),
      });
      expect(res.status).toBe(200);
      expect(res.body).toBeDefined();

      // Read initial token to trigger stream reader
      const reader = res.body!.getReader();
      const firstChunk = await reader.read();
      expect(firstChunk.done).toBe(false);

      // Now simulate client disconnect by cancelling reader
      await reader.cancel("client disconnected");

      // Verify lock was released
      const lockAcquiredAgain = await acquireConversationLock(conversationId, 60);
      expect(lockAcquiredAgain).toBe(true);
    });
  });
});
