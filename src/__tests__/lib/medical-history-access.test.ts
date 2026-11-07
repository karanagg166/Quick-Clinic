import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authorizedMedicalHistory } from "@/lib/medical-history-access";
import { prisma } from "@/lib/prisma";
import { getMedicalDocumentProcessingStatus } from "@/lib/search-sphere-client";

vi.mock("@/lib/prisma", () => ({ prisma: { medicalDocument: { findMany: vi.fn() } } }));
vi.mock("@/lib/search-sphere-client", () => ({ getMedicalDocumentProcessingStatus: vi.fn() }));
const citation = { documentId: "synthetic-document", versionId: "published-version", citationId: 1 };
const assistant = { id: "assistant", role: "ASSISTANT", status: "COMPLETE", content: "PUBLIC SYNTHETIC answer [1].", citations: [citation] };
const question = { id: "question", role: "USER", status: "COMPLETE", content: "What is the marker?", citations: null };
const current = { documentId: citation.documentId, currentVersionId: citation.versionId, status: "READY", processedAt: null, error: null };
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(prisma.medicalDocument.findMany).mockResolvedValue([{ id: citation.documentId }] as never);
  vi.mocked(getMedicalDocumentProcessingStatus).mockResolvedValue(current);
});

afterEach(() => vi.useRealTimers());

describe("cached medical evidence authorization", () => {
  it("preserves a currently owned, published source version and the user question", async () => {
    const result = await authorizedMedicalHistory("synthetic-patient", [question, assistant]);
    expect(result).toEqual([question, assistant]);
    expect(getMedicalDocumentProcessingStatus).toHaveBeenCalledWith(citation.documentId, expect.objectContaining({
      subjectId: "synthetic-patient", retries: 0, timeoutMs: 3000, signal: expect.any(AbortSignal),
    }));
    expect(prisma.medicalDocument.findMany).toHaveBeenCalledTimes(2);
  });

  it.each(["missing-local", "deleted-during-read", "new-version", "failed-index", "missing-version", "wrong-document", "outage"])("withholds saved evidence when %s", async (condition) => {
    if (condition === "missing-local") vi.mocked(prisma.medicalDocument.findMany).mockResolvedValue([]);
    if (condition === "deleted-during-read") vi.mocked(prisma.medicalDocument.findMany).mockResolvedValueOnce([{ id: citation.documentId }] as never).mockResolvedValueOnce([]);
    if (condition === "new-version") vi.mocked(getMedicalDocumentProcessingStatus).mockResolvedValue({ ...current, currentVersionId: "replacement-version" });
    if (condition === "failed-index") vi.mocked(getMedicalDocumentProcessingStatus).mockResolvedValue({ ...current, status: "FAILED" });
    if (condition === "missing-version") vi.mocked(getMedicalDocumentProcessingStatus).mockResolvedValue({ ...current, currentVersionId: null });
    if (condition === "wrong-document") vi.mocked(getMedicalDocumentProcessingStatus).mockResolvedValue({ ...current, documentId: "other-document" });
    if (condition === "outage") vi.mocked(getMedicalDocumentProcessingStatus).mockRejectedValue(new Error("PRIVATE diagnostic"));
    const [result] = await authorizedMedicalHistory("synthetic-patient", [assistant]);
    expect(result.content).not.toContain("PUBLIC SYNTHETIC");
    expect(result.content).not.toContain("PRIVATE");
    expect(result.citations).toEqual([]);
    expect(result.status).toBe("FAILED");
  });

  it.each([null, [], {}, [{ documentId: citation.documentId }], [{ ...citation, versionId: "" }]])("withholds legacy or malformed references %j without a metadata request", async (citations) => {
    const [result] = await authorizedMedicalHistory("synthetic-patient", [{ ...assistant, citations }]);
    expect(result.status).toBe("FAILED");
    expect(getMedicalDocumentProcessingStatus).not.toHaveBeenCalled();
  });

  it("deduplicates document checks across messages and rejects mismatched versions separately", async () => {
    const result = await authorizedMedicalHistory("synthetic-patient", [assistant, { ...assistant, citations: [{ ...citation, versionId: "old-version" }] }]);
    expect(result[0].status).toBe("COMPLETE");
    expect(result[1].status).toBe("FAILED");
    expect(getMedicalDocumentProcessingStatus).toHaveBeenCalledTimes(1);
  });

  it("withholds histories that exceed the bounded document count", async () => {
    const messages = Array.from({ length: 21 }, (_, i) => ({ ...assistant, citations: [{ ...citation, documentId: `synthetic-${i}` }] }));
    const result = await authorizedMedicalHistory("synthetic-patient", messages);
    expect(result.every((message) => message.status === "FAILED")).toBe(true);
    expect(getMedicalDocumentProcessingStatus).not.toHaveBeenCalled();
  });

  it("uses at most three concurrent metadata reads", async () => {
    let active = 0, peak = 0;
    const messages = Array.from({ length: 7 }, (_, i) => ({ ...assistant, citations: [{ ...citation, documentId: `synthetic-${i}` }] }));
    vi.mocked(prisma.medicalDocument.findMany).mockResolvedValue(messages.map((m) => ({ id: m.citations[0].documentId })) as never);
    vi.mocked(getMedicalDocumentProcessingStatus).mockImplementation(async (id) => {
      active++; peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active--;
      return { ...current, documentId: id };
    });
    expect((await authorizedMedicalHistory("synthetic-patient", messages)).every((m) => m.status === "COMPLETE")).toBe(true);
    expect(peak).toBe(3);
  });
  it("aborts stalled response bodies at the shared history deadline", async () => {
    vi.useFakeTimers();
    vi.mocked(getMedicalDocumentProcessingStatus).mockImplementation((_id, options) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    }));
    const result = authorizedMedicalHistory("synthetic-patient", [assistant]);
    await vi.advanceTimersByTimeAsync(8001);
    expect((await result)[0].status).toBe("FAILED");
  });

});
