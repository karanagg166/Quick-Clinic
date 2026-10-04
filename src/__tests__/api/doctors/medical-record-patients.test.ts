import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/doctors/me/medical-record-patients/route";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser } from "@/lib/auth";
import { logAccess } from "@/lib/logger";
import { AppointmentStatus } from "@/generated/prisma";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    doctor: {
      findUnique: vi.fn(),
    },
    appointment: {
      findMany: vi.fn(),
    },
    patient: {
      findMany: vi.fn(),
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

describe("Doctor Medical Record Patients API (GET /api/doctors/me/medical-record-patients)", () => {
  const mockDoctorUser = { id: "user_doc_1", role: "DOCTOR", email: "dr.smith@example.com" };
  const mockPatientUser = { id: "user_pat_1", role: "PATIENT", email: "patient@example.com" };
  const mockDoctorProfile = { id: "doc_profile_1", userId: "user_doc_1" };

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(getAuthenticatedUser).mockResolvedValueOnce(null);

    const req = new NextRequest("http://localhost:3000/api/doctors/me/medical-record-patients");
    const res = await GET(req);

    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error).toContain("Authentication required");
  });

  it("returns 403 when authenticated user has PATIENT role", async () => {
    vi.mocked(getAuthenticatedUser).mockResolvedValueOnce(mockPatientUser as any);

    const req = new NextRequest("http://localhost:3000/api/doctors/me/medical-record-patients");
    const res = await GET(req);

    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.error).toContain("Access denied");
  });

  it("returns 404 when doctor profile is not found", async () => {
    vi.mocked(getAuthenticatedUser).mockResolvedValueOnce(mockDoctorUser as any);
    vi.mocked(prisma.doctor.findUnique).mockResolvedValueOnce(null);

    const req = new NextRequest("http://localhost:3000/api/doctors/me/medical-record-patients");
    const res = await GET(req);

    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toContain("Doctor profile not found");
  });

  it("returns empty array and logs access when doctor has no qualifying appointments", async () => {
    vi.mocked(getAuthenticatedUser).mockResolvedValueOnce(mockDoctorUser as any);
    vi.mocked(prisma.doctor.findUnique).mockResolvedValueOnce(mockDoctorProfile as any);
    vi.mocked(prisma.appointment.findMany).mockResolvedValueOnce([]);

    const req = new NextRequest("http://localhost:3000/api/doctors/me/medical-record-patients");
    const res = await GET(req);

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual([]);

    expect(logAccess).toHaveBeenCalledWith(
      "user_doc_1",
      "doc_profile_1",
      "MEDICAL_DOCUMENT_LIST",
      "MEDICAL_RECORD"
    );
  });

  it("queries strictly for CONFIRMED and COMPLETED appointments and returns safe patient summaries", async () => {
    vi.mocked(getAuthenticatedUser).mockResolvedValueOnce(mockDoctorUser as any);
    vi.mocked(prisma.doctor.findUnique).mockResolvedValueOnce(mockDoctorProfile as any);

    const qualifyingAppointments = [
      {
        id: "appt_1",
        doctorId: "doc_profile_1",
        patientId: "pat_1",
        status: AppointmentStatus.CONFIRMED,
        bookedAt: new Date("2026-10-04T10:00:00Z"),
        slot: {
          date: new Date("2026-10-05T00:00:00Z"),
          startTime: new Date("2026-10-05T10:00:00Z"),
          endTime: new Date("2026-10-05T10:30:00Z"),
        },
      },
      {
        id: "appt_2",
        doctorId: "doc_profile_1",
        patientId: "pat_2",
        status: AppointmentStatus.COMPLETED,
        bookedAt: new Date("2026-09-20T14:00:00Z"),
        slot: {
          date: new Date("2026-09-20T00:00:00Z"),
          startTime: new Date("2026-09-20T14:00:00Z"),
          endTime: new Date("2026-09-20T14:30:00Z"),
        },
      },
    ];

    vi.mocked(prisma.appointment.findMany).mockResolvedValueOnce(qualifyingAppointments as any);

    const mockPatients = [
      {
        id: "pat_1",
        user: {
          name: "Alice Johnson",
          age: 28,
          gender: "FEMALE",
          profileImageUrl: "https://example.com/alice.jpg",
        },
      },
      {
        id: "pat_2",
        user: {
          name: "Bob Smith",
          age: 45,
          gender: "MALE",
          profileImageUrl: null,
        },
      },
    ];

    vi.mocked(prisma.patient.findMany).mockResolvedValueOnce(mockPatients as any);

    const req = new NextRequest("http://localhost:3000/api/doctors/me/medical-record-patients");
    const res = await GET(req);

    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.length).toBe(2);
    expect(data[0]).toEqual({
      id: "pat_1",
      name: "Alice Johnson",
      age: 28,
      gender: "FEMALE",
      profileImageUrl: "https://example.com/alice.jpg",
      lastAppointment: qualifyingAppointments[0].slot.startTime.toISOString(),
      relationship: AppointmentStatus.CONFIRMED,
    });

    expect(data[1]).toEqual({
      id: "pat_2",
      name: "Bob Smith",
      age: 45,
      gender: "MALE",
      profileImageUrl: null,
      lastAppointment: qualifyingAppointments[1].slot.startTime.toISOString(),
      relationship: AppointmentStatus.COMPLETED,
    });

    // Verify appointment query was strictly scoped to CONFIRMED and COMPLETED
    expect(prisma.appointment.findMany).toHaveBeenCalledWith({
      where: {
        doctorId: "doc_profile_1",
        status: {
          in: [AppointmentStatus.CONFIRMED, AppointmentStatus.COMPLETED],
        },
      },
      include: {
        slot: {
          select: {
            date: true,
            startTime: true,
            endTime: true,
          },
        },
      },
      orderBy: {
        bookedAt: "desc",
      },
    });

    // Verify access log creation
    expect(logAccess).toHaveBeenCalledWith(
      "user_doc_1",
      "doc_profile_1",
      "MEDICAL_DOCUMENT_LIST",
      "MEDICAL_RECORD"
    );
  });
});
