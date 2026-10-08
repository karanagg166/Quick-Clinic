import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { SignJWT } from "jose";
import { createToken, getAuthenticatedUser, verifyToken } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { GET, PUT, PATCH } from "@/app/api/patients/[patientId]/route";
import { GET as balance } from "@/app/api/doctors/[doctorId]/balance/route";
import { GET as doctorDocument } from "@/app/api/doctors/me/patients/[patientId]/medical-documents/[documentId]/access/route";
import { GET as patientDocument } from "@/app/api/patients/me/medical-documents/[documentId]/access/route";
import { GET as listPatients, PATCH as updatePatient, POST as createPatient } from "@/app/api/patients/route";
import { POST as rate } from "@/app/api/doctors/[doctorId]/rating/route";
import { POST as comment } from "@/app/api/doctors/[doctorId]/comments/route";
import { GET as adminUsers } from "@/app/api/admin/users/route";
import { getAuthenticatedPatient } from "@/lib/request-auth";
import { getSignedStorageUrl } from "@/lib/search-sphere-client";
import { middleware } from "../../../middleware";

vi.mock("@/lib/prisma", () => ({ prisma: {
  user: { findUnique: vi.fn(), create: vi.fn(), findFirst: vi.fn(), update: vi.fn(), count: vi.fn(), findMany: vi.fn() },
  patient: { findUnique: vi.fn(), update: vi.fn(), findMany: vi.fn(), create: vi.fn() },
  doctor: { findUnique: vi.fn() },
  appointment: { findFirst: vi.fn(), findMany: vi.fn() },
  medicalDocument: { findFirst: vi.fn(), findUnique: vi.fn() },
  doctorPatientRelation: { findUnique: vi.fn() },
  chatMessages: { create: vi.fn() },
  slot: { findMany: vi.fn(), updateMany: vi.fn() },
  notification: { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn(), delete: vi.fn() },
  otp: { findFirst: vi.fn(), deleteMany: vi.fn() },
  rating: { upsert: vi.fn() }, comment: { create: vi.fn() },
} }));
vi.mock("@/lib/logger", () => ({ logAccess: vi.fn(), logAudit: vi.fn() }));
vi.mock("@/lib/search-sphere-client", () => ({ getSignedStorageUrl: vi.fn() }));

const context = { params: Promise.resolve({ patientId: "patient-b" }) };
const profile = { id: "patient-b", userId: "user-b", allergies: "None", user: { id: "user-b", name: "B" } };
const methods = { GET, PUT, PATCH };
function request(token?: string, method = "GET", body?: object, path = "/api/patients/patient-b") {
  return new NextRequest(`http://localhost${path}`, {
    method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), "content-type": "application/json" },
    ...(method !== "GET" ? { body: JSON.stringify(body ?? { allergies: "Updated" }) } : {}),
  });
}
async function signed(payload: Record<string, unknown>, expiration?: number) {
  let jwt = new SignJWT(payload).setProtectedHeader({ alg: "HS256" });
  if (expiration !== undefined) jwt = jwt.setExpirationTime(expiration);
  return jwt.sign(new TextEncoder().encode(process.env.JWT_SECRET));
}
function dbUser(id = "user-a", role = "PATIENT", isActive = true) {
  vi.mocked(prisma.user.findUnique).mockResolvedValue({ id, role, isActive, email: "user@example.test", name: "User" } as never);
}

beforeEach(() => {
  vi.resetAllMocks();
  dbUser();
  vi.mocked(prisma.patient.findUnique).mockResolvedValue(profile as never);
  vi.mocked(prisma.patient.update).mockResolvedValue(profile as never);
  vi.mocked(prisma.doctor.findUnique).mockResolvedValue({ id: "doctor-a", userId: "doctor-user-a" } as never);
  vi.mocked(prisma.appointment.findFirst).mockResolvedValue(null);
});

