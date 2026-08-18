import type { Gender, Role, Specialty, Qualification, SlotStatus, AppointmentStatus, PaymentMethod, WithdrawalStatus } from '@/generated/prisma';

let counter = 1;
export const getUniqueIndex = () => counter++;

export function buildUserPayload(overrides: Partial<any> = {}) {
  const idx = getUniqueIndex();
  return {
    name: `Test User ${idx}`,
    email: `test_user_${idx}_${Date.now()}@quickclinic.test`,
    phoneNo: `98765${String(idx).padStart(5, '0')}`,
    age: 30,
    city: 'Faridabad',
    state: 'Haryana',
    pinCode: 121004,
    password: 'Password123!',
    address: `${idx} Health Avenue`,
    role: 'PATIENT' as Role,
    gender: 'MALE' as Gender,
    ...overrides,
  };
}

export function buildDoctorProfilePayload(overrides: Partial<any> = {}) {
  return {
    specialty: 'GENERAL_PHYSICIAN' as Specialty,
    fees: 500,
    experience: 10,
    doctorBio: 'Board certified physician practicing general medicine.',
    qualifications: ['MBBS', 'MD'] as Qualification[],
    latitude: 28.4089,
    longitude: 77.3178,
    ...overrides,
  };
}

export function buildPatientProfilePayload(overrides: Partial<any> = {}) {
  return {
    medicalHistory: 'Hypertension controlled by diet.',
    allergies: 'Penicillin',
    currentMedications: 'Multivitamin daily',
    ...overrides,
  };
}

export function buildWeeklySchedulePayload(overrides: Partial<any> = {}) {
  return {
    weeklySchedule: [
      {
        day: 'Monday',
        slots: [
          { slotNo: 1, start: '09:00', end: '12:00' },
          { slotNo: 2, start: '14:00', end: '17:00' },
        ],
      },
      {
        day: 'Tuesday',
        slots: [
          { slotNo: 1, start: '09:00', end: '12:00' },
          { slotNo: 2, start: '14:00', end: '17:00' },
        ],
      },
      {
        day: 'Wednesday',
        slots: [
          { slotNo: 1, start: '09:00', end: '12:00' },
          { slotNo: 2, start: '14:00', end: '17:00' },
        ],
      },
      {
        day: 'Thursday',
        slots: [
          { slotNo: 1, start: '09:00', end: '12:00' },
          { slotNo: 2, start: '14:00', end: '17:00' },
        ],
      },
      {
        day: 'Friday',
        slots: [
          { slotNo: 1, start: '09:00', end: '12:00' },
          { slotNo: 2, start: '14:00', end: '17:00' },
        ],
      },
    ],
    ...overrides,
  };
}

export function buildLeavePayload(doctorId: string, overrides: Partial<any> = {}) {
  const start = new Date();
  start.setDate(start.getDate() + 10);
  const end = new Date();
  end.setDate(end.getDate() + 12);

  return {
    doctorId,
    reason: 'Annual Medical Conference',
    startDate: start.toISOString().split('T')[0],
    endDate: end.toISOString().split('T')[0],
    ...overrides,
  };
}

export function buildBankAccountPayload(overrides: Partial<any> = {}) {
  const idx = getUniqueIndex();
  return {
    bankAccountNumber: `9876543210${idx}`,
    bankIFSC: 'HDFC0001234',
    bankAccountHolderName: 'Dr. Test Physician',
    bankName: 'HDFC Bank',
    ...overrides,
  };
}

export function buildWithdrawalPayload(overrides: Partial<any> = {}) {
  return {
    amount: 50000, // 500.00 INR in paise
    currency: 'INR',
    ...overrides,
  };
}

export function buildRatingPayload(overrides: Partial<any> = {}) {
  return {
    rating: 5,
    ...overrides,
  };
}

export function buildCommentPayload(overrides: Partial<any> = {}) {
  return {
    text: 'Excellent consultation, thorough and attentive.',
    ...overrides,
  };
}

export async function createAuthHeaders(user: { id: string; role?: string; email?: string; name?: string }) {
  const { createToken } = await import('@/lib/auth');
  const token = await createToken({
    id: user.id,
    role: user.role || 'PATIENT',
    email: user.email,
    name: user.name,
  });
  return {
    authorization: `Bearer ${token}`,
    cookie: `token=${token}`,
  };
}

