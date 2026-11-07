import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST as streamMessage } from "@/app/api/doctors/me/patients/[patientId]/medical-chat/conversations/[conversationId]/stream/route";
import { POST as sendMessage } from "@/app/api/doctors/me/patients/[patientId]/medical-chat/conversations/[conversationId]/messages/route";
import { POST as answerQuestion } from "@/app/api/doctors/me/patients/[patientId]/medical-answer/route";
import { POST as searchRecords } from "@/app/api/doctors/me/patients/[patientId]/medical-search/route";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser } from "@/lib/auth";
import { generatePatientMedicalChat, generatePatientMedicalAnswer, searchPatientMedicalRecords, openPatientMedicalChatStream } from "@/lib/search-sphere-client";
import { clearInMemoryChatGuards } from "@/lib/medical-chat-guard";
import { clearInMemoryRateLimits } from "@/lib/rate-limiter";

vi.mock("@/lib/auth", () => ({ getAuthenticatedUser: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: {
  doctor: { findUnique: vi.fn() }, appointment: { findFirst: vi.fn() },
  medicalDocument: { findMany: vi.fn() },
  medicalAiConversation: { findUnique: vi.fn(), update: vi.fn() },
  medicalAiMessage: { create: vi.fn() },
} }));
vi.mock("@/lib/logger", () => ({ logAudit: vi.fn(), logAccess: vi.fn() }));
vi.mock("@/lib/search-sphere-client", () => ({
  generatePatientMedicalChat: vi.fn(), generatePatientMedicalAnswer: vi.fn(), searchPatientMedicalRecords: vi.fn(), openPatientMedicalChatStream: vi.fn(),
  sanitizeCitations: (value: unknown) => value,
  medicalChatFailure: () => ({ status: 503, code: "provider_unavailable" }),
}));

const user = { id: "synthetic-doctor-user", role: "DOCTOR" };
const thread = { id: "synthetic-thread", doctorId: "synthetic-doctor", patientId: "synthetic-patient", title: "Synthetic fixture" };
const answer = "UNVALIDATED SYNTHETIC EVIDENCE [1]";
const citations = [{ citationId: 1, documentId: "synthetic-document", fileName: "synthetic.pdf", documentType: "OTHER", reportDate: null, pageNumber: 1, chunkIndex: 0 }];
const event = (kind: string, value: unknown) => `event: ${kind}\ndata: ${JSON.stringify(value)}\n\n`;
const complete = event("token", { text: answer })+event("citations", { citations })+event("done", { answer, citations, mode: "RAG" });
function stream(raw: string) {
  return new Response(new ReadableStream<Uint8Array>({ start(controller) {
    controller.enqueue(new TextEncoder().encode(raw)); controller.close();
  } }), { headers: { "Content-Type": "text/event-stream" } });
}
const context = { params: Promise.resolve({ patientId: thread.patientId, conversationId: thread.id }) };
function request() {
  return new NextRequest("https://example.invalid/medical/fixture", { method: "POST", body: JSON.stringify({ query: "Public synthetic fixture", message: "Public synthetic fixture" }) });
}
function assistantWrites() { return vi.mocked(prisma.medicalAiMessage.create).mock.calls.filter(([value]) => value.data.role === "ASSISTANT"); }

beforeEach(() => {
  vi.resetAllMocks(); clearInMemoryChatGuards(); clearInMemoryRateLimits();
  vi.mocked(getAuthenticatedUser).mockResolvedValue(user);
  vi.mocked(prisma.doctor.findUnique).mockResolvedValue({ id: thread.doctorId } as never);
  vi.mocked(prisma.appointment.findFirst).mockResolvedValue({ id: "synthetic-appointment", status: "CONFIRMED" } as never);
  vi.mocked(prisma.medicalAiConversation.findUnique).mockResolvedValue(thread as never);
  vi.mocked(prisma.medicalDocument.findMany).mockResolvedValue([{ id: "synthetic-document" }] as never);
  vi.mocked(prisma.medicalAiMessage.create).mockImplementation(async (args) => ({ id: "synthetic-message", ...args.data }) as never);
  vi.mocked(prisma.medicalAiConversation.update).mockResolvedValue(thread as never);
});

