import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as holdPOST } from '@/app/api/appointments/hold/route';
import { PATCH as doctorAppointmentPATCH } from '@/app/api/doctors/[doctorId]/appointments/[appointmentId]/route';
import { POST as withdrawalPOST } from '@/app/api/doctors/[doctorId]/withdrawals/route';
import { prisma } from '@/lib/prisma';
import * as requestAuth from '@/lib/request-auth';
import * as booking from '@/lib/booking';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: vi.fn(),
    slot: {
      findUnique: vi.fn().mockResolvedValue({ startTime: new Date('2028-12-25T10:00:00Z') }),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    appointment: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    doctor: {
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    withdrawal: {
      create: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
    notification: {
      create: vi.fn(),
    },
    doctorPatientRelation: {
      findUnique: vi.fn().mockResolvedValue({ id: 'rel_1' }),
      create: vi.fn().mockResolvedValue({ id: 'rel_1' }),
    },
    chatMessages: {
      create: vi.fn(),
    },
  },
}));

vi.mock('@/lib/request-auth', () => ({
  getAuthenticatedPatient: vi.fn(),
}));

vi.mock('@/lib/booking', () => ({
  createSlotHold: vi.fn(),
}));

describe('Phase 67: Concurrency, Invariants & Race Conditions Test Suite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('67.1 Concurrent slot holds by two patients: exactly one wins and second gets 409 Conflict', async () => {
    // Both patients are authenticated
    vi.mocked(requestAuth.getAuthenticatedPatient)
      .mockResolvedValueOnce({ id: 'pat_1' } as any)
      .mockResolvedValueOnce({ id: 'pat_2' } as any);

    // First patient succeeds creating the hold
    vi.mocked(booking.createSlotHold)
      .mockResolvedValueOnce({
        kind: 'success',
        token: 'hold_token_winner',
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      } as any)
      // Second patient encounters slot already held/conflict
      .mockResolvedValueOnce({
        kind: 'conflict',
      } as any);

    // Patient 1 request
    const req1 = new NextRequest('http://localhost:3000/api/appointments/hold', {
      method: 'POST',
      body: JSON.stringify({ slotId: 'slot_race_1', doctorId: 'doc_1' }),
    });
    const res1 = await holdPOST(req1);
    expect(res1.status).toBe(201);
    const data1 = await res1.json();
    expect(data1.holdToken).toBe('hold_token_winner');

    // Patient 2 concurrent request
    const req2 = new NextRequest('http://localhost:3000/api/appointments/hold', {
      method: 'POST',
      body: JSON.stringify({ slotId: 'slot_race_1', doctorId: 'doc_1' }),
    });
    const res2 = await holdPOST(req2);
    expect(res2.status).toBe(409);
    const data2 = await res2.json();
    expect(data2.error).toMatch(/no longer available/i);
  });

  it('67.2 Double completion requests: first completes and credits, second is idempotent without double credit', async () => {
    // First completion: status is CONFIRMED -> transitions to COMPLETED
    vi.mocked(prisma.appointment.findFirst).mockResolvedValueOnce({
      id: 'appt_comp_race',
      status: 'CONFIRMED',
      doctorId: 'doc_1',
      slotId: 'slot_1',
      paymentMethod: 'ONLINE',
      transactionId: 'tx_online_123',
      doctor: { fees: 600, user: { id: 'doc_u_1', name: 'Dr. House' } },
      patient: { user: { id: 'pat_u_1', name: 'Patient One' } },
      slot: { date: new Date('2026-10-12') },
    } as any);

    vi.mocked(prisma.appointment.update).mockResolvedValueOnce({
      id: 'appt_comp_race',
      status: 'COMPLETED',
    } as any);

    const req1 = new NextRequest('http://localhost:3000/api/doctors/doc_1/appointments/appt_comp_race', {
      method: 'PATCH',
      body: JSON.stringify({ status: 'COMPLETED' }),
    });

    const res1 = await doctorAppointmentPATCH(req1, { params: Promise.resolve({ doctorId: 'doc_1', appointmentId: 'appt_comp_race' }) });
    expect(res1.status).toBe(200);
    expect(prisma.doctor.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'doc_1' },
        data: { balance: { increment: 60000 } }, // 600 * 100 paise
      })
    );

    // Reset doctor update mock for second call
    vi.mocked(prisma.doctor.update).mockClear();

    // Second completion on already COMPLETED appointment (appointmentBefore.status === 'COMPLETED')
    vi.mocked(prisma.appointment.findFirst).mockResolvedValueOnce({
      id: 'appt_comp_race',
      status: 'COMPLETED',
      doctorId: 'doc_1',
      slotId: 'slot_1',
      paymentMethod: 'ONLINE',
      transactionId: 'tx_online_123',
      doctor: { fees: 600, user: { id: 'doc_u_1', name: 'Dr. House' } },
      patient: { user: { id: 'pat_u_1', name: 'Patient One' } },
      slot: { date: new Date('2026-10-12') },
    } as any);

    const req2 = new NextRequest('http://localhost:3000/api/doctors/doc_1/appointments/appt_comp_race', {
      method: 'PATCH',
      body: JSON.stringify({ status: 'COMPLETED' }),
    });

    const res2 = await doctorAppointmentPATCH(req2, { params: Promise.resolve({ doctorId: 'doc_1', appointmentId: 'appt_comp_race' }) });
    expect(res2.status).toBe(200);
    // Already completed: status !== appointmentBefore.status is false, balance is NOT incremented again
    expect(prisma.doctor.update).not.toHaveBeenCalled();
  });

  it('67.3 Concurrent withdrawals: total deducted never exceeds doctor balance', async () => {
    vi.mocked(prisma.doctor.findUnique).mockResolvedValue({
      id: 'doc_1',
      balance: 100000, // ₹1,000 in paise
      user: {
        bankAccounts: [
          {
            bankAccountNumber: '98765432101',
            bankIFSC: 'HDFC0001234',
            bankAccountHolderName: 'Dr. John',
            bankName: 'HDFC Bank',
          },
        ],
      },
    } as any);

    // Mock atomic transaction: first withdrawal of ₹800 succeeds, second concurrent withdrawal of ₹800 fails
    vi.mocked(prisma.$transaction)
      .mockImplementationOnce(async (cb: any) => {
        return cb({
          doctor: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
          withdrawal: { create: vi.fn().mockResolvedValue({ id: 'w_race_1', amount: 80000, status: 'COMPLETED' }) },
        });
      })
      .mockImplementationOnce(async (cb: any) => {
        // Second concurrent withdrawal fails atomic decrement (count: 0)
        return cb({
          doctor: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
          withdrawal: { create: vi.fn() },
        });
      });

    // Request 1: ₹800 withdrawal
    const req1 = new NextRequest('http://localhost:3000/api/doctors/doc_1/withdrawals', {
      method: 'POST',
      body: JSON.stringify({ amount: 800 }),
    });
    const res1 = await withdrawalPOST(req1, { params: Promise.resolve({ doctorId: 'doc_1' }) });
    expect(res1.status).toBe(201);

    // Request 2: concurrent ₹800 withdrawal (exceeds remaining balance)
    const req2 = new NextRequest('http://localhost:3000/api/doctors/doc_1/withdrawals', {
      method: 'POST',
      body: JSON.stringify({ amount: 800 }),
    });
    const res2 = await withdrawalPOST(req2, { params: Promise.resolve({ doctorId: 'doc_1' }) });
    expect(res2.status).toBe(400);
    const data2 = await res2.json();
    expect(data2.error).toMatch(/Insufficient balance/i);
  });
});
