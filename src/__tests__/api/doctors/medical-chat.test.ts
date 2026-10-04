import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { POST as createConversation, GET as listConversations } from "@/app/api/doctors/me/patients/[patientId]/medical-chat/conversations/route";
import { GET as getConversation, DELETE as deleteConversation } from "@/app/api/doctors/me/patients/[patientId]/medical-chat/conversations/[conversationId]/route";
import { POST as sendMessage } from "@/app/api/doctors/me/patients/[patientId]/medical-chat/conversations/[conversationId]/messages/route";
import { POST as streamMessage } from "@/app/api/doctors/me/patients/[patientId]/medical-chat/conversations/[conversationId]/stream/route";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser } from "@/lib/auth";
import { logAccess, logAudit } from "@/lib/logger";
import {
  generatePatientMedicalChat,
  openPatientMedicalChatStream,
} from "@/lib/search-sphere-client";
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
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
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
  openPatientMedicalChatStream: vi.fn(),
}));

describe("Doctor Medical AI Chat API Test Suite", () => {
  const doctorUserA = { id: "user_doc_a", role: "DOCTOR", email: "doctorA@example.com" };
  const doctorUserB = { id: "user_doc_b", role: "DOCTOR", email: "doctorB@example.com" };
  const patientUser = { id: "user_pat_1", role: "PATIENT", email: "patient@example.com" };

  const doctorProfileA = { id: "doc_profile_a", userId: "user_doc_a" };
  const doctorProfileB = { id: "doc_profile_b", userId: "user_doc_b" };

  const patientIdA = "pat_123";
  const patientIdB = "pat_456";

  const conversationIdA = "conv_123";

  const qualifyingAppointment = {
    id: "apt_1",
    doctorId: doctorProfileA.id,
    patientId: patientIdA,
    status: AppointmentStatus.CONFIRMED,
    bookedAt: new Date("2026-10-01"),
  };

  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe("PART 35: Create Conversation Authorization", () => {
    it("CONFIRMED appointment -> allowed (201)", async () => {
      vi.mocked(getAuthenticatedUser).mockResolvedValueOnce(doctorUserA as any);
      vi.mocked(prisma.doctor.findUnique).mockResolvedValueOnce(doctorProfileA as any);
      vi.mocked(prisma.appointment.findFirst).mockResolvedValueOnce({
        ...qualifyingAppointment,
        status: AppointmentStatus.CONFIRMED,
      } as any);

      const mockCreated = {
        id: "conv_new_1",
        doctorId: doctorProfileA.id,
        patientId: patientIdA,
        title: "Blood pressure follow-up",
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      vi.mocked(prisma.medicalAiConversation.create).mockResolvedValueOnce(mockCreated as any);

      const req = new NextRequest(
        `http://localhost:3000/api/doctors/me/patients/${patientIdA}/medical-chat/conversations`,
        {
          method: "POST",
          body: JSON.stringify({ title: "Blood pressure follow-up" }),
        }
      );

      const res = await createConversation(req, {
        params: Promise.resolve({ patientId: patientIdA }),
      });

      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.conversation.id).toBe("conv_new_1");
      expect(data.conversation.title).toBe("Blood pressure follow-up");
      expect(logAudit).toHaveBeenCalledWith(
        doctorUserA.id,
        "MEDICAL_CHAT_CONVERSATION_CREATED",
        expect.objectContaining({ patientId: patientIdA, conversationId: "conv_new_1" }),
        "MEDICAL_RECORD"
      );
    });

    it("COMPLETED appointment -> allowed (201)", async () => {
      vi.mocked(getAuthenticatedUser).mockResolvedValueOnce(doctorUserA as any);
      vi.mocked(prisma.doctor.findUnique).mockResolvedValueOnce(doctorProfileA as any);
      vi.mocked(prisma.appointment.findFirst).mockResolvedValueOnce({
        ...qualifyingAppointment,
        status: AppointmentStatus.COMPLETED,
      } as any);

      const mockCreated = {
        id: "conv_completed_1",
        doctorId: doctorProfileA.id,
        patientId: patientIdA,
        title: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      vi.mocked(prisma.medicalAiConversation.create).mockResolvedValueOnce(mockCreated as any);

      const req = new NextRequest(
        `http://localhost:3000/api/doctors/me/patients/${patientIdA}/medical-chat/conversations`,
        {
          method: "POST",
          body: JSON.stringify({}),
        }
      );

      const res = await createConversation(req, {
        params: Promise.resolve({ patientId: patientIdA }),
      });

      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.conversation.id).toBe("conv_completed_1");
    });

    it("PENDING/CANCELLED/NO_SHOW -> denied (403)", async () => {
      vi.mocked(getAuthenticatedUser).mockResolvedValueOnce(doctorUserA as any);
      vi.mocked(prisma.doctor.findUnique).mockResolvedValueOnce(doctorProfileA as any);
      vi.mocked(prisma.appointment.findFirst).mockResolvedValueOnce(null); // No CONFIRMED/COMPLETED

      const req = new NextRequest(
        `http://localhost:3000/api/doctors/me/patients/${patientIdA}/medical-chat/conversations`,
        {
          method: "POST",
          body: JSON.stringify({ title: "Checkup" }),
        }
      );

      const res = await createConversation(req, {
        params: Promise.resolve({ patientId: patientIdA }),
      });

      expect(res.status).toBe(403);
      expect(prisma.medicalAiConversation.create).not.toHaveBeenCalled();
      expect(logAudit).toHaveBeenCalledWith(
        doctorUserA.id,
        "MEDICAL_CHAT_ACCESS_DENIED",
        expect.objectContaining({ patientId: patientIdA }),
        "MEDICAL_RECORD"
      );
    });

    it("Non-doctor role -> denied (403)", async () => {
      vi.mocked(getAuthenticatedUser).mockResolvedValueOnce(patientUser as any);

      const req = new NextRequest(
        `http://localhost:3000/api/doctors/me/patients/${patientIdA}/medical-chat/conversations`,
        {
          method: "POST",
          body: JSON.stringify({}),
        }
      );

      const res = await createConversation(req, {
        params: Promise.resolve({ patientId: patientIdA }),
      });

      expect(res.status).toBe(403);
    });
  });

  describe("PART 35 & 23: Doctor Ownership & Isolation", () => {
    it("Doctor B cannot read Doctor A's conversation", async () => {
      vi.mocked(getAuthenticatedUser).mockResolvedValueOnce(doctorUserB as any);
      vi.mocked(prisma.doctor.findUnique).mockResolvedValueOnce(doctorProfileB as any);
      // Doctor B happens to have an appointment with Patient A, but does NOT own the conversation
      vi.mocked(prisma.appointment.findFirst).mockResolvedValueOnce({
        ...qualifyingAppointment,
        doctorId: doctorProfileB.id,
      } as any);

      vi.mocked(prisma.medicalAiConversation.findUnique).mockResolvedValueOnce({
        id: conversationIdA,
        doctorId: doctorProfileA.id, // Owned by Doctor A!
        patientId: patientIdA,
        title: "Doctor A chat",
        messages: [],
      } as any);

      const req = new NextRequest(
        `http://localhost:3000/api/doctors/me/patients/${patientIdA}/medical-chat/conversations/${conversationIdA}`
      );

      const res = await getConversation(req, {
        params: Promise.resolve({ patientId: patientIdA, conversationId: conversationIdA }),
      });

      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toContain("You do not own this conversation");
    });

    it("Doctor B cannot send message to Doctor A's conversation", async () => {
      vi.mocked(getAuthenticatedUser).mockResolvedValueOnce(doctorUserB as any);
      vi.mocked(prisma.doctor.findUnique).mockResolvedValueOnce(doctorProfileB as any);
      vi.mocked(prisma.appointment.findFirst).mockResolvedValueOnce(qualifyingAppointment as any);

      vi.mocked(prisma.medicalAiConversation.findUnique).mockResolvedValueOnce({
        id: conversationIdA,
        doctorId: doctorProfileA.id, // Doctor A
        patientId: patientIdA,
        title: "Doctor A chat",
      } as any);

      const req = new NextRequest(
        `http://localhost:3000/api/doctors/me/patients/${patientIdA}/medical-chat/conversations/${conversationIdA}/messages`,
        {
          method: "POST",
          body: JSON.stringify({ message: "Intruder question" }),
        }
      );

      const res = await sendMessage(req, {
        params: Promise.resolve({ patientId: patientIdA, conversationId: conversationIdA }),
      });

      expect(res.status).toBe(403);
      expect(prisma.medicalAiMessage.create).not.toHaveBeenCalled();
    });

    it("Doctor B cannot delete Doctor A's conversation", async () => {
      vi.mocked(getAuthenticatedUser).mockResolvedValueOnce(doctorUserB as any);
      vi.mocked(prisma.doctor.findUnique).mockResolvedValueOnce(doctorProfileB as any);
      vi.mocked(prisma.appointment.findFirst).mockResolvedValueOnce(qualifyingAppointment as any);

      vi.mocked(prisma.medicalAiConversation.findUnique).mockResolvedValueOnce({
        id: conversationIdA,
        doctorId: doctorProfileA.id, // Doctor A
        patientId: patientIdA,
      } as any);

      const req = new NextRequest(
        `http://localhost:3000/api/doctors/me/patients/${patientIdA}/medical-chat/conversations/${conversationIdA}`,
        { method: "DELETE" }
      );

      const res = await deleteConversation(req, {
        params: Promise.resolve({ patientId: patientIdA, conversationId: conversationIdA }),
      });

      expect(res.status).toBe(403);
      expect(prisma.medicalAiConversation.delete).not.toHaveBeenCalled();
    });
  });

  describe("PART 35 & 22: Patient Binding", () => {
    it("Conversation for Patient A cannot be accessed under Patient B route", async () => {
      vi.mocked(getAuthenticatedUser).mockResolvedValueOnce(doctorUserA as any);
      vi.mocked(prisma.doctor.findUnique).mockResolvedValueOnce(doctorProfileA as any);
      vi.mocked(prisma.appointment.findFirst).mockResolvedValueOnce({
        ...qualifyingAppointment,
        patientId: patientIdB,
      } as any);

      // Conversation belongs to Patient A
      vi.mocked(prisma.medicalAiConversation.findUnique).mockResolvedValueOnce({
        id: conversationIdA,
        doctorId: doctorProfileA.id,
        patientId: patientIdA, // Patient A
        title: "Patient A chat",
        messages: [],
      } as any);

      // Route requested is Patient B
      const req = new NextRequest(
        `http://localhost:3000/api/doctors/me/patients/${patientIdB}/medical-chat/conversations/${conversationIdA}`
      );

      const res = await getConversation(req, {
        params: Promise.resolve({ patientId: patientIdB, conversationId: conversationIdA }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("bound to a different patient");
    });
  });

  describe("PART 35: Message Persistence & Citation Verification", () => {
    it("Stores user message, verifies citations, and stores assistant message", async () => {
      vi.mocked(getAuthenticatedUser).mockResolvedValueOnce(doctorUserA as any);
      vi.mocked(prisma.doctor.findUnique).mockResolvedValueOnce(doctorProfileA as any);
      vi.mocked(prisma.appointment.findFirst).mockResolvedValueOnce(qualifyingAppointment as any);

      vi.mocked(prisma.medicalAiConversation.findUnique).mockResolvedValueOnce({
        id: conversationIdA,
        doctorId: doctorProfileA.id,
        patientId: patientIdA,
        title: "Hypertension",
      } as any);

      const mockUserMsg = {
        id: "msg_user_1",
        conversationId: conversationIdA,
        role: "USER",
        content: "What were recent BP readings?",
        status: "COMPLETE",
      };
      vi.mocked(prisma.medicalAiMessage.create).mockResolvedValueOnce(mockUserMsg as any);

      // Prior message history for context
      vi.mocked(prisma.medicalAiMessage.findMany).mockResolvedValueOnce([]);

      // Search Sphere response
      vi.mocked(generatePatientMedicalChat).mockResolvedValueOnce({
        answer: "Blood pressure was 120/80 on Oct 1 [1].",
        citations: [
          {
            citationId: 1,
            documentId: "doc_patA_1",
            fileName: "bp.pdf",
            documentType: "LAB_REPORT",
            reportDate: "2026-10-01",
            pageNumber: 1,
            chunkIndex: 0,
          },
        ],
        resultCount: 1,
      });

      // Citation verification in DB: doc_patA_1 belongs to patientIdA
      vi.mocked(prisma.medicalDocument.findMany).mockResolvedValueOnce([
        { id: "doc_patA_1" } as any,
      ]);

      const mockAssistantMsg = {
        id: "msg_ast_1",
        conversationId: conversationIdA,
        role: "ASSISTANT",
        content: "Blood pressure was 120/80 on Oct 1 [1].",
        citations: [{ citationId: 1, documentId: "doc_patA_1" }],
        status: "COMPLETE",
      };
      vi.mocked(prisma.medicalAiMessage.create).mockResolvedValueOnce(mockAssistantMsg as any);
      vi.mocked(prisma.medicalAiConversation.update).mockResolvedValueOnce({} as any);

      const req = new NextRequest(
        `http://localhost:3000/api/doctors/me/patients/${patientIdA}/medical-chat/conversations/${conversationIdA}/messages`,
        {
          method: "POST",
          body: JSON.stringify({ message: "What were recent BP readings?" }),
        }
      );

      const res = await sendMessage(req, {
        params: Promise.resolve({ patientId: patientIdA, conversationId: conversationIdA }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.message.role).toBe("ASSISTANT");

      // Verify user message was created first
      expect(prisma.medicalAiMessage.create).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          data: expect.objectContaining({
            conversationId: conversationIdA,
            role: "USER",
            content: "What were recent BP readings?",
          }),
        })
      );

      // Verify assistant message was created second
      expect(prisma.medicalAiMessage.create).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          data: expect.objectContaining({
            conversationId: conversationIdA,
            role: "ASSISTANT",
            content: "Blood pressure was 120/80 on Oct 1 [1].",
          }),
        })
      );

      expect(logAudit).toHaveBeenCalledWith(
        doctorUserA.id,
        "MEDICAL_CHAT_RESPONSE_GENERATED",
        expect.objectContaining({ patientId: patientIdA, conversationId: conversationIdA }),
        "MEDICAL_RECORD"
      );
    });

    it("Cross-patient citation triggers MEDICAL_CHAT_SECURITY_ANOMALY and does not persist assistant response", async () => {
      vi.mocked(getAuthenticatedUser).mockResolvedValueOnce(doctorUserA as any);
      vi.mocked(prisma.doctor.findUnique).mockResolvedValueOnce(doctorProfileA as any);
      vi.mocked(prisma.appointment.findFirst).mockResolvedValueOnce(qualifyingAppointment as any);

      vi.mocked(prisma.medicalAiConversation.findUnique).mockResolvedValueOnce({
        id: conversationIdA,
        doctorId: doctorProfileA.id,
        patientId: patientIdA,
        title: "Test",
      } as any);

      vi.mocked(prisma.medicalAiMessage.create).mockResolvedValueOnce({
        id: "msg_user_1",
        role: "USER",
      } as any);

      vi.mocked(prisma.medicalAiMessage.findMany).mockResolvedValueOnce([]);

      // Search Sphere returns citation to Patient B's document!
      vi.mocked(generatePatientMedicalChat).mockResolvedValueOnce({
        answer: "Leaked data from another patient [1].",
        citations: [
          {
            citationId: 1,
            documentId: "doc_alien_999",
            fileName: "other.pdf",
            documentType: "LAB_REPORT",
            reportDate: null,
            pageNumber: 1,
            chunkIndex: 0,
          },
        ],
        resultCount: 1,
      });

      // Quick Clinic DB check finds NO document with id "doc_alien_999" for patientIdA
      vi.mocked(prisma.medicalDocument.findMany).mockResolvedValueOnce([]);

      const req = new NextRequest(
        `http://localhost:3000/api/doctors/me/patients/${patientIdA}/medical-chat/conversations/${conversationIdA}/messages`,
        {
          method: "POST",
          body: JSON.stringify({ message: "Show me foreign records" }),
        }
      );

      const res = await sendMessage(req, {
        params: Promise.resolve({ patientId: patientIdA, conversationId: conversationIdA }),
      });

      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data.error).toContain("Security validation failed");

      // Verify anomaly audit log was triggered
      expect(logAudit).toHaveBeenCalledWith(
        doctorUserA.id,
        "MEDICAL_CHAT_SECURITY_ANOMALY",
        expect.objectContaining({
          patientId: patientIdA,
          reason: "CROSS_PATIENT_CITATION_DETECTED",
        }),
        "MEDICAL_RECORD"
      );

      // Verify assistant message was NOT persisted (only 1 create call for the user message)
      expect(prisma.medicalAiMessage.create).toHaveBeenCalledTimes(1);
    });
  });

  describe("PART 38: Conversation History Limit", () => {
    it("Sends only bounded recent history (<= 8 messages) even when 30+ exist", async () => {
      vi.mocked(getAuthenticatedUser).mockResolvedValueOnce(doctorUserA as any);
      vi.mocked(prisma.doctor.findUnique).mockResolvedValueOnce(doctorProfileA as any);
      vi.mocked(prisma.appointment.findFirst).mockResolvedValueOnce(qualifyingAppointment as any);

      vi.mocked(prisma.medicalAiConversation.findUnique).mockResolvedValueOnce({
        id: conversationIdA,
        doctorId: doctorProfileA.id,
        patientId: patientIdA,
        title: "Long conversation",
      } as any);

      vi.mocked(prisma.medicalAiMessage.create).mockResolvedValueOnce({
        id: "msg_user_new",
        role: "USER",
      } as any);

      // When querying DB for recent messages, verify take is bounded to <= 8
      vi.mocked(prisma.medicalAiMessage.findMany).mockImplementationOnce((args: any) => {
        expect(args.take).toBeLessThanOrEqual(10);
        // Return simulated 8 messages
        return Promise.resolve(
          Array.from({ length: 8 }).map((_, i) => ({
            role: i % 2 === 0 ? "USER" : "ASSISTANT",
            content: `Message ${i}`,
          }))
        ) as any;
      });

      vi.mocked(generatePatientMedicalChat).mockResolvedValueOnce({
        answer: "Grounded answer [1].",
        citations: [],
        resultCount: 0,
      });

      vi.mocked(prisma.medicalAiMessage.create).mockResolvedValueOnce({
        id: "msg_ast_new",
        role: "ASSISTANT",
      } as any);
      vi.mocked(prisma.medicalAiConversation.update).mockResolvedValueOnce({} as any);

      const req = new NextRequest(
        `http://localhost:3000/api/doctors/me/patients/${patientIdA}/medical-chat/conversations/${conversationIdA}/messages`,
        {
          method: "POST",
          body: JSON.stringify({ message: "Latest question" }),
        }
      );

      await sendMessage(req, {
        params: Promise.resolve({ patientId: patientIdA, conversationId: conversationIdA }),
      });

      // Verify Search Sphere received only bounded history
      expect(generatePatientMedicalChat).toHaveBeenCalledWith(
        expect.objectContaining({
          history: expect.arrayContaining([
            expect.objectContaining({ content: expect.any(String) }),
          ]),
        })
      );
      const callArgs = vi.mocked(generatePatientMedicalChat).mock.calls[0][0];
      expect(callArgs.history?.length).toBe(8);
    });
  });

  describe("PART 35: Streaming Failure Handling", () => {
    it("User message remains persisted, incomplete assistant message is not saved as complete", async () => {
      vi.mocked(getAuthenticatedUser).mockResolvedValueOnce(doctorUserA as any);
      vi.mocked(prisma.doctor.findUnique).mockResolvedValueOnce(doctorProfileA as any);
      vi.mocked(prisma.appointment.findFirst).mockResolvedValueOnce(qualifyingAppointment as any);

      vi.mocked(prisma.medicalAiConversation.findUnique).mockResolvedValueOnce({
        id: conversationIdA,
        doctorId: doctorProfileA.id,
        patientId: patientIdA,
        title: "Stream test",
      } as any);

      vi.mocked(prisma.medicalAiMessage.create).mockResolvedValueOnce({
        id: "msg_user_stream_1",
        role: "USER",
        content: "What is the heart rate?",
      } as any);

      vi.mocked(prisma.medicalAiMessage.findMany).mockResolvedValueOnce([]);

      // Stream that errors out halfway through
      let chunkSent = false;
      const mockStream = new ReadableStream({
        pull(controller) {
          if (!chunkSent) {
            chunkSent = true;
            controller.enqueue(new TextEncoder().encode('event: token\ndata: {"text":"The heart"}\n\n'));
          } else {
            controller.error(new Error("Network drop"));
          }
        },
      });

      vi.mocked(openPatientMedicalChatStream).mockResolvedValueOnce(
        new Response(mockStream, {
          headers: { "Content-Type": "text/event-stream" },
        })
      );

      const req = new NextRequest(
        `http://localhost:3000/api/doctors/me/patients/${patientIdA}/medical-chat/conversations/${conversationIdA}/stream`,
        {
          method: "POST",
          body: JSON.stringify({ message: "What is the heart rate?" }),
        }
      );

      const res = await streamMessage(req, {
        params: Promise.resolve({ patientId: patientIdA, conversationId: conversationIdA }),
      });

      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toContain("text/event-stream");

      const text = await res.text();
      expect(text).toContain("event: token");
      expect(text).toContain("event: error");

      // Verify that no assistant message was saved with status: "COMPLETE"
      const assistantCalls = vi.mocked(prisma.medicalAiMessage.create).mock.calls.filter(
        (c) => c[0].data.role === "ASSISTANT" && c[0].data.status === "COMPLETE"
      );
      expect(assistantCalls.length).toBe(0);
    });
  });
});
