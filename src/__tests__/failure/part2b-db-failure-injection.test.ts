import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/prisma';
import { PrismaClient } from '@/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { seedPart2Dataset, cleanupPart2Dataset, Part2Dataset } from '@/__tests__/helpers/part2-dataset';

describe('PART 2B — Database Failure Injection & Transaction Rollback Verification', () => {
  let dataset: Part2Dataset;
  let doctor: any;
  let patient: any;

  beforeAll(async () => {
    dataset = await seedPart2Dataset('p2b_db_fail');
    doctor = dataset.doctors[0];
    patient = dataset.patients[0];
  }, 30000);

  afterAll(async () => {
    if (dataset) {
      await cleanupPart2Dataset(dataset);
    }
  });

  // --------------------------------------------------------------------------
  // 6.1 Temporary DB Outage & Controlled Failure Handling
  // --------------------------------------------------------------------------
  it('6.1 Temporary DB Outage: Unreachable DB connection string returns controlled failure without process crash', async () => {
    const deadDbAdapter = new PrismaPg({
      connectionString: 'postgresql://invalid_user:invalid_pass@127.0.0.1:59999/dead_db',
      connectionTimeoutMillis: 1500,
    });
    const deadPrisma = new PrismaClient({ adapter: deadDbAdapter });

    let caughtError: any = null;
    try {
      await deadPrisma.user.findFirst({ where: { id: 'dummy_id' } });
    } catch (e: any) {
      caughtError = e;
    } finally {
      await deadPrisma.$disconnect().catch(() => {});
    }

    expect(caughtError).toBeDefined();
    expect(caughtError.message || caughtError.code).toBeDefined();
  });

  // --------------------------------------------------------------------------
  // 6.2 DB Recovery: System functions normally after DB availability
  // --------------------------------------------------------------------------
  it('6.2 DB Recovery: Authoritative database client queries succeed cleanly', async () => {
    const docInDb = await prisma.doctor.findUnique({
      where: { id: doctor.doctorId },
      select: { id: true, balance: true, specialty: true },
    });

    expect(docInDb).toBeDefined();
    expect(docInDb?.id).toBe(doctor.doctorId);
  });

  // --------------------------------------------------------------------------
  // 6.3 Transaction Rollback — Forced Failure Halfway Through Booking
  // --------------------------------------------------------------------------
  it('6.3 Transaction Rollback (Booking): Halfway failure reverts slot status and prevents appointment creation', async () => {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 50);
    const slotEnd = new Date(futureDate);
    slotEnd.setMinutes(slotEnd.getMinutes() + 30);

    const slot = await prisma.slot.create({
      data: {
        doctorId: doctor.doctorId,
        date: futureDate,
        startTime: futureDate,
        endTime: slotEnd,
        status: 'HELD',
        heldByPatientId: patient.patientId,
        holdToken: 'test_token_rollback_1',
        holdExpiresAt: new Date(Date.now() + 600000),
      },
    });

    let txFailed = false;
    try {
      await prisma.$transaction(async (tx) => {
        // Step 1: Transition slot to BOOKED
        await tx.slot.update({
          where: { id: slot.id },
          data: { status: 'BOOKED' },
        });

        // Step 2: Simulate unexpected failure / exception before creating appointment
        throw new Error('SIMULATED_PAYMENT_GATEWAY_CRASH_MID_TRANSACTION');
      });
    } catch (e: any) {
      if (e.message === 'SIMULATED_PAYMENT_GATEWAY_CRASH_MID_TRANSACTION') {
        txFailed = true;
      }
    }

    expect(txFailed).toBe(true);

    // Verify slot remains HELD (rolled back)
    const slotAfter = await prisma.slot.findUnique({ where: { id: slot.id } });
    expect(slotAfter?.status).toBe('HELD');
    expect(slotAfter?.holdToken).toBe('test_token_rollback_1');

    // Verify no appointment was created
    const appt = await prisma.appointment.findFirst({ where: { slotId: slot.id } });
    expect(appt).toBeNull();
  });

  // --------------------------------------------------------------------------
  // 6.4 Transaction Rollback — Forced Failure Halfway Through Withdrawal
  // --------------------------------------------------------------------------
  it('6.4 Transaction Rollback (Withdrawal): Halfway failure preserves doctor balance and prevents partial record', async () => {
    const startingBalance = 200000; // ₹2,000 in paise
    await prisma.doctor.update({
      where: { id: doctor.doctorId },
      data: { balance: startingBalance },
    });

    let txFailed = false;
    try {
      await prisma.$transaction(async (tx) => {
        // Step 1: Decrement doctor balance
        await tx.doctor.update({
          where: { id: doctor.doctorId },
          data: { balance: { decrement: 50000 } },
        });

        // Step 2: Simulate banking gateway network crash before creating withdrawal record
        throw new Error('SIMULATED_BANK_SERVICE_TIMEOUT_MID_TRANSACTION');
      });
    } catch (e: any) {
      if (e.message === 'SIMULATED_BANK_SERVICE_TIMEOUT_MID_TRANSACTION') {
        txFailed = true;
      }
    }

    expect(txFailed).toBe(true);

    // Verify doctor balance strictly preserved (rolled back)
    const docAfter = await prisma.doctor.findUnique({ where: { id: doctor.doctorId } });
    expect(docAfter?.balance).toBe(startingBalance);
  });

  // --------------------------------------------------------------------------
  // 6.5 Transaction Rollback — Forced Failure Halfway Through Appointment Completion
  // --------------------------------------------------------------------------
  it('6.5 Transaction Rollback (Completion): Halfway failure preserves appointment status and balance', async () => {
    const startingBalance = 150000; // ₹1,500
    await prisma.doctor.update({
      where: { id: doctor.doctorId },
      data: { balance: startingBalance, fees: 500 },
    });

    const slotDate = new Date();
    slotDate.setDate(slotDate.getDate() + 51);
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
        transactionId: `txn_rollback_comp_${Date.now()}`,
        isAppointmentOffline: false,
      },
    });

    let txFailed = false;
    try {
      await prisma.$transaction(async (tx) => {
        // Step 1: Update appointment status to COMPLETED
        await tx.appointment.update({
          where: { id: appt.id },
          data: { status: 'COMPLETED' },
        });

        // Step 2: Simulate crash before balance increment / audit logging
        throw new Error('SIMULATED_CRASH_DURING_COMPLETION_PIPELINE');
      });
    } catch (e: any) {
      if (e.message === 'SIMULATED_CRASH_DURING_COMPLETION_PIPELINE') {
        txFailed = true;
      }
    }

    expect(txFailed).toBe(true);

    // Verify appointment status was rolled back to CONFIRMED
    const apptAfter = await prisma.appointment.findUnique({ where: { id: appt.id } });
    expect(apptAfter?.status).toBe('CONFIRMED');

    // Verify doctor balance unchanged
    const docAfter = await prisma.doctor.findUnique({ where: { id: doctor.doctorId } });
    expect(docAfter?.balance).toBe(startingBalance);
  });

  // --------------------------------------------------------------------------
  // 6.6 Connection Pressure: 30 concurrent transactions across pool
  // --------------------------------------------------------------------------
  it('6.6 Connection Pressure: 30 concurrent transactional operations execute cleanly across pool', async () => {
    const concurrentOps = Array.from({ length: 30 }).map(async (_, idx) => {
      return prisma.$transaction(async (tx) => {
        const doc = await tx.doctor.findUnique({
          where: { id: doctor.doctorId },
          select: { id: true, balance: true },
        });
        return { idx, docId: doc?.id };
      }, { maxWait: 15000, timeout: 20000 });
    });

    const results = await Promise.all(concurrentOps);
    expect(results.length).toBe(30);
    for (const res of results) {
      expect(res.docId).toBe(doctor.doctorId);
    }
  });
});
