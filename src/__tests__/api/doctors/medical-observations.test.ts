import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { POST as queryObservations } from "@/app/api/doctors/me/patients/[patientId]/medical-observations/route";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser } from "@/lib/auth";
import { logAccess, logAudit } from "@/lib/logger";
import { queryPatientMedicalObservations } from "@/lib/search-sphere-client";
import { AppointmentStatus } from "@/generated/prisma";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    doctor: {
      findUnique: vi.fn(),
    },
    appointment: {
      findFirst: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
    accessLog: {
      create: vi.fn(),
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

vi.mock("@/lib/search-sphere-client", () => ({
  queryPatientMedicalObservations: vi.fn(),
}));

describe("Doctor Patient Medical Observations API Test Suite", () => {
  const doctorUserA = { id: "user_doc_a", role: "DOCTOR", email: "doctorA@example.com" };
  const doctorUserB = { id: "user_doc_b", role: "DOCTOR", email: "doctorB@example.com" };
  const patientUser = { id: "user_pat_1", role: "PATIENT", email: "patient@example.com" };

  const doctorProfileA = { id: "doc_profile_a", userId: "user_doc_a" };
  const doctorProfileB = { id: "doc_profile_b", userId: "user_doc_b" };

  const patientIdA = "pat_123";
  const patientIdB = "pat_456";

  const qualifyingAppointment = {
    id: "apt_1",
    doctorId: doctorProfileA.id,
    patientId: patientIdA,
    status: AppointmentStatus.CONFIRMED,
    bookedAt: new Date("2026-10-01"),
  };

  const sampleObservations = [
    {
      id: "obs-1",
      type: "BLOOD_PRESSURE",
      displayName: "Blood Pressure",
      value: 120,
      secondaryValue: 80,
      valueText: "120/80",
      unit: "mmHg",
      observedAt: "2026-10-01T10:00:00Z",
      reportedAt: "2026-10-01T10:00:00Z",
      isDateInferred: false,
      documentId: "doc-1",
      pageNumber: 1,
      chunkIndex: 0,
      confidence: 0.95,
    },
    {
      id: "obs-2",
      type: "HEART_RATE",
      displayName: "Heart Rate",
      value: 72,
      valueText: "72",
      unit: "bpm",
      observedAt: "2026-10-01T10:00:00Z",
      documentId: "doc-1",
      pageNumber: 1,
      chunkIndex: 0,
      confidence: 0.95,
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Authentication & Authorization", () => {
    it("Unauthenticated request returns 401", async () => {
      vi.mocked(getAuthenticatedUser).mockResolvedValueOnce(null);

      const req = new NextRequest("http://localhost:3000/api/doctors/me/patients/pat_123/medical-observations", {
        method: "POST",
        body: JSON.stringify({}),
      });

      const res = await queryObservations(req, { params: Promise.resolve({ patientId: patientIdA }) });
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.error).toBe("Authentication required");
    });

    it("Non-doctor user returns 403", async () => {
      vi.mocked(getAuthenticatedUser).mockResolvedValueOnce(patientUser as any);

      const req = new NextRequest("http://localhost:3000/api/doctors/me/patients/pat_123/medical-observations", {
        method: "POST",
        body: JSON.stringify({}),
      });

      const res = await queryObservations(req, { params: Promise.resolve({ patientId: patientIdA }) });
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toContain("Only doctors can access this endpoint");
    });

    it("CONFIRMED appointment allows observation query (200)", async () => {
      vi.mocked(getAuthenticatedUser).mockResolvedValueOnce(doctorUserA as any);
      vi.mocked(prisma.doctor.findUnique).mockResolvedValueOnce(doctorProfileA as any);
      vi.mocked(prisma.appointment.findFirst).mockResolvedValueOnce({
        ...qualifyingAppointment,
        status: AppointmentStatus.CONFIRMED,
      } as any);
      vi.mocked(queryPatientMedicalObservations).mockResolvedValueOnce({
        observations: sampleObservations,
        totalCount: 2,
      });

      const req = new NextRequest("http://localhost:3000/api/doctors/me/patients/pat_123/medical-observations", {
        method: "POST",
        body: JSON.stringify({ observationTypes: ["BLOOD_PRESSURE"] }),
      });

      const res = await queryObservations(req, { params: Promise.resolve({ patientId: patientIdA }) });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.observations).toHaveLength(2);
      expect(data.totalCount).toBe(2);
      expect(queryPatientMedicalObservations).toHaveBeenCalledWith({
        patientId: patientIdA,
        observationTypes: ["BLOOD_PRESSURE"],
        fromDate: undefined,
        toDate: undefined,
        limit: 100,
        sort: "asc",
      });
    });

    it("COMPLETED appointment allows observation query (200)", async () => {
      vi.mocked(getAuthenticatedUser).mockResolvedValueOnce(doctorUserA as any);
      vi.mocked(prisma.doctor.findUnique).mockResolvedValueOnce(doctorProfileA as any);
      vi.mocked(prisma.appointment.findFirst).mockResolvedValueOnce({
        ...qualifyingAppointment,
        status: AppointmentStatus.COMPLETED,
      } as any);
      vi.mocked(queryPatientMedicalObservations).mockResolvedValueOnce({
        observations: sampleObservations,
        totalCount: 2,
      });

      const req = new NextRequest("http://localhost:3000/api/doctors/me/patients/pat_123/medical-observations", {
        method: "POST",
        body: JSON.stringify({}),
      });

      const res = await queryObservations(req, { params: Promise.resolve({ patientId: patientIdA }) });
      expect(res.status).toBe(200);
    });

    it("PENDING/CANCELLED/NO_SHOW appointment denies access (403) and logs MEDICAL_OBSERVATION_ACCESS_DENIED", async () => {
      vi.mocked(getAuthenticatedUser).mockResolvedValueOnce(doctorUserA as any);
      vi.mocked(prisma.doctor.findUnique).mockResolvedValueOnce(doctorProfileA as any);
      // No CONFIRMED/COMPLETED appointment found
      vi.mocked(prisma.appointment.findFirst).mockResolvedValueOnce(null);

      const req = new NextRequest("http://localhost:3000/api/doctors/me/patients/pat_123/medical-observations", {
        method: "POST",
        body: JSON.stringify({}),
      });

      const res = await queryObservations(req, { params: Promise.resolve({ patientId: patientIdA }) });
      expect(res.status).toBe(403);

      expect(logAudit).toHaveBeenCalledWith(
        doctorUserA.id,
        "MEDICAL_OBSERVATION_ACCESS_DENIED",
        expect.objectContaining({
          patientId: patientIdA,
          doctorId: doctorProfileA.id,
        }),
        "MEDICAL_RECORD"
      );
    });

    it("Cross-doctor IDOR prevention: Doctor B cannot query Patient A observations without appointment", async () => {
      vi.mocked(getAuthenticatedUser).mockResolvedValueOnce(doctorUserB as any);
      vi.mocked(prisma.doctor.findUnique).mockResolvedValueOnce(doctorProfileB as any);
      // Doctor B has no appointment with Patient A
      vi.mocked(prisma.appointment.findFirst).mockResolvedValueOnce(null);

      const req = new NextRequest("http://localhost:3000/api/doctors/me/patients/pat_123/medical-observations", {
        method: "POST",
        body: JSON.stringify({}),
      });

      const res = await queryObservations(req, { params: Promise.resolve({ patientId: patientIdA }) });
      expect(res.status).toBe(403);
      expect(queryPatientMedicalObservations).not.toHaveBeenCalled();
    });
  });

  describe("PHI-Safe Audit & Access Logging", () => {
    it("Logs access and audit with counts and types, never numeric values or text", async () => {
      vi.mocked(getAuthenticatedUser).mockResolvedValueOnce(doctorUserA as any);
      vi.mocked(prisma.doctor.findUnique).mockResolvedValueOnce(doctorProfileA as any);
      vi.mocked(prisma.appointment.findFirst).mockResolvedValueOnce(qualifyingAppointment as any);
      vi.mocked(queryPatientMedicalObservations).mockResolvedValueOnce({
        observations: sampleObservations,
        totalCount: 2,
      });

      const req = new NextRequest("http://localhost:3000/api/doctors/me/patients/pat_123/medical-observations", {
        method: "POST",
        body: JSON.stringify({ observationTypes: ["BLOOD_PRESSURE", "HEART_RATE"] }),
      });

      const res = await queryObservations(req, { params: Promise.resolve({ patientId: patientIdA }) });
      expect(res.status).toBe(200);

      // Verify access log
      expect(logAccess).toHaveBeenCalledWith(
        doctorUserA.id,
        patientIdA,
        "MEDICAL_OBSERVATIONS_QUERY",
        "MEDICAL_RECORD"
      );

      // Verify audit log metadata does NOT contain values or text
      expect(logAudit).toHaveBeenCalledWith(
        doctorUserA.id,
        "MEDICAL_STRUCTURED_QUERY",
        {
          patientId: patientIdA,
          observationCount: 2,
          observationTypes: ["BLOOD_PRESSURE", "HEART_RATE"],
        },
        "MEDICAL_RECORD"
      );
    });
  });

  describe("Error Handling", () => {
    it("Search Sphere upstream failure returns 500", async () => {
      vi.mocked(getAuthenticatedUser).mockResolvedValueOnce(doctorUserA as any);
      vi.mocked(prisma.doctor.findUnique).mockResolvedValueOnce(doctorProfileA as any);
      vi.mocked(prisma.appointment.findFirst).mockResolvedValueOnce(qualifyingAppointment as any);
      vi.mocked(queryPatientMedicalObservations).mockRejectedValueOnce(
        new Error("Search Sphere connection refused")
      );

      const req = new NextRequest("http://localhost:3000/api/doctors/me/patients/pat_123/medical-observations", {
        method: "POST",
        body: JSON.stringify({}),
      });

      const res = await queryObservations(req, { params: Promise.resolve({ patientId: patientIdA }) });
      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data.error).toContain("Search Sphere connection refused");
    });
  });
});
