import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  verifyDoctorPatientMedicalAccess,
  canDoctorAccessPatientMedicalRecords,
} from "@/lib/medical-record-access";
import { prisma } from "@/lib/prisma";
import { AppointmentStatus } from "@/generated/prisma";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    appointment: {
      findFirst: vi.fn(),
    },
  },
}));

describe("Central Medical Record Access Helper", () => {
  const doctorAId = "doc_alpha_1";
  const doctorBId = "doc_bravo_2";
  const patientAId = "pat_alpha_1";
  const patientBId = "pat_bravo_2";

  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe("Status Matrix Authorization", () => {
    it("grants access when a CONFIRMED appointment exists (Doctor A + Patient A)", async () => {
      const mockAppointment = {
        id: "appt_conf_1",
        doctorId: doctorAId,
        patientId: patientAId,
        status: AppointmentStatus.CONFIRMED,
        bookedAt: new Date("2026-10-05T10:00:00Z"),
        slot: {
          date: new Date("2026-10-06T00:00:00Z"),
          startTime: new Date("2026-10-06T10:00:00Z"),
          endTime: new Date("2026-10-06T10:30:00Z"),
        },
      };

      vi.mocked(prisma.appointment.findFirst).mockResolvedValue(mockAppointment as any);

      const result = await verifyDoctorPatientMedicalAccess(doctorAId, patientAId);
      expect(result.allowed).toBe(true);
      expect(result.appointment?.id).toBe("appt_conf_1");
      expect(result.appointment?.status).toBe(AppointmentStatus.CONFIRMED);

      const booleanResult = await canDoctorAccessPatientMedicalRecords(doctorAId, patientAId);
      expect(booleanResult).toBe(true);

      expect(prisma.appointment.findFirst).toHaveBeenCalledWith({
        where: {
          doctorId: doctorAId,
          patientId: patientAId,
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
    });

    it("grants access when a COMPLETED appointment exists (Doctor A + Patient A)", async () => {
      const mockAppointment = {
        id: "appt_comp_1",
        doctorId: doctorAId,
        patientId: patientAId,
        status: AppointmentStatus.COMPLETED,
        bookedAt: new Date("2026-09-01T10:00:00Z"),
        slot: null,
      };

      vi.mocked(prisma.appointment.findFirst).mockResolvedValueOnce(mockAppointment as any);

      const result = await verifyDoctorPatientMedicalAccess(doctorAId, patientAId);
      expect(result.allowed).toBe(true);
      expect(result.appointment?.id).toBe("appt_comp_1");
      expect(result.appointment?.status).toBe(AppointmentStatus.COMPLETED);
    });

    it("denies access when only a PENDING appointment exists", async () => {
      vi.mocked(prisma.appointment.findFirst).mockResolvedValueOnce(null);

      const result = await verifyDoctorPatientMedicalAccess(doctorAId, patientAId);
      expect(result.allowed).toBe(false);
      expect(result.appointment).toBeNull();
      expect(result.reason).toBe("NO_ELIGIBLE_APPOINTMENT");

      const booleanResult = await canDoctorAccessPatientMedicalRecords(doctorAId, patientAId);
      expect(booleanResult).toBe(false);
    });

    it("denies access when only a CANCELLED appointment exists", async () => {
      vi.mocked(prisma.appointment.findFirst).mockResolvedValueOnce(null);

      const result = await verifyDoctorPatientMedicalAccess(doctorAId, patientAId);
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe("NO_ELIGIBLE_APPOINTMENT");
    });

    it("denies access when only an EXPIRED appointment exists", async () => {
      vi.mocked(prisma.appointment.findFirst).mockResolvedValueOnce(null);

      const result = await verifyDoctorPatientMedicalAccess(doctorAId, patientAId);
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe("NO_ELIGIBLE_APPOINTMENT");
    });

    it("denies access when only a NO_SHOW appointment exists", async () => {
      vi.mocked(prisma.appointment.findFirst).mockResolvedValueOnce(null);

      const result = await verifyDoctorPatientMedicalAccess(doctorAId, patientAId);
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe("NO_ELIGIBLE_APPOINTMENT");
    });

    it("denies access when only a RESCHEDULED appointment exists without replacement", async () => {
      vi.mocked(prisma.appointment.findFirst).mockResolvedValueOnce(null);

      const result = await verifyDoctorPatientMedicalAccess(doctorAId, patientAId);
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe("NO_ELIGIBLE_APPOINTMENT");
    });

    it("grants access if a RESCHEDULED appointment exists along with a replacement CONFIRMED appointment", async () => {
      // prisma.appointment.findFirst searches for CONFIRMED or COMPLETED, so it finds the active confirmed one
      const replacementConfirmed = {
        id: "appt_replacement_conf",
        doctorId: doctorAId,
        patientId: patientAId,
        status: AppointmentStatus.CONFIRMED,
        bookedAt: new Date("2026-10-04T12:00:00Z"),
      };

      vi.mocked(prisma.appointment.findFirst).mockResolvedValueOnce(replacementConfirmed as any);

      const result = await verifyDoctorPatientMedicalAccess(doctorAId, patientAId);
      expect(result.allowed).toBe(true);
      expect(result.appointment?.id).toBe("appt_replacement_conf");
    });
  });

  describe("Cross-Doctor and Identifier Isolation", () => {
    it("denies access for Doctor B attempting to access Patient A (no qualifying appointment)", async () => {
      vi.mocked(prisma.appointment.findFirst).mockResolvedValueOnce(null);

      const result = await verifyDoctorPatientMedicalAccess(doctorBId, patientAId);
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe("NO_ELIGIBLE_APPOINTMENT");
      expect(prisma.appointment.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            doctorId: doctorBId,
            patientId: patientAId,
          }),
        })
      );
    });

    it("denies access when doctorId or patientId is empty or missing", async () => {
      const res1 = await verifyDoctorPatientMedicalAccess("", patientAId);
      expect(res1.allowed).toBe(false);
      expect(res1.reason).toBe("MISSING_DOCTOR_OR_PATIENT_IDENTIFIER");

      const res2 = await verifyDoctorPatientMedicalAccess(doctorAId, "");
      expect(res2.allowed).toBe(false);
      expect(res2.reason).toBe("MISSING_DOCTOR_OR_PATIENT_IDENTIFIER");

      expect(prisma.appointment.findFirst).not.toHaveBeenCalled();
    });
  });
});
