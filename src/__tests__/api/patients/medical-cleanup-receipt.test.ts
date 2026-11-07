import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/patients/me/medical-documents/[documentId]/cleanup/route";
import { getAuthenticatedUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getMedicalDocumentCleanupReceipt, SearchSphereServiceError } from "@/lib/search-sphere-client";

vi.mock("@/lib/auth", () => ({ getAuthenticatedUser: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { patient: { findUnique: vi.fn() } } }));
vi.mock("@/lib/search-sphere-client", async (original) => ({ ...await original<typeof import("@/lib/search-sphere-client")>(), getMedicalDocumentCleanupReceipt: vi.fn() }));

const receipt = { documentId: "synthetic-document", status: "complete", vectorsRemaining: 0, derivedObjectsRemaining: 0, objectDeleted: true };
const request = () => new NextRequest("https://example.invalid/api/patients/me/medical-documents/synthetic-document/cleanup?patientId=forged-patient", {
  headers: { "X-Subject-ID": "forged-patient", "X-Tenant-ID": "forged-tenant" },
});
const context = { params: Promise.resolve({ documentId: "synthetic-document" }) };
type AuthUser = NonNullable<Awaited<ReturnType<typeof getAuthenticatedUser>>>;
type PatientProfile = NonNullable<Awaited<ReturnType<typeof prisma.patient.findUnique>>>;

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getAuthenticatedUser).mockResolvedValue({ id: "synthetic-user", role: "PATIENT" } as AuthUser);
  vi.mocked(prisma.patient.findUnique).mockResolvedValue({ id: "authorized-patient" } as PatientProfile);
  vi.mocked(getMedicalDocumentCleanupReceipt).mockResolvedValue({ ...receipt, status: "complete" });
});

describe("Patient cleanup receipt route", () => {
  it("works after metadata deletion and ignores forged browser scope", async () => {
    const req = request();
    const response = await GET(req, context);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect((await response.json()).cleanup).toEqual(receipt);
    expect(getAuthenticatedUser).toHaveBeenCalledWith(req, { verifyDb: true });
    expect(getMedicalDocumentCleanupReceipt).toHaveBeenCalledWith("synthetic-document", expect.objectContaining({ subjectId: "authorized-patient", signal: req.signal }));
  });
  it.each([null, { id: "doctor", role: "DOCTOR" }])("rejects missing or unintended identity %j without upstream work", async (user) => {
    vi.mocked(getAuthenticatedUser).mockResolvedValue(user as AuthUser | null);
    expect((await GET(request(), context)).status).toBe(user ? 403 : 401);
    expect(getMedicalDocumentCleanupReceipt).not.toHaveBeenCalled();
  });
  it("rejects a missing patient profile without querying arbitrary scope", async () => {
    vi.mocked(prisma.patient.findUnique).mockResolvedValue(null);
    expect((await GET(request(), context)).status).toBe(404);
    expect(getMedicalDocumentCleanupReceipt).not.toHaveBeenCalled();
  });
  it.each([403, 404, 503])("preserves denial/failure for upstream HTTP %s without diagnostic leakage", async (status) => {
    vi.mocked(getMedicalDocumentCleanupReceipt).mockRejectedValue(new SearchSphereServiceError(status, "PRIVATE DIAGNOSTIC"));
    const response = await GET(request(), context);
    expect(response.status).toBe(status === 503 ? 503 : 404);
    const payload = await response.json();
    expect(payload.cleanup).toBeUndefined();
    expect(JSON.stringify(payload)).not.toContain("PRIVATE");
  });
});
