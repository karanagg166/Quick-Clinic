import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  createSlotHold: vi.fn(),
  finalizeAppointmentBooking: vi.fn(),
  cancelSlotHold: vi.fn(),
  getAuthenticatedPatient: vi.fn(),
}));

vi.mock('@/lib/booking', () => ({
  createSlotHold: mocks.createSlotHold,
  cancelSlotHold: mocks.cancelSlotHold,
}));
vi.mock('@/lib/appointment-confirmation', () => ({
  finalizeAppointmentBooking: mocks.finalizeAppointmentBooking,
}));
vi.mock('@/lib/request-auth', () => ({ getAuthenticatedPatient: mocks.getAuthenticatedPatient }));
vi.mock('@/lib/logger', () => ({ logAudit: vi.fn() }));

import { POST as hold } from '@/app/api/appointments/hold/route';
import { POST as confirm } from '@/app/api/appointments/confirm/route';
import { POST as cancel } from '@/app/api/appointments/cancel-hold/route';

const patient = { id: 'patient_1', userId: 'user_1' };
const holdToken = '123e4567-e89b-12d3-a456-426614174000';

describe('appointment holds', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAuthenticatedPatient.mockResolvedValue(patient);
  });

  it('returns 409 when another patient already holds the slot', async () => {
    mocks.createSlotHold.mockResolvedValue({ kind: 'conflict' });
    const response = await hold(new NextRequest('http://localhost/api/appointments/hold', {
      method: 'POST', body: JSON.stringify({ slotId: 'slot_1', doctorId: 'doctor_1' }),
    }));
    expect(response.status).toBe(409);
  });

  it('only confirms an appointment for the authenticated hold owner', async () => {
    mocks.finalizeAppointmentBooking.mockResolvedValue(null);
    const response = await confirm(new NextRequest('http://localhost/api/appointments/confirm', {
      method: 'POST', body: JSON.stringify({ slotId: 'slot_1', doctorId: 'doctor_1', holdToken, paymentMethod: 'OFFLINE' }),
    }));
    expect(response.status).toBe(409);
    expect(mocks.finalizeAppointmentBooking).toHaveBeenCalledWith(expect.objectContaining({
      patientId: patient.id,
      patientUserId: patient.userId,
      holdToken,
    }));
  });

  it('releases a payment hold on cancellation', async () => {
    mocks.cancelSlotHold.mockResolvedValue(true);
    const response = await cancel(new NextRequest('http://localhost/api/appointments/cancel-hold', {
      method: 'POST', body: JSON.stringify({ slotId: 'slot_1', holdToken }),
    }));
    expect(response.status).toBe(200);
    expect(mocks.cancelSlotHold).toHaveBeenCalledWith('slot_1', patient.id, holdToken);
  });

  it('successfully confirms an appointment with ONLINE payment and transactionId', async () => {
    const mockConfirmedAppointment = {
      id: 'apt_online_123',
      patientId: patient.id,
      doctorId: 'doctor_1',
      slotId: 'slot_1',
      paymentMethod: 'ONLINE',
      paymentStatus: 'PAID',
      transactionId: 'pay_rzp_test_789',
      status: 'CONFIRMED',
    };
    mocks.finalizeAppointmentBooking.mockResolvedValue(mockConfirmedAppointment);

    const response = await confirm(new NextRequest('http://localhost/api/appointments/confirm', {
      method: 'POST',
      body: JSON.stringify({
        slotId: 'slot_1',
        doctorId: 'doctor_1',
        holdToken,
        paymentMethod: 'ONLINE',
        transactionId: 'pay_rzp_test_789',
      }),
    }));

    expect(response.status).toBe(201);
    const data = await response.json();
    expect(data.appointment).toEqual(mockConfirmedAppointment);
    expect(mocks.finalizeAppointmentBooking).toHaveBeenCalledWith(expect.objectContaining({
      slotId: 'slot_1',
      doctorId: 'doctor_1',
      patientId: patient.id,
      holdToken,
      paymentMethod: 'ONLINE',
      transactionId: 'pay_rzp_test_789',
    }));
  });
});
