import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { DELETE } from "@/app/api/doctors/me/patients/[patientId]/medical-chat/conversations/[conversationId]/route";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser } from "@/lib/auth";
import { deletePatientMedicalConversation } from "@/lib/search-sphere-client";
import { logAudit } from "@/lib/logger";

vi.mock("@/lib/auth", () => ({ getAuthenticatedUser: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: {
  doctor: { findUnique: vi.fn() }, appointment: { findFirst: vi.fn() },
  medicalAiConversation: { findUnique: vi.fn(), delete: vi.fn() },
} }));
vi.mock("@/lib/search-sphere-client", () => ({ deletePatientMedicalConversation: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logAudit: vi.fn(), logAccess: vi.fn() }));

const thread = { id: "synthetic-thread", doctorId: "synthetic-doctor", patientId: "synthetic-patient" };
const user = { id: "synthetic-user", role: "DOCTOR" };
const request = () => new NextRequest("https://example.com/api/medical-chat/conversations/synthetic-thread", { method: "DELETE" });
const call = () => DELETE(request(), { params: Promise.resolve({ patientId: thread.patientId, conversationId: thread.id }) });

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getAuthenticatedUser).mockResolvedValue(user as never);
  vi.mocked(prisma.doctor.findUnique).mockResolvedValue({ id: thread.doctorId } as never);
  vi.mocked(prisma.appointment.findFirst).mockResolvedValue({ id: "synthetic-completed-appointment" } as never);
  vi.mocked(prisma.medicalAiConversation.findUnique).mockResolvedValue(thread as never);
  vi.mocked(deletePatientMedicalConversation).mockResolvedValue();
});

describe("authorized medical conversation cleanup", () => {
  it("commits upstream cleanup before deleting the local thread and reporting success", async () => {
    vi.mocked(deletePatientMedicalConversation).mockImplementation(async () => {
      expect(prisma.medicalAiConversation.delete).not.toHaveBeenCalled();
    });
    const result = await call();
    expect(result.status).toBe(200);
    expect(deletePatientMedicalConversation).toHaveBeenCalledWith({
      patientId: thread.patientId, actorId: thread.doctorId, conversationId: thread.id,
    }, { signal: expect.any(AbortSignal) });
    expect(prisma.medicalAiConversation.delete).toHaveBeenCalledWith({ where: { id: thread.id } });
    expect(getAuthenticatedUser).toHaveBeenCalledTimes(2);
  });

  it("keeps the local thread on upstream failure and never exposes diagnostic contents", async () => {
    vi.mocked(deletePatientMedicalConversation).mockRejectedValue(new Error("PRIVATE diagnostic and server credential"));
    const result = await call();
    expect(result.status).toBe(503);
    expect(await result.text()).not.toContain("PRIVATE");
    expect(prisma.medicalAiConversation.delete).not.toHaveBeenCalled();
    expect(logAudit).not.toHaveBeenCalled();
  });

  it.each(["patient", "doctor"])("withholds cleanup for a foreign %s thread", async (dimension) => {
    vi.mocked(prisma.medicalAiConversation.findUnique).mockResolvedValue({ ...thread,
      [dimension === "doctor" ? "doctorId" : "patientId"]: "foreign",
    } as never);
    expect((await call()).status).toBe(dimension === "doctor" ? 403 : 400);
    expect(deletePatientMedicalConversation).not.toHaveBeenCalled();
    expect(prisma.medicalAiConversation.delete).not.toHaveBeenCalled();
  });

  it.each(["role", "appointment", "thread"])("rechecks %s access after upstream cleanup", async (dimension) => {
    vi.mocked(deletePatientMedicalConversation).mockImplementation(async () => {
      if (dimension === "role") vi.mocked(getAuthenticatedUser).mockResolvedValue({ ...user, role: "PATIENT" } as never);
      if (dimension === "appointment") vi.mocked(prisma.appointment.findFirst).mockResolvedValue(null);
      if (dimension === "thread") vi.mocked(prisma.medicalAiConversation.findUnique).mockResolvedValue(null);
    });
    expect((await call()).status).toBe(403);
    expect(prisma.medicalAiConversation.delete).not.toHaveBeenCalled();
  });

  it("allows an explicit retry after a lost upstream response", async () => {
    vi.mocked(deletePatientMedicalConversation).mockRejectedValueOnce(new Error("lost response")).mockResolvedValueOnce();
    expect((await call()).status).toBe(503);
    expect(prisma.medicalAiConversation.delete).not.toHaveBeenCalled();
    expect((await call()).status).toBe(200);
    expect(prisma.medicalAiConversation.delete).toHaveBeenCalledTimes(1);
  });
});
