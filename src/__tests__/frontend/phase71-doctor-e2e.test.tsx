// @vitest-environment happy-dom
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import DoctorAppointmentCard from '@/components/doctor/appointmentCard';
import type { DoctorAppointment } from '@/types/doctor';

vi.mock('@/store/userStore', () => ({
  useUserStore: (selector: any) => selector({ doctorId: 'doc_101', role: 'DOCTOR' }),
}));

vi.mock('@/lib/toast', () => ({
  showToast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

describe('Phase 71: Frontend Doctor E2E Component & Actions Test Suite', () => {
  it('71.1 Renders PENDING appointment with Confirm and Cancel action buttons', () => {
    const pendingAppt: DoctorAppointment = {
      id: 'appt_pend_1',
      patientId: 'pat_1',
      patientName: 'John Patient',
      patientGender: 'MALE',
      patientAge: 32,
      appointmentDate: '2026-11-20',
      appointmentTime: '2026-11-20T10:00:00.000Z',
      status: 'PENDING',
      paymentMethod: 'ONLINE',
      fees: 800,
    };

    render(<DoctorAppointmentCard appointment={pendingAppt} onStatusUpdate={vi.fn()} />);

    expect(screen.getByText('John Patient')).toBeDefined();
    expect(screen.getByText(/Pending/i)).toBeDefined();
    expect(screen.getByText('Confirm')).toBeDefined();
    expect(screen.getByText('Reject')).toBeDefined();
  });

  it('71.2 Renders CONFIRMED appointment with Complete and No Show action buttons', () => {
    const confirmedAppt: DoctorAppointment = {
      id: 'appt_conf_1',
      patientId: 'pat_2',
      patientName: 'Sarah Patient',
      patientGender: 'FEMALE',
      patientAge: 28,
      appointmentDate: '2026-11-20',
      appointmentTime: '2026-11-20T11:00:00.000Z',
      status: 'CONFIRMED',
      paymentMethod: 'OFFLINE',
      fees: 800,
    };

    render(<DoctorAppointmentCard appointment={confirmedAppt} onStatusUpdate={vi.fn()} />);

    expect(screen.getByText('Sarah Patient')).toBeDefined();
    expect(screen.getByText(/Confirmed/i)).toBeDefined();
    expect(screen.getByText('Complete')).toBeDefined();
    expect(screen.getByText('No Show')).toBeDefined();
  });

  it('71.3 Renders COMPLETED terminal appointment displaying completed badge without mutation buttons', () => {
    const completedAppt: DoctorAppointment = {
      id: 'appt_comp_1',
      patientId: 'pat_3',
      patientName: 'Robert Patient',
      patientGender: 'MALE',
      patientAge: 45,
      appointmentDate: '2026-11-20',
      appointmentTime: '2026-11-20T12:00:00.000Z',
      status: 'COMPLETED',
      paymentMethod: 'ONLINE',
      fees: 800,
    };

    render(<DoctorAppointmentCard appointment={completedAppt} onStatusUpdate={vi.fn()} />);

    expect(screen.getByText('Robert Patient')).toBeDefined();
    expect(screen.getByText(/Completed/i)).toBeDefined();
    expect(screen.queryByText('Confirm')).toBeNull();
    expect(screen.queryByText('Complete')).toBeNull();
  });
});
