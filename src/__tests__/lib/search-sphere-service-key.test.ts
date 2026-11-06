import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generatePatientMedicalAnswer, generatePatientMedicalChat, medicalChatFailure, SearchSphereServiceError, searchPatientMedicalRecords, openPatientMedicalChatStream, patientCollectionId } from "@/lib/search-sphere-client";
import { getOrCreateRequestId } from "@/lib/correlation-id";

describe("Search-Sphere service key and scope contract", () => {
  beforeEach(() => {
    vi.stubEnv("SEARCH_SPHERE_API_URL", "http://example.invalid");
    vi.stubEnv("SEARCH_SPHERE_API_KEY", "synthetic-service-key");
    vi.stubEnv("SEARCH_SPHERE_SERVICE_SECRET", "synthetic-legacy-secret");
    vi.stubEnv("SEARCH_SPHERE_CLIENT_ID", "quick_clinic");
    vi.stubEnv("SEARCH_SPHERE_TENANT_ID", "quick_clinic_default");
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  it("prefers the service key and derives scope from the authorized patient", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ results: [] })));
    vi.stubGlobal("fetch", fetch);
    await searchPatientMedicalRecords({ patientId: "synthetic-patient-a", query: "HbA1c" });
    expect(fetch.mock.calls[0][1].headers).toMatchObject({ Authorization: "Bearer synthetic-service-key", "X-Client-ID": "quick_clinic", "X-Tenant-ID": "quick_clinic_default", "X-Subject-ID": "synthetic-patient-a", "X-Collection-ID": patientCollectionId("synthetic-patient-a") });
    expect(patientCollectionId("a/b")).toMatch(/^patient_[a-f0-9]{32}_records$/);
    expect(patientCollectionId("a/b")).not.toBe(patientCollectionId("a_b"));
  });

  it.each([400, 401, 403, 404])("does not retry status %s or expose upstream secrets", async (status) => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail: "private-host synthetic-private-token" }), { status }));
    vi.stubGlobal("fetch", fetch);
    await expect(generatePatientMedicalAnswer({ patientId: "synthetic-a", query: "glucose" })).rejects.toThrow(`(${status})`);
    expect(fetch).toHaveBeenCalledTimes(1);
    try { await generatePatientMedicalAnswer({ patientId: "synthetic-a", query: "glucose" }); } catch (error) { expect(String(error)).not.toMatch(/private-host|private-token/); }
  });

  it("bounds transient retries", async () => {
    const fetch = vi.fn().mockImplementation(() => Promise.resolve(new Response("unavailable", { status: 503 })));
    vi.stubGlobal("fetch", fetch);
    await expect(searchPatientMedicalRecords({ patientId: "synthetic-a", query: "glucose" })).rejects.toThrow("503");
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("forwards incremental SSE bytes and closes the response", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({ start(controller) { controller.enqueue(encoder.encode('data: {"type":"token","text":"7.4"}\n\n')); controller.enqueue(encoder.encode('data: {"type":"citations","citations":[]}\n\ndata: [DONE]\n\n')); controller.close(); } });
    const fetch = vi.fn().mockResolvedValue(new Response(stream, { headers: { "Content-Type": "text/event-stream" } }));
    vi.stubGlobal("fetch", fetch);
    const response = await openPatientMedicalChatStream({ actorId: "synthetic-doctor", patientId: "synthetic-a", message: "HbA1c?" });
    const reader = response.body!.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toContain("token");
    expect(new TextDecoder().decode((await reader.read()).value)).toContain("citations");
    expect((await reader.read()).done).toBe(true);
    expect(new Headers(fetch.mock.calls[0][1].headers).get("X-Subject-ID")).toBe("synthetic-a");
  });

  it("passes disconnect signals to upstream streaming", async () => {
    const controller = new AbortController();
    const fetch = vi.fn().mockRejectedValue(new DOMException("Aborted", "AbortError"));
    vi.stubGlobal("fetch", fetch);
    controller.abort();
    await expect(openPatientMedicalChatStream({ actorId: "synthetic-doctor", patientId: "synthetic-a", message: "glucose?" }, { signal: controller.signal })).rejects.toThrow("Aborted");
    expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
  });

  it("delegates the doctor and thread without forwarding copied history", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ answer: "Synthetic answer", citations: [] })));
    vi.stubGlobal("fetch", fetch);
    await generatePatientMedicalChat({ patientId: "synthetic-a", actorId: "doctor-a", conversationId: "thread-a", message: "Public question", history: [{ role: "assistant", content: "PRIVATE LEGACY HISTORY" }] });
    const init = fetch.mock.calls[0][1];
    expect(new Headers(init.headers).get("X-Actor-ID")).toBe("doctor-a");
    expect(JSON.parse(init.body)).toMatchObject({ patientId: "synthetic-a", conversationId: "thread-a" });
    expect(init.body).not.toContain("PRIVATE LEGACY HISTORY");
    expect(JSON.parse(init.body)).not.toHaveProperty("history");
  });

  it("rejects a missing doctor before sending a request", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    await expect(generatePatientMedicalChat({ patientId: "synthetic-a", actorId: "", message: "Public" })).rejects.toThrow("doctor identity");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("never retries a failed generation and returns only safe provider codes", async () => {
    const fetch = vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ error_code: "provider_quota", detail: "PRIVATE TOKEN" }), { status: 503 })));
    vi.stubGlobal("fetch", fetch);
    try {
      await generatePatientMedicalChat({ patientId: "synthetic-a", actorId: "doctor-a", message: "Public" });
      throw new Error("Failure required");
    } catch (error) {
      expect(error).toBeInstanceOf(SearchSphereServiceError);
      expect(medicalChatFailure(error)).toEqual({ status: 503, code: "provider_quota" });
      expect(String(error)).not.toContain("PRIVATE TOKEN");
    }
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("replaces patient-like correlation IDs with random UUIDs", () => {
    const request = new Request("http://example.invalid", { headers: { "X-Request-ID": "synthetic-patient-a" } });
    expect(getOrCreateRequestId(request)).toMatch(/^[0-9a-f-]{36}$/);
  });
});
