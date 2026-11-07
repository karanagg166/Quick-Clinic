import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getMedicalDocumentCleanupReceipt, patientCollectionId } from "@/lib/search-sphere-client";

const valid = { document_id: "synthetic-document", status: "complete", vectors_remaining: 0, derived_objects_remaining: 0, object_deleted: true };

beforeEach(() => {
  vi.stubEnv("SEARCH_SPHERE_API_URL", "https://example.invalid");
  vi.stubEnv("SEARCH_SPHERE_API_KEY", "synthetic-server-credential");
  vi.stubEnv("SEARCH_SPHERE_TENANT_ID", "quick_clinic_default");
  vi.stubEnv("SEARCH_SPHERE_CLIENT_ID", "quick_clinic");
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("Scoped physical cleanup receipts", () => {
  it("derives patient headers and returns only validated public receipt fields", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ ...valid, storage_key: "PRIVATE STORAGE", diagnostic: "PRIVATE DIAGNOSTIC" })));
    vi.stubGlobal("fetch", fetch);
    const result = await getMedicalDocumentCleanupReceipt("synthetic-document", { subjectId: "synthetic-patient" });
    expect(result).toEqual({ documentId: "synthetic-document", status: "complete", vectorsRemaining: 0, derivedObjectsRemaining: 0, objectDeleted: true });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]).toEqual([
      "https://example.invalid/api/v1/documents/synthetic-document/cleanup",
      expect.objectContaining({ method: "GET", cache: "no-store", headers: expect.objectContaining({
        "X-Subject-ID": "synthetic-patient", "X-Collection-ID": patientCollectionId("synthetic-patient"),
        "X-Tenant-ID": "quick_clinic_default", "Authorization": "Bearer synthetic-server-credential",
      }) }),
    ]);
    expect(JSON.stringify(result)).not.toContain("PRIVATE");
  });

  it.each([undefined, "", "  ", "patient\ninjected"])("requires explicit verified subject before any network call (%s)", async (subjectId) => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    await expect(getMedicalDocumentCleanupReceipt("synthetic-document", { subjectId })).rejects.toThrow("patient scope is required");
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([403, 404, 503])("never treats HTTP %s as completed cleanup or retries implicitly", async (status) => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ detail: "PRIVATE DIAGNOSTIC" }), { status }));
    vi.stubGlobal("fetch", fetch);
    await expect(getMedicalDocumentCleanupReceipt("synthetic-document", { subjectId: "synthetic-patient", retries: 5 })).rejects.toThrow("cleanup is not verified");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    {}, { ...valid, document_id: "other-document" }, { ...valid, vectors_remaining: 1 },
    { ...valid, derived_objects_remaining: 1 }, { ...valid, object_deleted: false },
    { ...valid, vectors_remaining: "0" }, { ...valid, vectors_remaining: -1 },
    { ...valid, derived_objects_remaining: 0.5 }, { ...valid, status: "unknown" },
  ])("rejects inconsistent or malformed receipt %j", async (receipt) => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(receipt))));
    await expect(getMedicalDocumentCleanupReceipt("synthetic-document", { subjectId: "synthetic-patient" })).rejects.toThrow("Invalid document cleanup receipt");
  });

  it("preserves a pending cleanup without claiming success", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ...valid, status: "pending", object_deleted: false }))));
    expect(await getMedicalDocumentCleanupReceipt("synthetic-document", { subjectId: "synthetic-patient" })).toMatchObject({ status: "pending", objectDeleted: false });
  });
});