describe("Medical response authorization and SSE boundary", () => {
  it("emits only the completed validated answer and saves one assistant turn", async () => {
    vi.mocked(openPatientMedicalChatStream).mockResolvedValue(stream(complete));
    const result = await streamMessage(request(), context);
    const text = await result.text();
    expect(text).toContain("event: token"); expect(text).toContain(answer); expect(text).toContain("event: done");
    expect(text).not.toContain("event: error");
    expect(assistantWrites()).toHaveLength(1);
    expect(assistantWrites()[0][0].data.content).toBe(answer);
    expect(openPatientMedicalChatStream).toHaveBeenCalledTimes(1);
    expect(prisma.appointment.findFirst).toHaveBeenCalledTimes(3);
  });

  it.each([
    event("token", { text: answer }),
    event("token", { text: answer })+event("error", { code: "provider_quota" }),
    complete+event("done", { answer, citations }),
  ])("withholds incomplete or failed upstream text and saves no partial assistant message", async (raw) => {
    vi.mocked(openPatientMedicalChatStream).mockResolvedValue(stream(raw));
    const text = await (await streamMessage(request(), context)).text();
    expect(text).toContain("event: error"); expect(text).not.toContain(answer);
    expect(text).not.toContain("event: token"); expect(text).not.toContain("event: done");
    expect(assistantWrites()).toHaveLength(0);
    expect(openPatientMedicalChatStream).toHaveBeenCalledTimes(1);
  });

  it("withholds all text when a completed answer cites another patient's document", async () => {
    vi.mocked(openPatientMedicalChatStream).mockResolvedValue(stream(complete));
    vi.mocked(prisma.medicalDocument.findMany).mockResolvedValue([]);
    const text = await (await streamMessage(request(), context)).text();
    expect(text).toContain("event: error"); expect(text).not.toContain(answer); expect(text).not.toContain("event: token");
    expect(assistantWrites()).toHaveLength(0);
  });

  it.each(["appointment", "account", "thread"])("withholds streaming evidence when %s access changes during inference", async (kind) => {
    vi.mocked(openPatientMedicalChatStream).mockImplementation(async () => {
      if (kind === "appointment") vi.mocked(prisma.appointment.findFirst).mockResolvedValue(null);
      if (kind === "account") vi.mocked(getAuthenticatedUser).mockResolvedValue(null);
      if (kind === "thread") vi.mocked(prisma.medicalAiConversation.findUnique).mockResolvedValue({ ...thread, doctorId: "another-doctor" } as never);
      return stream(complete);
    });
    const text = await (await streamMessage(request(), context)).text();
    expect(text).toContain("event: error"); expect(text).not.toContain(answer); expect(text).not.toContain("event: token");
    expect(assistantWrites()).toHaveLength(0);
  });

  it.each(["chat", "answer", "search"])("rechecks appointment authorization after the %s upstream call", async (kind) => {
    const revoke = () => vi.mocked(prisma.appointment.findFirst).mockResolvedValue(null);
    vi.mocked(generatePatientMedicalChat).mockImplementation(async () => { revoke(); return { answer, citations, resultCount: 1 }; });
    vi.mocked(generatePatientMedicalAnswer).mockImplementation(async () => { revoke(); return { answer, citations, resultCount: 1 }; });
    vi.mocked(searchPatientMedicalRecords).mockImplementation(async () => { revoke(); return { results: [] }; });
    const result = await (kind === "chat" ? sendMessage : kind === "answer" ? answerQuestion : searchRecords)(request(), context);
    expect(result.status).toBe(403);
    expect(await result.text()).not.toContain(answer);
    expect(assistantWrites()).toHaveLength(0);
  });
});
