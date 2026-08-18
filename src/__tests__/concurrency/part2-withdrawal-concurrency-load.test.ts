import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { createToken } from '@/lib/auth';
import { POST as withdrawalPOST } from '@/app/api/doctors/[doctorId]/withdrawals/route';
import { seedPart2Dataset, cleanupPart2Dataset, Part2Dataset } from '@/__tests__/helpers/part2-dataset';

describe('Phase 14 — Withdrawal Load & Balance Overdraw Invariant Suite', () => {
  let dataset: Part2Dataset;
  let doctor: any;
  let doctorToken: string;

  beforeAll(async () => {
    dataset = await seedPart2Dataset();
    doctor = dataset.doctors[0];

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

  it('14.1 Withdrawal Concurrency: parallel requests cannot overdraft balance (sum of reserved withdrawals <= starting balance)', async () => {
    // Starting balance: ₹1,000 = 100,000 paise
    const startingPaise = 100000;
    await prisma.doctor.update({
      where: { id: doctor.doctorId },
      data: { balance: startingPaise },
    });

    // 10 concurrent requests of ₹200 (20,000 paise each) -> Total requested = ₹2,000 (200,000 paise)
    // Starting balance can only satisfy at most 5 withdrawals (5 * 20,000 = 100,000). Remaining 5 must fail.
    const requestCount = 10;
    const withdrawAmount = 200;

    const withdrawalRequests = Array.from({ length: requestCount }).map(() => {
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
          bankAccountHolderName: 'Dr. Test Concurrency',
          bankName: 'HDFC Bank',
        }),
      });
      return withdrawalPOST(req, {
        params: Promise.resolve({ doctorId: doctor.doctorId }),
      });
    });

    const responses = await Promise.all(withdrawalRequests);
    const statuses = responses.map((r) => r.status);

    const successCount = statuses.filter((s) => s === 201).length;
    const failCount = statuses.filter((s) => s === 400).length;

    // Must never overdraft
    expect(successCount * withdrawAmount * 100).toBeLessThanOrEqual(startingPaise);
    expect(successCount + failCount).toBe(requestCount);

    const docInDb = await prisma.doctor.findUnique({ where: { id: doctor.doctorId } });
    expect(docInDb?.balance).toBeGreaterThanOrEqual(0); // Balance NEVER drops below zero
    expect(docInDb?.balance).toBe(startingPaise - (successCount * withdrawAmount * 100));
  });
});
