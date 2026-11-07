import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/doctors/me/patients/[patientId]/medical-chat/conversations/[conversationId]/route";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser } from "@/lib/auth";
import { getMedicalDocumentProcessingStatus } from "@/lib/search-sphere-client";

vi.mock("@/lib/auth", () => ({ getAuthenticatedUser: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: {
  doctor: { findUnique: vi.fn() }, appointment: { findFirst: vi.fn() },
  medicalDocument: { findMany: vi.fn() }, medicalAiConversation: { findUnique: vi.fn() },
} }));
vi.mock("@/lib/search-sphere-client", () => ({ getMedicalDocumentProcessingStatus: vi.fn(), deletePatientMedicalConversation: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logAudit: vi.fn(), logAccess: vi.fn() }));
const patientId = "synthetic-patient", conversationId = "synthetic-thread";
const message = { id: "synthetic-message", role: "ASSISTANT", status: "COMPLETE", content: "PUBLIC SYNTHETIC ANSWER [1].", citations: [{ documentId: "synthetic-document", versionId: "version-one", citationId: 1 }] };
const thread = { id: conversationId, doctorId: "synthetic-doctor", patientId, messages: [message] };
const user = { id: "synthetic-user", role: "DOCTOR" };
const call = () => GET(new NextRequest("https://example.com/api/medical-chat"), { params: Promise.resolve({ patientId, conversationId }) });
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getAuthenticatedUser).mockResolvedValue(user as never);
  vi.mocked(prisma.doctor.findUnique).mockResolvedValue({ id: thread.doctorId } as never);
  vi.mocked(prisma.appointment.findFirst).mockResolvedValue({ id: "completed-appointment" } as never);
  vi.mocked(prisma.medicalAiConversation.findUnique).mockResolvedValue(thread as never);
  vi.mocked(prisma.medicalDocument.findMany).mockResolvedValue([{ id: "synthetic-document" }] as never);
  vi.mocked(getMedicalDocumentProcessingStatus).mockResolvedValue({ documentId: "synthetic-document", currentVersionId: "version-one", status: "READY", processedAt: null, error: null });
});

describe("medical history response authorization", () => {
  it("returns a currently authorized source version after refreshing doctor access", async () => {
    const result = await call();
    expect(result.status).toBe(200);
    expect((await result.json()).messages[0].content).toBe(message.content);
    expect(getAuthenticatedUser).toHaveBeenCalledTimes(2);
  });

  it("withholds old assistant text/citations after source deletion", async () => {
    vi.mocked(prisma.medicalDocument.findMany).mockResolvedValue([]);
    const result = await call();
    expect(result.status).toBe(200);
    const body = await result.json();
    expect(body.messages[0].content).not.toContain("PUBLIC SYNTHETIC ANSWER");
    expect(body.messages[0].citations).toEqual([]);
    expect(body.messages[0].status).toBe("FAILED");
    expect(getMedicalDocumentProcessingStatus).not.toHaveBeenCalled();
  });

  it.each(["role", "appointment", "thread"])("withholds the whole response after %s access changes during metadata reads", async (dimension) => {
    vi.mocked(getMedicalDocumentProcessingStatus).mockImplementation(async () => {
      if (dimension === "role") vi.mocked(getAuthenticatedUser).mockResolvedValue({ ...user, role: "PATIENT" } as never);
      if (dimension === "appointment") vi.mocked(prisma.appointment.findFirst).mockResolvedValue(null);
      if (dimension === "thread") vi.mocked(prisma.medicalAiConversation.findUnique).mockResolvedValue(null);
      return { documentId: "synthetic-document", currentVersionId: "version-one", status: "READY", processedAt: null, error: null };
    });
    const result = await call();
    expect(result.status).toBe(403);
    expect(await result.text()).not.toContain("PUBLIC SYNTHETIC ANSWER");
  });
});
