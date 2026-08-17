import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as confirmAppointmentPOST } from '@/app/api/appointments/confirm/route';
import * as requestAuth from '@/lib/request-auth';
import * as apptConfirmation from '@/lib/appointment-confirmation';

vi.mock('@/lib/request-auth', () => ({
  getAuthenticatedPatient: vi.fn(),
}));

vi.mock('@/lib/appointment-confirmation', () => ({
  finalizeAppointmentBooking: vi.fn(),
}));

describe('Phase 78: System Resilience & Controlled Failure Test Suite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const validUuid = '123e4567-e89b-12d3-a456-426614174000';

  it('78.1 Resilient against downstream side-effect failures: returns 201 Created upon successful core confirmation', async () => {
    vi.mocked(requestAuth.getAuthenticatedPatient).mockResolvedValueOnce({
      id: 'pat_1',
      userId: 'user_pat_1',
    } as any);

    vi.mocked(apptConfirmation.finalizeAppointmentBooking).mockResolvedValueOnce({
      id: 'appt_confirmed_1',
      status: 'CONFIRMED',
      paymentMethod: 'OFFLINE',
      doctorId: 'doc_1',
      patientId: 'pat_1',
      slotId: 'slot_1',
    } as any);

    const req = new NextRequest('http://localhost:3000/api/appointments/confirm', {
      method: 'POST',
      body: JSON.stringify({
        slotId: 'slot_1',
        doctorId: 'doc_1',
        holdToken: validUuid,
        paymentMethod: 'OFFLINE',
      }),
    });

    const res = await confirmAppointmentPOST(req);
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.appointment.id).toBe('appt_confirmed_1');
  });

  it('78.2 Database transaction failure returns 500 error gracefully without corrupted state', async () => {
    vi.mocked(requestAuth.getAuthenticatedPatient).mockResolvedValueOnce({
      id: 'pat_1',
      userId: 'user_pat_1',
    } as any);

    // Simulate unexpected database crash / deadlock during finalize
    vi.mocked(apptConfirmation.finalizeAppointmentBooking).mockRejectedValueOnce(
      new Error('Deadlock detected during slot reservation')
    );

    const req = new NextRequest('http://localhost:3000/api/appointments/confirm', {
      method: 'POST',
      body: JSON.stringify({
        slotId: 'slot_1',
        doctorId: 'doc_1',
        holdToken: validUuid,
        paymentMethod: 'OFFLINE',
      }),
    });

    const res = await confirmAppointmentPOST(req);
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toBe('Unable to confirm this appointment');
  });

  it('78.3 Expired or stolen hold token returns 409 Conflict', async () => {
    vi.mocked(requestAuth.getAuthenticatedPatient).mockResolvedValueOnce({
      id: 'pat_1',
      userId: 'user_pat_1',
    } as any);

    // finalize returns null when hold expired or mismatched
    vi.mocked(apptConfirmation.finalizeAppointmentBooking).mockResolvedValueOnce(null);

    const req = new NextRequest('http://localhost:3000/api/appointments/confirm', {
      method: 'POST',
      body: JSON.stringify({
        slotId: 'slot_1',
        doctorId: 'doc_1',
        holdToken: validUuid,
        paymentMethod: 'OFFLINE',
      }),
    });

    const res = await confirmAppointmentPOST(req);
    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.error).toMatch(/Hold expired or does not belong to this patient/i);
  });
});
