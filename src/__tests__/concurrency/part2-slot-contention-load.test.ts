import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { createToken } from '@/lib/auth';
import { POST as holdPOST } from '@/app/api/appointments/hold/route';
import { seedPart2Dataset, cleanupPart2Dataset, Part2Dataset } from '@/__tests__/helpers/part2-dataset';

describe('Phase 12 — Same-Slot Contention Concurrency Invariant Suite', () => {
  let dataset: Part2Dataset;
  let doctor: any;
  let patientTokens: string[] = [];

  beforeAll(async () => {
    dataset = await seedPart2Dataset();
    doctor = dataset.doctors[0];

    for (let i = 0; i < 20; i++) {
      const patient = dataset.patients[i % dataset.patients.length];
      const token = await createToken({
        id: patient.id,
        userId: patient.id,
        role: 'PATIENT',
        email: patient.email,
        name: patient.name,
      });
      patientTokens.push(token);
    }
  });

  afterAll(async () => {
    if (dataset) {
      await cleanupPart2Dataset(dataset);
    }
  });

  it('12.1 High Concurrency Hold Race: exactly ONE winner acquires the hold, others receive 409 Conflict', async () => {
    // 1. Create a single AVAILABLE slot in DB
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 30);
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

    // 2. Fire 20 parallel hold requests from distinct patients
    const requests = patientTokens.map((token) => {
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
    const statusCodes = responses.map((r) => r.status);

    const successCount = statusCodes.filter((s) => s === 201).length;
    const conflictCount = statusCodes.filter((s) => s === 409).length;

    expect(successCount).toBe(1);
    expect(conflictCount).toBe(19);

    // 3. Verify Database state
    const slotInDb = await prisma.slot.findUnique({ where: { id: slot.id } });
    expect(slotInDb?.status).toBe('HELD');
    expect(slotInDb?.holdToken).toBeDefined();
    expect(slotInDb?.holdExpiresAt).toBeDefined();
  });
});
