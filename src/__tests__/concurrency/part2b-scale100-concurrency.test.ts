import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { createToken } from '@/lib/auth';
import { POST as holdPOST } from '@/app/api/appointments/hold/route';
import { PATCH as doctorAppointmentPATCH } from '@/app/api/doctors/[doctorId]/appointments/[appointmentId]/route';
import { POST as withdrawalPOST } from '@/app/api/doctors/[doctorId]/withdrawals/route';
import { seedPart2Dataset, cleanupPart2Dataset, Part2Dataset } from '@/__tests__/helpers/part2-dataset';

describe('PART 2B — High-Scale Concurrency Invariant Verification (100x Scale)', () => {
  let dataset: Part2Dataset;
  let doctor: any;
  let doctorToken: string;
  let patientTokens100: { token: string; patientId: string }[] = [];

  beforeAll(async () => {
    dataset = await seedPart2Dataset('p2b_conc');
    doctor = dataset.doctors[0];

    doctorToken = await createToken({
      id: doctor.id,
      userId: doctor.id,
      role: 'DOCTOR',
      email: doctor.email,
      name: doctor.name,
    });

    // Create 100 patient auth tokens for high concurrency testing
    for (let i = 0; i < 100; i++) {
      const patient = dataset.patients[i % dataset.patients.length];
      const token = await createToken({
        id: patient.id,
        userId: patient.id,
        role: 'PATIENT',
        email: `p2b_user_${i}@quickclinic.test`,
        name: `Scale Patient ${i}`,
      });
      patientTokens100.push({ token, patientId: patient.id });
    }
  }, 30000);

  afterAll(async () => {
    if (dataset) {
      await cleanupPart2Dataset(dataset);
    }
  });

  // ==========================================
  // SECTION 1: SAME-SLOT CONTENTION — SCALE TO 100 (3 REPETITIONS)
  // ==========================================
  describe('1. Same-Slot Contention — Scale to 100 (3 Fresh Trials)', () => {
    for (let trial = 1; trial <= 3; trial++) {
      it(`Trial ${trial}/3: 100 concurrent hold requests -> Exactly 1 hold winner (201), 99 conflicts (409)`, async () => {
        // 1. Create a fresh available slot in DB
        const futureDate = new Date();
        futureDate.setDate(futureDate.getDate() + 30 + trial);
        const slotEnd = new Date(futureDate);
        slotEnd.setMinutes(slotEnd.getMinutes() + 30);

        const slot = await prisma.slot.create({
          data: {
            doctorId: doctor.doctorId,
            date: futureDate,
            startTime: futureDate,
            endTime: slotEnd,
            status: 'AVAILABLE',
          },
        });

        // 2. Launch 100 truly concurrent hold requests
        const requests = patientTokens100.map(({ token }) => {
          const req = new NextRequest('http://localhost:3000/api/appointments/hold', {
            method: 'POST',
            headers: {
              authorization: `Bearer ${token}`,
              'content-type': 'application/json',
            },
            body: JSON.stringify({
              slotId: slot.id,
              doctorId: doctor.doctorId,
            }),
          });
          return holdPOST(req);
        });

        const responses = await Promise.all(requests);
        const statuses = responses.map((r) => r.status);

        const successCount = statuses.filter((s) => s === 201).length;
        const conflictCount = statuses.filter((s) => s === 409).length;

        expect(successCount).toBe(1);
        expect(conflictCount).toBe(99);

        // 3. Verify PostgreSQL database state
        const slotInDb = await prisma.slot.findUnique({ where: { id: slot.id } });
        expect(slotInDb?.status).toBe('HELD');
        expect(slotInDb?.holdToken).toBeDefined();
        expect(slotInDb?.heldByPatientId).toBeDefined();
        expect(slotInDb?.holdExpiresAt).toBeDefined();

        // 4. Verify no appointments exist or <= 1
        const apptCount = await prisma.appointment.count({ where: { slotId: slot.id } });
        expect(apptCount).toBeLessThanOrEqual(1);
      });
    }
  });

  // ==========================================
  // SECTION 2: EARNINGS CONCURRENCY — SCALE TO 100
  // ==========================================
  describe('2. Doctor Earnings Concurrency — Scale to 100 Appointments', () => {
    it('100 online appointments @ ₹500 completed concurrently -> Exact credit 5,000,000 paise + Replay Idempotency', async () => {
      // 1. Reset doctor balance to 0 and fee to ₹500
      await prisma.doctor.update({
        where: { id: doctor.doctorId },
        data: { balance: 0, fees: 500 },
      });

      const appointmentCount = 100;
      const initialBalance = 0;
      const appointments: any[] = [];

      // 2. Create 100 slots and 100 confirmed online appointments
      for (let i = 0; i < appointmentCount; i++) {
        const slotDate = new Date();
        slotDate.setDate(slotDate.getDate() + 10 + Math.floor(i / 5));
        slotDate.setMinutes(slotDate.getMinutes() + (i % 5) * 30);
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

        const patient = dataset.patients[i % dataset.patients.length];
        const appt = await prisma.appointment.create({
          data: {
            doctorId: doctor.doctorId,
            patientId: patient.patientId,
            slotId: slot.id,
            status: 'CONFIRMED',
            paymentMethod: 'ONLINE',
            transactionId: `txn_scale100_${i}_${Date.now()}`,
            isAppointmentOffline: false,
          },
        });
        appointments.push(appt);
      }

      // 3. Fire completion requests for all 100 appointments concurrently
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
      const successfulTransitions = responses.filter((r) => r.status === 200).length;
      expect(successfulTransitions).toBe(100);

      // Expected exact credit: 100 * 500 INR * 100 paise = 5,000,000 paise
      const expectedPaise = 100 * 500 * 100;
      const docAfterCompletions = await prisma.doctor.findUnique({ where: { id: doctor.doctorId } });
      expect(docAfterCompletions?.balance).toBe(expectedPaise);

      // 4. Duplicate Replay Invariant: Replay all 100 completion requests
      const replayRequests = appointments.map((appt) => {
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

      const replayResponses = await Promise.all(replayRequests);
      const duplicateRetryCount = replayResponses.length;
      expect(duplicateRetryCount).toBe(100);

      const docAfterReplay = await prisma.doctor.findUnique({ where: { id: doctor.doctorId } });
      expect(docAfterReplay?.balance).toBe(expectedPaise); // STRICTLY PRESERVED: exactly 5,000,000 paise
    }, 60000);
  });

  // ==========================================
  // SECTION 3: WITHDRAWAL CONCURRENCY — 10 & 50 SCALE
  // ==========================================
  describe('3. Withdrawal Concurrency — Higher Scale (10 & 50 Requests)', () => {
    it('3.1 10 concurrent withdrawals of ₹1,000 against ₹5,000 balance -> Exactly 5 succeed, 5 fail, balance = 0', async () => {
      const startingPaise = 500000; // ₹5,000
      await prisma.doctor.update({
        where: { id: doctor.doctorId },
        data: { balance: startingPaise },
      });

      const requestCount = 10;
      const withdrawAmount = 1000; // ₹1,000 = 100,000 paise each

      const requests = Array.from({ length: requestCount }).map(() => {
        const req = new NextRequest(`http://localhost:3000/api/doctors/${doctor.doctorId}/withdrawals`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${doctorToken}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            amount: withdrawAmount,
            currency: 'INR',
            bankAccountNumber: '98765432101234',
            bankIFSC: 'HDFC0001234',
            bankAccountHolderName: 'Dr. Scale Withdrawal',
            bankName: 'HDFC Bank',
          }),
        });
        return withdrawalPOST(req, {
          params: Promise.resolve({ doctorId: doctor.doctorId }),
        });
      });

      const responses = await Promise.all(requests);
      const statuses = responses.map((r) => r.status);

      const successCount = statuses.filter((s) => s === 201).length;
      const failCount = statuses.filter((s) => s === 400).length;

      expect(successCount).toBe(5);
      expect(failCount).toBe(5);

      const docInDb = await prisma.doctor.findUnique({ where: { id: doctor.doctorId } });
      expect(docInDb?.balance).toBe(0);
      expect(docInDb?.balance).toBeGreaterThanOrEqual(0);
    });

    it('3.2 50 concurrent withdrawals of ₹500 against ₹10,000 balance -> Exactly 20 succeed, 30 fail, balance = 0', async () => {
      const startingPaise = 1000000; // ₹10,000 (1,000,000 paise)
      await prisma.doctor.update({
        where: { id: doctor.doctorId },
        data: { balance: startingPaise },
      });

      const requestCount = 50;
      const withdrawAmount = 500; // ₹500 = 50,000 paise each (50 * 500 = ₹25,000 requested vs ₹10,000 available)

      const requests = Array.from({ length: requestCount }).map(() => {
        const req = new NextRequest(`http://localhost:3000/api/doctors/${doctor.doctorId}/withdrawals`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${doctorToken}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            amount: withdrawAmount,
            currency: 'INR',
            bankAccountNumber: '98765432101234',
            bankIFSC: 'HDFC0001234',
            bankAccountHolderName: 'Dr. Scale 50 Withdrawal',
            bankName: 'HDFC Bank',
          }),
        });
        return withdrawalPOST(req, {
          params: Promise.resolve({ doctorId: doctor.doctorId }),
        });
      });

      const responses = await Promise.all(requests);
      const statuses = responses.map((r) => r.status);

      const successCount = statuses.filter((s) => s === 201).length;
      const failCount = statuses.filter((s) => s === 400).length;

      // Exactly 20 successful withdrawals of ₹500 (20 * 50,000 = 1,000,000 paise)
      expect(successCount).toBe(20);
      expect(failCount).toBe(30);

      const docInDb = await prisma.doctor.findUnique({ where: { id: doctor.doctorId } });
      expect(docInDb?.balance).toBe(0);
      expect(docInDb?.balance).toBeGreaterThanOrEqual(0);
    });
  });
});
