import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/prisma';
import { logAudit } from '@/lib/logger';
import { buildUserPayload, buildBankAccountPayload } from '@/__tests__/helpers/factories';

describe('Phase 44: Withdrawal Failure & Balance Restoration Test Suite', () => {
  let docUserId: string;
  let docId: string;
  const createdWithdrawalIds: string[] = [];

  beforeAll(async () => {
    const docPayload = buildUserPayload({
      name: 'Dr. Failover Doctor',
      email: `doc_fail_${Date.now()}@quickclinic.test`,
      role: 'DOCTOR',
    });
    const docUser = await prisma.user.create({
      data: {
        name: docPayload.name,
        email: docPayload.email,
        phoneNo: docPayload.phoneNo,
        password: docPayload.password,
        age: 41,
        address: docPayload.address,
        role: 'DOCTOR',
        gender: 'FEMALE',
        location: {
          connectOrCreate: {
            where: { pincode: 121004 },
            create: { pincode: 121004, city: 'Faridabad', state: 'Haryana' },
          },
        },
      },
    });
    docUserId = docUser.id;

    const d = await prisma.doctor.create({
      data: {
        userId: docUser.id,
        specialty: 'PATHOLOGIST',
        fees: 700,
        experience: 11,
        balance: 200000, // ₹2000 in paise
      },
    });
    docId = d.id;

    const bankPayload = buildBankAccountPayload();
    await prisma.bankAccount.create({
      data: {
        userId: docUserId,
        bankAccountNumber: bankPayload.bankAccountNumber,
        bankIFSC: bankPayload.bankIFSC,
        bankAccountHolderName: bankPayload.bankAccountHolderName,
        bankName: bankPayload.bankName,
      },
    });
  });

  afterAll(async () => {
    try {
      if (createdWithdrawalIds.length > 0) {
        await prisma.withdrawal.deleteMany({ where: { id: { in: createdWithdrawalIds } } });
      }
      await prisma.bankAccount.deleteMany({ where: { userId: docUserId } });
      await prisma.auditLog.deleteMany({ where: { userId: docUserId } });
      await prisma.doctor.deleteMany({ where: { id: docId } });
      await prisma.user.deleteMany({ where: { id: docUserId } });
    } catch (e) {
      console.warn('Phase 44 cleanup warning:', e);
    }
  });

  it('44.1 Processing payout failure transitions withdrawal to FAILED and records failureReason', async () => {
    // 1. Initiate withdrawal (deducts 50,000 paise / ₹500 from balance)
    const withdrawalAmount = 50000;
    const docBefore = await prisma.doctor.findUnique({ where: { id: docId } });
    const initialBalance = docBefore!.balance; // 200,000 paise

    // Decrement balance as part of initiating
    await prisma.doctor.update({
      where: { id: docId },
      data: { balance: { decrement: withdrawalAmount } },
    });

    const w = await prisma.withdrawal.create({
      data: {
        doctorId: docId,
        amount: withdrawalAmount,
        currency: 'INR',
        status: 'PROCESSING',
        razorpayPayoutId: 'pout_fail_test_777',
      },
    });
    createdWithdrawalIds.push(w.id);

    // 2. Simulate Provider Failure Event: Mark FAILED, restore balance and create audit log
    const failureReason = 'Gateway Timeout / Beneficiary Bank Unavailable';
    const failedWithdrawal = await prisma.$transaction(async (tx) => {
      const updated = await tx.withdrawal.update({
        where: { id: w.id },
        data: {
          status: 'FAILED',
          failureReason,
          processedAt: new Date(),
        },
      });

      // Restore doctor balance
      await tx.doctor.update({
        where: { id: docId },
        data: {
          balance: { increment: withdrawalAmount },
        },
      });

      return updated;
    });

    await logAudit(docUserId, 'WITHDRAWAL_FAILED_REFUNDED', {
      withdrawalId: w.id,
      amount: withdrawalAmount,
      failureReason,
    }, 'FINANCIAL');

    expect(failedWithdrawal.status).toBe('FAILED');
    expect(failedWithdrawal.failureReason).toBe(failureReason);

    // 3. Verify Doctor Balance is fully restored
    const docAfter = await prisma.doctor.findUnique({ where: { id: docId } });
    expect(docAfter!.balance).toBe(initialBalance); // Restored back to 200,000 paise
  });

  it('44.2 Audit log is generated for the failed withdrawal with safe metadata', async () => {
    const auditLogs = await prisma.auditLog.findMany({
      where: {
        userId: docUserId,
        action: 'WITHDRAWAL_FAILED_REFUNDED',
      },
    });

    expect(auditLogs.length).toBeGreaterThanOrEqual(1);
    expect(auditLogs[0].tag).toBe('FINANCIAL');
    const metadata = JSON.parse(auditLogs[0].metadata as string);
    expect(metadata.amount).toBe(50000);
    expect(metadata.failureReason).toBeDefined();
    // Verify no private secrets or full bank accounts in metadata
    expect(metadata.bankAccountNumber).toBeUndefined();
    expect(metadata.password).toBeUndefined();
  });
});
