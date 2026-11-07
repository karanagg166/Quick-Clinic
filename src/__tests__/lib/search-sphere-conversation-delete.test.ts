import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deletePatientMedicalConversation, patientCollectionId } from "@/lib/search-sphere-client";

const params = { patientId: "synthetic-patient", actorId: "synthetic-doctor", conversationId: "synthetic-thread" };
beforeEach(() => {
  vi.stubEnv("SEARCH_SPHERE_API_URL", "https://synthetic-api.example.com");
  vi.stubEnv("SEARCH_SPHERE_API_KEY", "synthetic-test-only-key");
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ deleted: true })));
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); });

describe("scoped upstream conversation deletion", () => {
  it("uses the authenticated doctor/patient/thread, one request, no body and no redirects", async () => {
    await deletePatientMedicalConversation(params, { retries: 7, subjectId: "forged-option" });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith("https://synthetic-api.example.com/internal/medical-rag/conversations/synthetic-thread", expect.objectContaining({
      method: "DELETE", redirect: "error", headers: expect.objectContaining({
        Authorization: "Bearer synthetic-test-only-key", "X-Actor-ID": params.actorId,
        "X-Subject-ID": params.patientId, "X-Collection-ID": patientCollectionId(params.patientId),
        "X-Client-ID": "quick_clinic", "X-Tenant-ID": "quick_clinic_default",
      }),
    }));
  });

  it.each([{}, { deleted: false }, { deleted: "true" }, [], null])("rejects an unverified receipt %j", async (value) => {
    vi.mocked(fetch).mockResolvedValue(Response.json(value));
    await expect(deletePatientMedicalConversation(params)).rejects.toThrow("cleanup is not verified");
  });

  it.each([401, 403, 404, 503])("fails closed on HTTP %s without retrying", async (status) => {
    vi.mocked(fetch).mockResolvedValue(Response.json({ deleted: true, detail: "PRIVATE diagnostic" }, { status }));
    await expect(deletePatientMedicalConversation(params, { retries: 7 })).rejects.toThrow("cleanup is not verified");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("rejects an oversized or malformed receipt", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(" ".repeat(1025))).mockResolvedValueOnce(new Response("{"));
    await expect(deletePatientMedicalConversation(params)).rejects.toThrow("cleanup is not verified");
    await expect(deletePatientMedicalConversation(params)).rejects.toThrow("cleanup is not verified");
  });

  it("bounds a stalled receipt body after successful response headers", async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    vi.mocked(fetch).mockResolvedValue(new Response(new ReadableStream({ cancel })));
    const outcome = expect(deletePatientMedicalConversation(params)).rejects.toThrow("cleanup is not verified");
    await vi.advanceTimersByTimeAsync(2001);
    await outcome;
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it.each([{ ...params, actorId: "" }, { ...params, conversationId: " " }, { ...params, patientId: "" }])("rejects invalid server-derived identities before fetch", async (value) => {
    await expect(deletePatientMedicalConversation(value)).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
});
