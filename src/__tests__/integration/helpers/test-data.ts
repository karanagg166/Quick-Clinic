import { prisma } from '@/lib/prisma';

export const TEST_DOCTOR_EMAIL = 'doctor_test@gmail.com';
export const TEST_PATIENT_EMAIL = 'patient_test@gmail.com';
export const TEST_PATIENT2_EMAIL = 'patient_test2@gmail.com';
export const TEST_PASSWORD = 'karan166';

export const DOCTOR_USER_PAYLOAD = {
  name: 'Dr. Test Karan',
  email: TEST_DOCTOR_EMAIL,
  phoneNo: '9876543210',
  age: 38,
  city: 'Faridabad',
  state: 'Haryana',
  pinCode: 121004,
  password: TEST_PASSWORD,
  address: 'Hospital Street 101',
  role: 'DOCTOR' as const,
  gender: 'MALE' as const,
};

export const PATIENT1_USER_PAYLOAD = {
  name: 'Test Patient One',
  email: TEST_PATIENT_EMAIL,
  phoneNo: '9876543211',
  age: 28,
  city: 'Faridabad',
  state: 'Haryana',
  pinCode: 121004,
  password: TEST_PASSWORD,
  address: 'Patient Lane 1',
  role: 'PATIENT' as const,
  gender: 'MALE' as const,
};

export const PATIENT2_USER_PAYLOAD = {
  name: 'Test Patient Two',
  email: TEST_PATIENT2_EMAIL,
  phoneNo: '9876543212',
  age: 32,
  city: 'Faridabad',
  state: 'Haryana',
  pinCode: 121004,
  password: TEST_PASSWORD,
  address: 'Patient Lane 2',
  role: 'PATIENT' as const,
  gender: 'FEMALE' as const,
};

export const DOCTOR_PROFILE_PAYLOAD = {
  specialty: 'GENERAL_PHYSICIAN' as const,
  fees: 500, // ₹500
  experience: 12,
  doctorBio: 'Expert physician for automated integration testing.',
  qualifications: ['MBBS', 'MD'] as const,
  latitude: 28.4089,
  longitude: 77.3178,
};

export const DOCTOR_WEEKLY_SCHEDULE = {
  weeklySchedule: [
    { day: 'Monday', slots: [{ slotNo: 1, start: '09:00', end: '12:00' }, { slotNo: 2, start: '14:00', end: '17:00' }] },
    { day: 'Tuesday', slots: [{ slotNo: 1, start: '09:00', end: '12:00' }, { slotNo: 2, start: '14:00', end: '17:00' }] },
    { day: 'Wednesday', slots: [{ slotNo: 1, start: '09:00', end: '12:00' }, { slotNo: 2, start: '14:00', end: '17:00' }] },
    { day: 'Thursday', slots: [{ slotNo: 1, start: '09:00', end: '12:00' }, { slotNo: 2, start: '14:00', end: '17:00' }] },
    { day: 'Friday', slots: [{ slotNo: 1, start: '09:00', end: '12:00' }, { slotNo: 2, start: '14:00', end: '17:00' }] },
    { day: 'Saturday', slots: [{ slotNo: 1, start: '10:00', end: '13:00' }] },
    { day: 'Sunday', slots: [{ slotNo: 1, start: '10:00', end: '13:00' }] },
  ],
};

/**
 * Helper to get a future date formatted as YYYY-MM-DD
 */
export function getFutureDateString(daysAhead = 3): string {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Helper to get a past date formatted as YYYY-MM-DD
 */
export function getPastDateString(daysAgo = 3): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Clean up all integration test entities in reverse-dependency order
 */
export async function cleanupIntegrationTestData() {
  const testEmails = [TEST_DOCTOR_EMAIL, TEST_PATIENT_EMAIL, TEST_PATIENT2_EMAIL];

  try {
    const users = await prisma.user.findMany({
      where: { email: { in: testEmails } },
      select: { id: true, doctor: { select: { id: true } }, patient: { select: { id: true } } },
    });

    const userIds = users.map((u) => u.id);
    const doctorIds = users.map((u) => u.doctor?.id).filter(Boolean) as string[];
    const patientIds = users.map((u) => u.patient?.id).filter(Boolean) as string[];

    if (userIds.length === 0) return;

    // 1. Delete notifications
    await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });

    // 2. Delete chat messages and relations
    const relations = await prisma.doctorPatientRelation.findMany({
      where: { OR: [{ doctorsUserId: { in: userIds } }, { patientsUserId: { in: userIds } }] },
      select: { id: true },
    });
    const relationIds = relations.map((r) => r.id);

    if (relationIds.length > 0) {
      await prisma.chatMessages.deleteMany({ where: { doctorPatientRelationId: { in: relationIds } } });
      await prisma.doctorPatientRelation.deleteMany({ where: { id: { in: relationIds } } });
    }

    // 3. Delete payments & withdrawals
    await prisma.payment.deleteMany({ where: { userId: { in: userIds } } });
    if (doctorIds.length > 0) {
      await prisma.withdrawal.deleteMany({ where: { doctorId: { in: doctorIds } } });
    }

    // 4. Delete bank accounts
    await prisma.bankAccount.deleteMany({ where: { userId: { in: userIds } } });

    // 5. Delete appointments & slots
    if (doctorIds.length > 0 || patientIds.length > 0) {
      await prisma.appointment.deleteMany({
        where: { OR: [{ doctorId: { in: doctorIds } }, { patientId: { in: patientIds } }] },
      });
    }

    if (doctorIds.length > 0) {
      await prisma.slot.deleteMany({ where: { doctorId: { in: doctorIds } } });
      await prisma.schedule.deleteMany({ where: { doctorId: { in: doctorIds } } });
      await prisma.leave.deleteMany({ where: { doctorId: { in: doctorIds } } });
      await prisma.rating.deleteMany({ where: { doctorId: { in: doctorIds } } });
      await prisma.comment.deleteMany({ where: { doctorId: { in: doctorIds } } });
      await prisma.doctorQualification.deleteMany({ where: { doctorId: { in: doctorIds } } });
    }

    // 6. Delete access logs & audit logs
    await prisma.auditLog.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.accessLog.deleteMany({ where: { userId: { in: userIds } } });

    // 7. Delete doctor & patient profiles
    if (doctorIds.length > 0) {
      await prisma.doctor.deleteMany({ where: { id: { in: doctorIds } } });
    }
    if (patientIds.length > 0) {
      await prisma.patient.deleteMany({ where: { id: { in: patientIds } } });
    }

    // 8. Delete users
    await prisma.user.deleteMany({ where: { email: { in: testEmails } } });
  } catch (error) {
    console.warn('Test cleanup warning:', error);
  }
}