describe("Patient profile authentication and IDOR: real JWTs and handlers", () => {
  for (const [method, handler] of Object.entries(methods)) {
    describe(method, () => {
      it.each(["missing", "invalid", "expired", "no-id", "no-role", "non-string-id", "conflicting-ids", "no-exp"])("rejects %s credentials before resource queries", async (kind) => {
        const token = kind === "missing" ? undefined : kind === "invalid" ? "bad.jwt.token"
          : await signed({ ...(kind === "no-id" ? {} : { id: kind === "non-string-id" ? 42 : "user-a" }),
              ...(kind === "no-role" ? {} : { role: "PATIENT" }),
              ...(kind === "conflicting-ids" ? { userId: "user-b" } : {}) },
            kind === "no-exp" ? undefined : Math.floor(Date.now() / 1000) + (kind === "expired" ? -60 : 3600));
        expect((await handler(request(token, method), context)).status).toBe(401);
        expect(prisma.patient.findUnique).not.toHaveBeenCalled();
        expect(prisma.patient.update).not.toHaveBeenCalled();
      });
      it.each(["deleted", "disabled", "forged-admin", "changed-role"])("rejects %s database identity", async (kind) => {
        const role = kind === "forged-admin" || kind === "changed-role" ? "ADMIN" : "PATIENT";
        const token = await createToken({ id: "user-a", role });
        if (kind === "deleted") vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
        else dbUser("user-a", "PATIENT", kind !== "disabled");
        expect((await handler(request(token, method), context)).status).toBe(401);
        expect(prisma.patient.findUnique).not.toHaveBeenCalled();
      });
      it("rejects Patient A accessing Patient B, including forged body identity", async () => {
        const token = await createToken({ id: "user-a", role: "PATIENT" });
        expect((await handler(request(token, method, { userId: "user-b", patientId: "patient-b", role: "ADMIN" }), context)).status).toBe(403);
        expect(prisma.patient.update).not.toHaveBeenCalled();
      });
      it.each(["PATIENT", "ADMIN"])("allows authorized %s", async (role) => {
        dbUser("user-b", role);
        const token = await createToken({ id: "user-b", role });
        expect((await handler(request(token, method), context)).status).toBe(200);
        expect(prisma.user.findUnique).toHaveBeenCalledWith(expect.objectContaining({ select: expect.objectContaining({ isActive: true, role: true }) }));
      });
    });
  }
  it("denies unrelated doctor and permits only a qualifying clinical relationship for reads", async () => {
    dbUser("doctor-user-a", "DOCTOR");
    const token = await createToken({ id: "doctor-user-a", role: "DOCTOR" });
    expect((await GET(request(token), context)).status).toBe(403);
    expect(prisma.appointment.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { doctorId: "doctor-a", patientId: "patient-b", status: { in: ["CONFIRMED", "COMPLETED"] } } }));
    vi.mocked(prisma.appointment.findFirst).mockResolvedValue({ id: "appointment", status: "COMPLETED" } as never);
    expect((await GET(request(token), context)).status).toBe(200);
    expect((await PATCH(request(token, "PATCH"), context)).status).toBe(403);
  });
  it("selects permitted user fields without credentials", async () => {
    dbUser("user-b");
    await GET(request(await createToken({ id: "user-b", role: "PATIENT" })), context);
    const query = vi.mocked(prisma.patient.findUnique).mock.calls[0][0];
    expect(query?.include?.user).toHaveProperty("select");
    expect(query?.include?.user).not.toHaveProperty("select.password");
  });
});

