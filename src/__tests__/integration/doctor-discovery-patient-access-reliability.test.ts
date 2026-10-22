import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { GET as getDoctors } from "@/app/api/doctors/route";
import { GET as getDoctorSlots } from "@/app/api/doctors/[doctorId]/slots/route";
import { GET as getPatients } from "@/app/api/patients/route";
import { createToken } from "@/lib/auth";
import {
  checkRateLimit,
  clearInMemoryRateLimits,
  isRedisCircuitBreakerOpen,
  tripRedisCircuitBreaker,
} from "@/lib/rate-limiter";
import { reconcileNotificationOutbox } from "@/lib/reconciliation-service";
import * as socketPublisher from "@/lib/socket-publisher";

describe("Doctor Discovery and Patient Access Reliability Integration Tests", () => {
  let seededDoctorUser: any;
  let seededDoctorRecord: any;
  let seededPatientUser: any;
  let seededPatientRecord: any;
  let otherDoctorUser: any;
  let otherDoctorRecord: any;

  beforeAll(async () => {
    // 1. Fetch real seeded doctor from PostgreSQL
    const doctorRecord = await prisma.doctor.findFirst({
      include: { user: true, schedule: true },
    });
    expect(doctorRecord).not.toBeNull();
    seededDoctorRecord = doctorRecord;
    seededDoctorUser = doctorRecord!.user;

    // 2. Fetch another doctor record to test cross-doctor authorization isolation
    const secondDoctor = await prisma.doctor.findFirst({
      where: { id: { not: doctorRecord!.id } },
      include: { user: true },
    });
    expect(secondDoctor).not.toBeNull();
    otherDoctorRecord = secondDoctor;
    otherDoctorUser = secondDoctor!.user;

    // 3. Fetch or ensure a test patient exists
    let patientRecord = await prisma.patient.findFirst({
      include: { user: true },
    });
    if (!patientRecord) {
      const user = await prisma.user.create({
        data: {
          name: "Test Audit Patient",
          email: `audit.patient.${Date.now()}@example.com`,
          password: "hashedpassword123",
          phoneNo: "9998887771",
          age: 32,
          gender: "FEMALE",
          role: "PATIENT",
          address: "Test Patient Street",
          pinCode: 560001,
          location: {
            connectOrCreate: {
              where: { pincode: 560001 },
              create: { pincode: 560001, city: "Bangalore", state: "Karnataka" },
            },
          },
        },
      });
      patientRecord = await prisma.patient.create({
        data: {
          userId: user.id,
          medicalHistory: "Seasonal Allergies",
          allergies: "Penicillin",
          currentMedications: "Cetirizine",
        },
        include: { user: true },
      });
    }
    seededPatientRecord = patientRecord;
    seededPatientUser = patientRecord!.user;
  });

  describe("Priority 1: Doctor Discovery Verification", () => {
    it("GET /api/doctors returns all eligible seeded doctors with complete profile attributes", async () => {
      const req = new NextRequest("http://localhost:3000/api/doctors");
      const res = await getDoctors(req);
      expect(res.status).toBe(200);

      const doctors = await res.json();
      expect(Array.isArray(doctors)).toBe(true);
      expect(doctors.length).toBeGreaterThanOrEqual(8);

      const firstDoctor = doctors[0];
      expect(firstDoctor).toHaveProperty("id");
      expect(firstDoctor).toHaveProperty("name");
      expect(firstDoctor).toHaveProperty("specialty");
      expect(firstDoctor).toHaveProperty("fees");
      expect(firstDoctor).toHaveProperty("experience");
      expect(firstDoctor).toHaveProperty("qualifications");
      expect(Array.isArray(firstDoctor.qualifications)).toBe(true);
    });

    it("GET /api/doctors correctly filters by doctor specialty", async () => {
      const req = new NextRequest(
        `http://localhost:3000/api/doctors?specialization=${seededDoctorRecord.specialty}`
      );
      const res = await getDoctors(req);
      expect(res.status).toBe(200);

      const doctors = await res.json();
      expect(Array.isArray(doctors)).toBe(true);
      expect(doctors.length).toBeGreaterThanOrEqual(1);

      for (const doc of doctors) {
        expect(doc.specialty).toBe(seededDoctorRecord.specialty);
      }
    });

    it("GET /api/doctors filters by fee ranges (minFees and maxFees)", async () => {
      const req = new NextRequest(
        "http://localhost:3000/api/doctors?minFees=100&maxFees=5000"
      );
      const res = await getDoctors(req);
      expect(res.status).toBe(200);

      const doctors = await res.json();
      expect(Array.isArray(doctors)).toBe(true);
      expect(doctors.length).toBeGreaterThanOrEqual(1);

      for (const doc of doctors) {
        expect(doc.fees).toBeGreaterThanOrEqual(100);
        expect(doc.fees).toBeLessThanOrEqual(5000);
      }
    });

    it("GET /api/doctors/[doctorId]/slots generates and returns available appointment slots", async () => {
      // Choose Monday 2026-10-26 (guaranteed working weekday)
      const testDate = "2026-10-26";
      const req = new NextRequest(
        `http://localhost:3000/api/doctors/${seededDoctorRecord.id}/slots?date=${testDate}`
      );
      const res = await getDoctorSlots(req, {
        params: Promise.resolve({ doctorId: seededDoctorRecord.id }),
      });
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data).toHaveProperty("slots");
      expect(Array.isArray(data.slots)).toBe(true);
      expect(data.slots.length).toBeGreaterThan(0);

      const availableSlot = data.slots.find((s: any) => s.status === "AVAILABLE");
      expect(availableSlot).toBeDefined();
      expect(availableSlot.doctorId).toBe(seededDoctorRecord.id);
      expect(availableSlot.heldByPatientId).toBeNull();
    });
  });

  describe("Priority 1: Patient Listing and scope=all Authorization Defect Fix", () => {
    it("GET /api/patients?doctorId=&scope=all called by authenticated doctor does NOT return 403 Forbidden", async () => {
      const token = await createToken({
        id: seededDoctorUser.id,
        role: "DOCTOR",
        email: seededDoctorUser.email,
        name: seededDoctorUser.name,
      });

      const req = new NextRequest(
        "http://localhost:3000/api/patients?doctorId=&scope=all",
        {
          headers: {
            cookie: `token=${token}`,
          },
        }
      );

      const res = await getPatients(req);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(Array.isArray(data)).toBe(true);
    });

    it("GET /api/patients strictly forbids doctor from accessing another doctor's patients", async () => {
      const token = await createToken({
        id: seededDoctorUser.id,
        role: "DOCTOR",
        email: seededDoctorUser.email,
        name: seededDoctorUser.name,
      });

      const req = new NextRequest(
        `http://localhost:3000/api/patients?doctorId=${otherDoctorRecord.id}`,
        {
          headers: {
            cookie: `token=${token}`,
          },
        }
      );

      const res = await getPatients(req);
      expect(res.status).toBe(403);

      const data = await res.json();
      expect(data.error).toMatch(/Access denied.*another doctor/i);
    });

    it("GET /api/patients returns 401 Unauthorized for unauthenticated requests", async () => {
      const req = new NextRequest(
        `http://localhost:3000/api/patients?doctorId=${seededDoctorRecord.id}`
      );
      const res = await getPatients(req);
      expect(res.status).toBe(401);
    });
  });

  describe("Priority 4: Upstash Rate Limiter DNS Failure and Fallback", () => {
    beforeEach(() => {
      clearInMemoryRateLimits();
    });

    it("trips circuit breaker and falls back to in-memory store without throwing", async () => {
      expect(isRedisCircuitBreakerOpen()).toBe(false);

      // Simulate circuit breaker trip
      tripRedisCircuitBreaker(30_000);
      expect(isRedisCircuitBreakerOpen()).toBe(true);

      // Call rate limit while circuit breaker is open
      const res1 = await checkRateLimit("test-key-circuit", 5, 60);
      expect(res1.allowed).toBe(true);
      expect(res1.remaining).toBe(4);

      const res2 = await checkRateLimit("test-key-circuit", 5, 60);
      expect(res2.allowed).toBe(true);
      expect(res2.remaining).toBe(3);
    });

    it("strictly blocks requests when in-memory rate limit is exceeded", async () => {
      tripRedisCircuitBreaker(30_000);
      const key = `user-flood-${Date.now()}`;

      for (let i = 0; i < 3; i++) {
        const res = await checkRateLimit(key, 3, 60);
        expect(res.allowed).toBe(true);
      }

      const blockedRes = await checkRateLimit(key, 3, 60);
      expect(blockedRes.allowed).toBe(false);
      expect(blockedRes.remaining).toBe(0);
    });
  });

  describe("Priority 4: Outbox Reconcile Budget & Circuit-Breaker", () => {
    it("terminates early when socket server fails or times out, protecting execution budget", async () => {
      // Mock socket publisher to simulate connection timeout/failure
      const publishSpy = vi
        .spyOn(socketPublisher, "publishToSocketServer")
        .mockResolvedValue(null);

      const res = await reconcileNotificationOutbox(15, Date.now() + 10_000);

      // Verify that it gracefully handled failure without throwing an unhandled exception
      expect(res).toHaveProperty("delivered");
      expect(res).toHaveProperty("failed");
      expect(res).toHaveProperty("errors");

      // Verify that publishToSocketServer was called at most once or twice due to circuit-breaking
      expect(publishSpy.mock.calls.length).toBeLessThanOrEqual(2);

      publishSpy.mockRestore();
    });
  });
});
