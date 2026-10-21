// @vitest-environment happy-dom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import BookTimeSlot from '@/components/patient/bookTimeSlot';
import { useUserStore } from '@/store/userStore';

// Mock zustand user store
vi.mock('@/store/userStore', () => ({
  useUserStore: vi.fn(),
}));

const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
    refresh: vi.fn(),
  }),
}));

vi.mock('@/lib/toast', () => ({
  showToast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  },
}));

describe('Unified Checkout Browser Flow Test', () => {
  const mockDoctorId = 'doc_test_123';
  const mockSlots = [
    {
      id: 'slot_avail_1',
      doctorId: mockDoctorId,
      date: '2026-10-10T00:00:00.000Z',
      startTime: '2026-10-10T10:00:00.000Z',
      endTime: '2026-10-10T10:15:00.000Z',
      status: 'AVAILABLE',
    },
    {
      id: 'slot_avail_2',
      doctorId: mockDoctorId,
      date: '2026-10-10T00:00:00.000Z',
      startTime: '2026-10-10T10:15:00.000Z',
      endTime: '2026-10-10T10:30:00.000Z',
      status: 'AVAILABLE',
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    delete (window as any).Razorpay;

    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-10T08:00:00.000Z'));

    (useUserStore as any).mockImplementation((selector: any) =>
      selector({
        user: { id: 'user_patient_99', name: 'Patient Test', email: 'patient@test.com' },
      })
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('1. Selecting a doctor slot only updates frontend selection without calling any hold endpoint', async () => {
    const fetchCalls: { url: string; method: string }[] = [];
    global.fetch = vi.fn().mockImplementation((url: string, opts?: any) => {
      fetchCalls.push({ url, method: opts?.method || 'GET' });
      if (url.includes('/api/doctors/') && url.includes('/slots')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ slots: mockSlots }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });

    const user = userEvent.setup();
    render(<BookTimeSlot doctorId={mockDoctorId} />);

    await waitFor(() => {
      expect(screen.getByText('10:00 AM')).toBeDefined();
    });

    // Click slot
    const slotButton = screen.getByText('10:00 AM');
    await user.click(slotButton);

    // "Proceed to Book" button is displayed
    const proceedBtn = screen.getByRole('button', { name: /Proceed to Book/i });
    expect(proceedBtn).toBeDefined();

    // Verify NO hold endpoint was called!
    const holdCalls = fetchCalls.filter((c) => c.url.includes('/api/appointments/hold') || c.url.includes('/hold'));
    expect(holdCalls.length).toBe(0);
  });

  it('2. Clicking "Pay at Clinic" calls POST /api/checkout with action: INITIATE and paymentMethod: OFFLINE', async () => {
    let checkoutRequestBody: any = null;
    global.fetch = vi.fn().mockImplementation((url: string, opts?: any) => {
      if (url.includes('/api/doctors/') && url.includes('/slots')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ slots: mockSlots }),
        });
      }
      if (url.includes('/api/checkout') && opts?.method === 'POST') {
        checkoutRequestBody = JSON.parse(opts.body);
        return Promise.resolve({
          ok: true,
          status: 201,
          json: async () => ({
            ok: true,
            checkoutId: 'chk_offline_123',
            status: 'CONFIRMED',
            paymentMethod: 'OFFLINE',
            appointment: { id: 'appt_offline_123', status: 'CONFIRMED' },
          }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });

    const user = userEvent.setup();
    render(<BookTimeSlot doctorId={mockDoctorId} />);

    await waitFor(() => {
      expect(screen.getByText('10:00 AM')).toBeDefined();
    });

    await user.click(screen.getByText('10:00 AM'));
    await user.click(screen.getByRole('button', { name: /Proceed to Book/i }));

    const offlineBtn = screen.getByRole('button', { name: /Pay at Clinic/i });
    expect(offlineBtn).toBeDefined();
    await user.click(offlineBtn);

    await waitFor(() => {
      expect(checkoutRequestBody).toBeDefined();
      expect(checkoutRequestBody.action).toBe('INITIATE');
      expect(checkoutRequestBody.paymentMethod).toBe('OFFLINE');
      expect(checkoutRequestBody.doctorId).toBe(mockDoctorId);
      expect(checkoutRequestBody.slotId).toBe('slot_avail_1');
      expect(checkoutRequestBody.idempotencyKey).toBeDefined();
    });
  });

  it('3. Preserves idempotency key in sessionStorage for the logical attempt', async () => {
    let capturedKey1: string | null = null;
    let capturedKey2: string | null = null;

    global.fetch = vi.fn().mockImplementation((url: string, opts?: any) => {
      if (url.includes('/api/doctors/') && url.includes('/slots')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ slots: mockSlots }),
        });
      }
      if (url.includes('/api/checkout') && opts?.method === 'POST') {
        const body = JSON.parse(opts.body);
        if (!capturedKey1) {
          capturedKey1 = body.idempotencyKey;
          // Return retryable error
          return Promise.resolve({
            ok: false,
            status: 500,
            json: async () => ({ error: 'Transient error' }),
          });
        } else {
          capturedKey2 = body.idempotencyKey;
          return Promise.resolve({
            ok: true,
            status: 201,
            json: async () => ({
              ok: true,
              checkoutId: 'chk_123',
              status: 'CONFIRMED',
              paymentMethod: 'OFFLINE',
              appointment: { id: 'appt_123', status: 'CONFIRMED' },
            }),
          });
        }
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });

    const user = userEvent.setup();
    render(<BookTimeSlot doctorId={mockDoctorId} />);

    await waitFor(() => expect(screen.getByText('10:00 AM')).toBeDefined());
    await user.click(screen.getByText('10:00 AM'));
    await user.click(screen.getByRole('button', { name: /Proceed to Book/i }));

    // Attempt 1 fails
    await user.click(screen.getByRole('button', { name: /Pay at Clinic/i }));
    await waitFor(() => expect(capturedKey1).toBeDefined());

    // Attempt 2 retry: must preserve the exact same idempotency key from sessionStorage!
    await user.click(screen.getByRole('button', { name: /Pay at Clinic/i }));
    await waitFor(() => expect(capturedKey2).toBeDefined());

    expect(capturedKey1).toBe(capturedKey2);
  });
});