describe("Doctor, admin and medical-resource authorization", () => {
  it("denies another doctor's balance and unauthenticated requests", async () => {
    const ctx = { params: Promise.resolve({ doctorId: "doctor-a" }) };
    expect((await balance(request(), ctx)).status).toBe(401);
    dbUser("doctor-user-b", "DOCTOR");
    expect((await balance(request(await createToken({ id: "doctor-user-b", role: "DOCTOR" })), ctx)).status).toBe(403);
  });
  it("denies unrelated doctor document access before contacting Search-Sphere", async () => {
    dbUser("doctor-user-a", "DOCTOR");
    const res = await doctorDocument(request(await createToken({ id: "doctor-user-a", role: "DOCTOR" })), { params: Promise.resolve({ patientId: "patient-b", documentId: "document-b" }) });
    expect(res.status).toBe(403);
    expect(prisma.medicalDocument.findFirst).not.toHaveBeenCalled();
    expect(getSignedStorageUrl).not.toHaveBeenCalled();
  });
  it("denies a mismatched document even for a related doctor", async () => {
    dbUser("doctor-user-a", "DOCTOR");
    vi.mocked(prisma.appointment.findFirst).mockResolvedValue({ id: "appointment" } as never);
    vi.mocked(prisma.medicalDocument.findFirst).mockResolvedValue(null);
    expect((await doctorDocument(request(await createToken({ id: "doctor-user-a", role: "DOCTOR" })), { params: Promise.resolve({ patientId: "patient-b", documentId: "document-c" }) })).status).toBe(404);
    expect(prisma.medicalDocument.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "document-c", patientId: "patient-b" } }));
    expect(getSignedStorageUrl).not.toHaveBeenCalled();
  });
  it("scopes patient document lookup to authenticated patient", async () => {
    vi.mocked(prisma.patient.findUnique).mockResolvedValue({ id: "patient-a", userId: "user-a" } as never);
    vi.mocked(prisma.medicalDocument.findUnique).mockResolvedValue({ id: "document-b", patientId: "patient-b" } as never);
    expect((await patientDocument(request(await createToken({ id: "user-a", role: "PATIENT" })), { params: Promise.resolve({ documentId: "document-b" }) })).status).toBe(404);
    expect(prisma.patient.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: "user-a" } }));
    expect(getSignedStorageUrl).not.toHaveBeenCalled();
  });
  it("admin endpoint rejects forged database role and allows current admin", async () => {
    const token = await createToken({ id: "user-a", role: "ADMIN" });
    expect((await adminUsers(request(token))).status).toBe(401);
    dbUser("user-a", "ADMIN");
    vi.mocked(prisma.user.count).mockResolvedValue(0);
    vi.mocked(prisma.user.findMany).mockResolvedValue([]);
    expect((await adminUsers(request(token))).status).toBe(200);
  });
});

describe("Client-controlled identity bypasses", () => {
  it("denies collection profile writes targeting another patient", async () => {
    const token = await createToken({ id: "user-a", role: "PATIENT" });
    expect((await updatePatient(request(token, "PATCH", { patientId: "patient-b", role: "ADMIN" }))).status).toBe(403);
    expect((await createPatient(request(token, "POST", { userId: "user-b", role: "ADMIN" }))).status).toBe(403);
    expect(prisma.patient.update).not.toHaveBeenCalled();
    expect(prisma.patient.create).not.toHaveBeenCalled();
  });
  it.each(["?doctorId=doctor-b", "?doctorId=doctor-a&scope=all", "?doctorId=doctor-a&all=true"])("denies doctor list scope bypass %s", async (query) => {
    dbUser("doctor-user-a", "DOCTOR");
    expect((await listPatients(request(await createToken({ id: "doctor-user-a", role: "DOCTOR" }), "GET", undefined, `/api/patients${query}`))).status).toBe(403);
    expect(prisma.patient.findMany).not.toHaveBeenCalled();
  });
  it.each([rate, comment])("rejects borrowed patient identity in reviews", async (handler) => {
    vi.mocked(prisma.patient.findUnique).mockResolvedValue(null);
    const token = await createToken({ id: "user-a", role: "PATIENT" });
    expect((await handler(request(token, "POST", { patientId: "patient-b", rating: 5, text: "Borrowed review" }), { params: Promise.resolve({ doctorId: "doctor-a" }) })).status).toBe(403);
    expect(prisma.appointment.findFirst).not.toHaveBeenCalled();
  });
  it("booking helper rejects disabled users and non-patient roles", async () => {
    dbUser("user-a", "PATIENT", false);
    expect(await getAuthenticatedPatient(request(await createToken({ id: "user-a", role: "PATIENT" })))).toBeNull();
    dbUser("user-a", "DOCTOR");
    expect(await getAuthenticatedPatient(request(await createToken({ id: "user-a", role: "DOCTOR" })))).toBeNull();
    expect(prisma.patient.create).not.toHaveBeenCalled();
  });
  it("malformed encoded cookie fails closed", async () => {
    expect(await getAuthenticatedUser(new Request("http://localhost", { headers: { cookie: "token=%ZZ" } }), { verifyDb: true })).toBeNull();
  });
  it("missing configured secret cannot validate tokens", async () => {
    const token = await createToken({ id: "user-a", role: "PATIENT" });
    const secret = process.env.JWT_SECRET;
    delete process.env.JWT_SECRET;
    try { expect((await verifyToken(token)).valid).toBe(false); }
    finally { process.env.JWT_SECRET = secret; }
  });
});

