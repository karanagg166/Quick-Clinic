import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  slotFindUnique: vi.fn(),
  appointmentFindFirst: vi.fn(),
  appointmentFindUnique: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    slot: { findUnique: mocks.slotFindUnique },
    appointment: {
      findFirst: mocks.appointmentFindFirst,
      findUnique: mocks.appointmentFindUnique,
    },
  },
}));

import { confirmSlotHold } from '@/lib/booking';

describe('confirmSlotHold', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the existing paid appointment when Razorpay verification is retried', async () => {
    mocks.slotFindUnique.mockResolvedValue({
      id: 'slot_1',
      startTime: new Date(Date.now() + 24 * 60 * 60 * 1000),
      status: 'AVAILABLE',
    });

    const appointment = {
      id: 'appointment_1',
      slotId: 'slot_1',
      doctorId: 'doctor_1',
      patientId: 'patient_1',
      status: 'CONFIRMED',
      paymentMethod: 'ONLINE',
      transactionId: 'pay_1',
    };
    mocks.appointmentFindFirst.mockResolvedValue(appointment);
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
    expect(mocks.appointmentFindFirst).toHaveBeenCalledWith({
      where: {
        slotId: 'slot_1',
        status: { in: ['PENDING', 'CONFIRMED', 'COMPLETED', 'NO_SHOW'] },
      },
    });
  });
});
