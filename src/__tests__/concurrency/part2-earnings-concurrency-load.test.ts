import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { createToken } from '@/lib/auth';
import { PATCH as doctorAppointmentPATCH } from '@/app/api/doctors/[doctorId]/appointments/[appointmentId]/route';
import { seedPart2Dataset, cleanupPart2Dataset, Part2Dataset } from '@/__tests__/helpers/part2-dataset';

describe('Phase 13 — Doctor Earnings Concurrency & Financial Invariant Suite', () => {
  let dataset: Part2Dataset;
  let doctor: any;
  let doctorToken: string;
  let patient: any;

  beforeAll(async () => {
    dataset = await seedPart2Dataset();
    doctor = dataset.doctors[0]; // Fee ₹500
    patient = dataset.patients[0];

    doctorToken = await createToken({
      id: doctor.id,
      userId: doctor.id,
      role: 'DOCTOR',
      email: doctor.email,
      name: doctor.name,
    });
  });

  afterAll(async () => {
    if (dataset) {
      await cleanupPart2Dataset(dataset);
    }
  });

  it('13.1 Concurrency Earnings Invariant: 10 online appointments @ ₹500 credited exactly 500,000 paise with duplicate idempotency', async () => {
    // Reset starting doctor balance to 0
    await prisma.doctor.update({
      where: { id: doctor.doctorId },
      data: { balance: 0, fees: 500 },
    });

    const appointmentCount = 10;
    const appointments: any[] = [];

    for (let i = 0; i < appointmentCount; i++) {
      const slotDate = new Date();
      slotDate.setDate(slotDate.getDate() + 10 + i);
      const slotEnd = new Date(slotDate);
      slotEnd.setMinutes(slotEnd.getMinutes() + 30);

      const slot = await prisma.slot.create({
        data: {
          doctorId: doctor.doctorId,
          date: slotDate,
          startTime: slotDate,
          endTime: slotEnd,
          status: 'BOOKED',
        },
      });

      const appt = await prisma.appointment.create({
        data: {
          doctorId: doctor.doctorId,
          patientId: patient.patientId,
          slotId: slot.id,
          status: 'CONFIRMED',
          paymentMethod: 'ONLINE',
          transactionId: `txn_load_earn_${i}_${Date.now()}`,
          isAppointmentOffline: false,
        },
      });

      appointments.push(appt);
    }

    // Fire completion requests for all 10 appointments concurrently
    const completeRequests = appointments.map((appt) => {
      const req = new NextRequest(`http://localhost:3000/api/doctors/${doctor.doctorId}/appointments/${appt.id}`, {
        method: 'PATCH',
        headers: {
          authorization: `Bearer ${doctorToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ status: 'COMPLETED' }),
      });
      return doctorAppointmentPATCH(req, {
        params: Promise.resolve({ doctorId: doctor.doctorId, appointmentId: appt.id }),
      });
    });

    const responses = await Promise.all(completeRequests);
    for (const res of responses) {
      expect(res.status).toBe(200);
    }

    // Expected: 10 * 500 INR * 100 paise = 500,000 paise
    const expectedPaise = appointmentCount * 500 * 100;
    const docInDb = await prisma.doctor.findUnique({ where: { id: doctor.doctorId } });
    expect(docInDb?.balance).toBe(expectedPaise);

    // Duplicate Replay Invariant: Repeat completion requests on already completed appointments
    const repeatRequests = appointments.map((appt) => {
      const req = new NextRequest(`http://localhost:3000/api/doctors/${doctor.doctorId}/appointments/${appt.id}`, {
        method: 'PATCH',
        headers: {
          authorization: `Bearer ${doctorToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ status: 'COMPLETED' }),
      });
      return doctorAppointmentPATCH(req, {
        params: Promise.resolve({ doctorId: doctor.doctorId, appointmentId: appt.id }),
      });
    });

    await Promise.all(repeatRequests);

    const docAfterReplay = await prisma.doctor.findUnique({ where: { id: doctor.doctorId } });
    expect(docAfterReplay?.balance).toBe(expectedPaise); // Strictly preserved!
  });
});