describe("Frontend middleware claims", () => {
  it.each(["admin", "doctor", "patient"])("rejects missing identity on /%s", async (area) => {
    const token = await signed({ role: area.toUpperCase() }, Math.floor(Date.now() / 1000) + 3600);
    const res = await middleware(new NextRequest(`http://localhost/${area}/dashboard`, { headers: { cookie: `token=${token}` } }));
    expect(res.headers.get("location")).toBe("http://localhost/auth/login");
  });
  it.each(["ADMIN", "DOCTOR", "PATIENT"])("allows matching %s claims", async (role) => {
    const token = await createToken({ id: "user-a", role });
    const res = await middleware(new NextRequest(`http://localhost/${role.toLowerCase()}/dashboard`, { headers: { cookie: `token=${token}` } }));
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });
});


describe("Additional sensitive route regression checks", () => {
  const routeModules = import.meta.glob("../../app/api/**/route.ts");
  const anonymousRoutes = [
    ["doctors/[doctorId]/route", "PUT"], ["doctors/[doctorId]/route", "PATCH"],
    ["doctors/[doctorId]/bank-details/route", "GET"], ["doctors/[doctorId]/bank-details/route", "PATCH"],
    ["doctors/[doctorId]/earnings/route", "GET"], ["doctors/[doctorId]/withdrawals/route", "GET"],
    ["doctors/[doctorId]/withdrawals/route", "POST"], ["doctors/[doctorId]/schedule/route", "POST"],
    ["doctors/[doctorId]/leave/route", "GET"], ["doctors/[doctorId]/leave/route", "POST"],
    ["doctors/[doctorId]/leave/route", "PATCH"], ["doctors/[doctorId]/leave/route", "DELETE"],
    ["doctors/[doctorId]/slots/route", "PATCH"], ["doctors/[doctorId]/slots/route", "DELETE"],
    ["doctors/[doctorId]/slots/route", "POST"], ["doctors/[doctorId]/stats/route", "GET"], ["doctors/[doctorId]/schedule/overview/route", "GET"],
    ["patients/[patientId]/stats/route", "GET"], ["patients/[patientId]/appointments/route", "GET"],
    ["patients/[patientId]/appointments/[appointmentId]/route", "GET"],
    ["patients/[patientId]/appointments/[appointmentId]/route", "PATCH"],
    ["doctors/[doctorId]/appointments/route", "GET"],
    ["doctors/[doctorId]/appointments/[appointmentId]/route", "GET"],
    ["doctors/[doctorId]/appointments/[appointmentId]/route", "PATCH"],
    ["doctorpatientrelations/route", "GET"], ["doctorpatientrelations/route", "POST"],
    ["doctorpatientrelations/[relationId]/chats/route", "GET"], ["doctorpatientrelations/[relationId]/chats/route", "POST"],
    ["user/[userId]/route", "GET"], ["user/[userId]/bank-details/route", "GET"],
    ["user/[userId]/bank-details/route", "PATCH"], ["user/[userId]/notification/route", "GET"],
    ["user/[userId]/notification/[id]/route", "PATCH"], ["user/[userId]/notification/[id]/route", "DELETE"],
    ["user/change-password/route", "POST"],
  ];
  it.each(anonymousRoutes)("%s %s authenticates before resource queries", async (path, method) => {
    const handlers = await routeModules[`../../app/api/${path}.ts`]() as Record<string, (req: NextRequest, context: { params: Promise<Record<string, string>> }) => Promise<Response>>;
    expect((await handlers[method](request(undefined, method), { params: Promise.resolve({ patientId: "patient-b", doctorId: "doctor-b", userId: "user-b", appointmentId: "appointment", relationId: "relation", id: "notification" }) })).status).toBe(401);
    expect(prisma.patient.findUnique).not.toHaveBeenCalled();
    expect(prisma.doctor.findUnique).not.toHaveBeenCalled();
    expect(prisma.appointment.findFirst).not.toHaveBeenCalled();
  });
  it.each(["doctors/[doctorId]/stats/route", "doctors/[doctorId]/schedule/overview/route"])("%s rejects unrelated doctors", async (path) => {
    dbUser("doctor-user-b", "DOCTOR");
    const handlers = await routeModules[`../../app/api/${path}.ts`]() as Record<string, (req: NextRequest, context: { params: Promise<Record<string, string>> }) => Promise<Response>>;
    expect((await handlers.GET(request(await createToken({ id: "doctor-user-b", role: "DOCTOR" })), { params: Promise.resolve({ doctorId: "doctor-a" }) })).status).toBe(403);
  });
  it("public slot availability masks patient hold identifiers", async () => {
    const { GET } = await import("@/app/api/doctors/[doctorId]/slots/route");
    vi.mocked(prisma.slot.updateMany).mockResolvedValue({ count: 0 });
    vi.mocked(prisma.slot.findMany).mockResolvedValue([{ id: "slot", doctorId: "doctor-a", status: "HELD", heldByPatientId: "patient-b", heldAt: new Date(), startTime: new Date() }] as never);
    const res = await GET(request(undefined, "GET", undefined, "/api/doctors/doctor-a/slots?date=2026-10-09"), { params: Promise.resolve({ doctorId: "doctor-a" }) });
    expect(res.status).toBe(200);
    expect((await res.json()).slots[0]).toMatchObject({ heldByPatientId: null, heldAt: null, status: "HELD" });
  });
  it.each(["admin/logs/route", "admin/onboarding/route"])("%s distinguishes unauthenticated and forbidden callers", async (path) => {
    const handlers = await routeModules[`../../app/api/${path}.ts`]() as Record<string, (req: NextRequest) => Promise<Response>>;
    const handler = path.includes("onboarding") ? handlers.POST : handlers.GET;
    const method = path.includes("onboarding") ? "POST" : "GET";
    expect((await handler(request(undefined, method))).status).toBe(401);
    expect((await handler(request(await createToken({ id: "user-a", role: "PATIENT" }), method))).status).toBe(403);
  });
  it.each(["PATCH", "DELETE", "POST"])("slot %s rejects unrelated doctors", async (method) => {
    const handlers = await routeModules["../../app/api/doctors/[doctorId]/slots/route.ts"]() as Record<string, (req: NextRequest, context: { params: Promise<{ doctorId: string }> }) => Promise<Response>>;
    dbUser("doctor-user-b", "DOCTOR");
    expect((await handlers[method](request(await createToken({ id: "doctor-user-b", role: "DOCTOR" }), method), { params: Promise.resolve({ doctorId: "doctor-a" }) })).status).toBe(403);
  });
  it("chat sender is the authenticated user even if body supplies another sender", async () => {
    const { POST } = await import("@/app/api/doctorpatientrelations/[relationId]/chats/route");
    vi.mocked(prisma.doctorPatientRelation.findUnique).mockResolvedValue({ id: "relation", patientsUserId: "user-a", doctorsUserId: "doctor-user-a" } as never);
    vi.mocked(prisma.chatMessages.create).mockResolvedValue({ id: "message" } as never);
    expect((await POST(request(await createToken({ id: "user-a", role: "PATIENT" }), "POST", { text: "Fixture message", senderId: "doctor-user-a", role: "ADMIN" }), { params: Promise.resolve({ relationId: "relation" }) })).status).toBe(201);
    expect(prisma.chatMessages.create).toHaveBeenCalledWith({ data: { doctorPatientRelationId: "relation", text: "Fixture message", senderId: "user-a" } });
  });
  it("admin bootstrap rejects the former public default when no code is configured", async () => {
    const { POST } = await import("@/app/api/admin/onboarding/route");
    dbUser("user-a", "ADMIN");
    const token = await createToken({ id: "user-a", role: "ADMIN" });
    const configured = process.env.SUPER_ADMIN_CODE;
    delete process.env.SUPER_ADMIN_CODE;
    try {
      expect((await POST(request(token, "POST", { userId: "user-a", secretCode: "QUICK_CLINIC_SUPER_ADMIN" }))).status).toBe(400);
      expect(prisma.user.update).not.toHaveBeenCalled();
    } finally {
      if (configured === undefined) delete process.env.SUPER_ADMIN_CODE;
      else process.env.SUPER_ADMIN_CODE = configured;
    }
  });
  it("signup sets the Secure flag on the session cookie in production", async () => {
    const { POST } = await import("@/app/api/user/signup/route");
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.user.create).mockResolvedValue({ id: "user-new", role: "PATIENT", email: "new@example.test", location: { city: "Test", state: "Test", pincode: 900001 } } as never);
    const environment = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const res = await POST(request(undefined, "POST", { role: "PATIENT", email: "new@example.test", password: "unused-fixture-password" }));
      expect(res.status).toBe(201);
      expect(res.cookies.get("token")?.secure).toBe(true);
    } finally {
      if (environment === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = environment;
    }
  });
  it("login rejects disabled accounts before issuing a JWT", async () => {
    const { POST } = await import("@/app/api/user/login/route");
    dbUser("user-a", "PATIENT", false);
    const res = await POST(request(undefined, "POST", { email: "user@example.test", password: "unused-password-fixture" }));
    expect(res.status).toBe(401);
    expect(res.headers.get("set-cookie")).toBeNull();
  });
  it("password reset requires valid unexpired proof", async () => {
    const { POST } = await import("@/app/api/user/reset-password/route");
    expect((await POST(request(undefined, "POST", { email: "user@example.test", newPassword: "unused-password-fixture" }))).status).toBe(400);
    vi.mocked(prisma.otp.findFirst).mockResolvedValue({ code: "fixture-proof", expiresAt: new Date(0) } as never);
    expect((await POST(request(undefined, "POST", { email: "user@example.test", otp: "fixture-proof", newPassword: "unused-password-fixture" }))).status).toBe(400);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
  it("password reset rejects a proof already consumed by another request", async () => {
    const { POST } = await import("@/app/api/user/reset-password/route");
    vi.mocked(prisma.otp.findFirst).mockResolvedValue({ id: "otp", code: "fixture-proof", expiresAt: new Date(Date.now() + 60_000) } as never);
    vi.mocked(prisma.otp.deleteMany).mockResolvedValue({ count: 0 });
    expect((await POST(request(undefined, "POST", { email: "user@example.test", otp: "fixture-proof", newPassword: "unused-password-fixture" }))).status).toBe(400);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
  it("password change rejects another user's ID and requires current password", async () => {
    const { POST } = await import("@/app/api/user/change-password/route");
    const token = await createToken({ id: "user-a", role: "PATIENT" });
    vi.mocked(prisma.user.findFirst).mockResolvedValue({ id: "user-b" } as never);
    expect((await POST(request(token, "POST", { userId: "user-b", newPassword: "unused-password-fixture" }))).status).toBe(403);
    vi.mocked(prisma.user.findFirst).mockResolvedValue({ id: "user-a" } as never);
    expect((await POST(request(token, "POST", { userId: "user-a", newPassword: "unused-password-fixture" }))).status).toBe(400);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});
