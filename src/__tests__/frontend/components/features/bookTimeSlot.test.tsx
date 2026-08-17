// @vitest-environment happy-dom
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import BookTimeSlot from '@/components/patient/bookTimeSlot';
import { useUserStore } from '@/store/userStore';

// Mock zustand user store
vi.mock('@/store/userStore', () => ({
  useUserStore: vi.fn(),
}));

// Mock toast helper
vi.mock('@/lib/toast', () => ({
  showToast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

describe('BookTimeSlot Component - User Interaction & Component Test', () => {
  const mockDoctorId = 'doc_123';
  const mockSlots = [
    {
      id: 'slot_1',
      doctorId: mockDoctorId,
      date: '2026-10-10T00:00:00.000Z',
      startTime: '2026-10-10T10:00:00.000Z',
      endTime: '2026-10-10T10:15:00.000Z',
      status: 'AVAILABLE',
    },
    {
      id: 'slot_2',
      doctorId: mockDoctorId,
      date: '2026-10-10T00:00:00.000Z',
      startTime: '2026-10-10T10:15:00.000Z',
      endTime: '2026-10-10T10:30:00.000Z',
      status: 'AVAILABLE',
    },
    {
      id: 'slot_3',
      doctorId: mockDoctorId,
      date: '2026-10-10T00:00:00.000Z',
      startTime: '2026-10-10T10:30:00.000Z',
      endTime: '2026-10-10T10:45:00.000Z',
      status: 'BOOKED',
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    (useUserStore as any).mockImplementation((selector: any) =>
      selector({
        user: { id: 'user_pat_1', name: 'Patient Test' },
      })
    );

    // Mock global fetch
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/doctors/') && url.includes('/slots')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ slots: mockSlots }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({}),
      });
    });
  });

  it('renders date selector and fetches available slots', async () => {
    render(<BookTimeSlot doctorId={mockDoctorId} />);

    // Title should be visible
    await waitFor(() => {
      expect(screen.getByText(/Available Slots/i)).toBeDefined();
    });

    // Wait for slots to load
    await waitFor(() => {
      expect(screen.getByText('10:00 AM')).toBeDefined();
      expect(screen.getByText('10:15 AM')).toBeDefined();
    });
  });

  it('handles user slot selection with userEvent', async () => {
    const user = userEvent.setup();
    render(<BookTimeSlot doctorId={mockDoctorId} />);

    await waitFor(() => {
      expect(screen.getByText('10:00 AM')).toBeDefined();
    });

    const slotButton = screen.getByText('10:00 AM');
    await user.click(slotButton);

    // "Proceed to Book" button should now be enabled / visible
    const proceedButton = screen.getByRole('button', { name: /Proceed to Book/i });
    expect(proceedButton).toBeDefined();
  });
});
