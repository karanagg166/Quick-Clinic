import { prisma } from "@/lib/prisma";
import { AppointmentStatus } from "@/generated/prisma";

export interface DoctorPatientMedicalAccessResult {
  allowed: boolean;
  appointment?: {
    id: string;
    status: AppointmentStatus;
    bookedAt: Date;
    isAppointmentOffline?: boolean;
    slot?: {
      date?: Date;
      startTime?: Date;
      endTime?: Date;
    } | null;
  } | null;
  reason?: string;
}

/**
 * Checks whether an authenticated doctor is authorized to access a patient's
 * confidential medical documents based on scheduled or completed appointments.
 *
 * Rules:
 * - CONFIRMED: Scheduled valid appointment. Doctor may review medical records in preparation.
 * - COMPLETED: Past treated appointment. Doctor maintains ongoing access to records.
 * - All other statuses (PENDING, CANCELLED, EXPIRED, NO_SHOW, RESCHEDULED) DO NOT grant access.
 * - DoctorPatientRelation alone DOES NOT grant access.
 */
export async function verifyDoctorPatientMedicalAccess(
  doctorId: string,
  patientId: string
): Promise<DoctorPatientMedicalAccessResult> {
  if (!doctorId || !patientId) {
    return {
      allowed: false,
      appointment: null,
      reason: "MISSING_DOCTOR_OR_PATIENT_IDENTIFIER",
    };
  }

  const qualifyingAppointment = await prisma.appointment.findFirst({
    where: {
      doctorId,
      patientId,
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

  if (!qualifyingAppointment) {
    return {
      allowed: false,
      appointment: null,
      reason: "NO_ELIGIBLE_APPOINTMENT",
    };
  }

  return {
    allowed: true,
    appointment: qualifyingAppointment,
  };
}

/**
 * Boolean wrapper around verifyDoctorPatientMedicalAccess.
 */
export async function canDoctorAccessPatientMedicalRecords(
  doctorId: string,
  patientId: string
): Promise<boolean> {
  const result = await verifyDoctorPatientMedicalAccess(doctorId, patientId);
  return result.allowed;
}
