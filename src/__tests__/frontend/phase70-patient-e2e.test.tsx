// @vitest-environment happy-dom
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import DoctorCard from '@/components/doctor/doctorCard';
import PatientAppointmentCard from '@/components/patient/appointmentCard';
import type { Doctor } from '@/types/doctor';
import type { AppointmentDetail } from '@/types/common';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/patient/dashboard',
}));

describe('Phase 70: Frontend Patient E2E Component Flow Test Suite', () => {
  const mockDoctor: Doctor = {
    id: 'doc_101',
    userId: 'u_doc_101',
    name: 'Dr. Jane Watson',
    email: 'watson@quickclinic.test',
    phoneNo: '9876543210',
    age: 40,
    gender: 'FEMALE',
    specialty: 'CARDIOLOGIST',
    experience: 14,
    fees: 900,
    city: 'Faridabad',
    state: 'Haryana',
    address: '101 Health Ave',
    pinCode: 121004,
    balance: 0,
    qualifications: ['MBBS', 'MD'],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  it('70.1 Renders DoctorCard in search results with full credentials, fees, and location', () => {
    render(<DoctorCard doctor={mockDoctor} />);

    expect(screen.getByText('Dr. Jane Watson')).toBeDefined();
    expect(screen.getByText('CARDIOLOGIST')).toBeDefined();
    expect(screen.getByText(/14 years/i)).toBeDefined();
    expect(screen.getByText(/900/)).toBeDefined();
    expect(screen.getByText('Faridabad, Haryana')).toBeDefined();
    expect(screen.getByText(/MBBS, MD/)).toBeDefined();
  });

  it('70.2 Renders PatientAppointmentCard with confirmed status, doctor specialty, and date details', () => {
    const mockAppt = {
      id: 'appt_101',
      doctorId: 'doc_101',
      patientId: 'pat_101',
      doctorName: 'Jane Watson',
      specialty: 'CARDIOLOGIST',
      status: 'CONFIRMED' as any,
      appointmentDate: '2026-10-15',
      appointmentTime: '2026-10-15T09:00:00.000Z',
      city: 'Faridabad',
      fees: 900,
    };

    render(
      <PatientAppointmentCard
        appointment={mockAppt}
        onCancel={vi.fn()}
      />
    );

    expect(screen.getByText('Dr. Jane Watson')).toBeDefined();
    expect(screen.getByText('CARDIOLOGIST')).toBeDefined();
    expect(screen.getByText(/Confirmed/i)).toBeDefined();
    expect(screen.getByText('Faridabad')).toBeDefined();
    expect(screen.getByText('₹900')).toBeDefined();
  });
});
