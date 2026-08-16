import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  appointmentFindUnique: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    appointment: { findUnique: mocks.appointmentFindUnique },
  },
}));

import { confirmSlotHold } from '@/lib/booking';

describe('confirmSlotHold', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the existing paid appointment when Razorpay verification is retried', async () => {
    const appointment = {
      id: 'appointment_1',
      slotId: 'slot_1',
      doctorId: 'doctor_1',
      patientId: 'patient_1',
      status: 'CONFIRMED',
      paymentMethod: 'ONLINE',
      transactionId: 'pay_1',
    };
    mocks.appointmentFindUnique.mockResolvedValue(appointment);

    const result = await confirmSlotHold({
      slotId: 'slot_1',
      doctorId: 'doctor_1',
      patientId: 'patient_1',
      token: '123e4567-e89b-12d3-a456-426614174000',
      paymentMethod: 'ONLINE',
      transactionId: 'pay_1',
    });

    expect(result).toEqual(appointment);
    expect(mocks.appointmentFindUnique).toHaveBeenCalledWith({ where: { slotId: 'slot_1' } });
  });
});
