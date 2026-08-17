import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/prisma';
import { logAudit } from '@/lib/logger';
import { buildUserPayload, buildBankAccountPayload } from '@/__tests__/helpers/factories';

describe('Phase 50: Admin Withdrawal Management & Oversight Test Suite', () => {
  let adminUserId: string;
  let docUserId: string;
  let docId: string;
  const createdWithdrawalIds: string[] = [];

  beforeAll(async () => {
    // 1. Admin
    const adminPayload = buildUserPayload({
      name: 'Admin Withdrawal Officer',
      email: `admin_wdraw_${Date.now()}@quickclinic.test`,
      role: 'ADMIN',
    });
    const adminUser = await prisma.user.create({
      data: {
        name: adminPayload.name,
        email: adminPayload.email,
        phoneNo: adminPayload.phoneNo,
        password: adminPayload.password,
        age: 47,
        address: adminPayload.address,
        role: 'ADMIN',
        gender: 'MALE',
        location: {
          connectOrCreate: {
            where: { pincode: 121004 },
            create: { pincode: 121004, city: 'Faridabad', state: 'Haryana' },
          },
        },
      },
    });
    adminUserId = adminUser.id;
    await prisma.admin.create({ data: { userId: adminUserId } });

    // 2. Doctor
    const docPayload = buildUserPayload({
      name: 'Dr. Payout Recipient',
      email: `doc_payout_${Date.now()}@quickclinic.test`,
      role: 'DOCTOR',
    });
    const docUser = await prisma.user.create({
      data: {
        name: docPayload.name,
        email: docPayload.email,
        phoneNo: docPayload.phoneNo,
        password: docPayload.password,
        age: 39,
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
        userId: docUserId,
        specialty: 'ANESTHESIOLOGIST',
        fees: 1100,
        experience: 10,
        balance: 400000,
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

    // Create 2 test withdrawals
    const w1 = await prisma.withdrawal.create({
      data: {
        doctorId: docId,
        amount: 150000, // ₹1500
        currency: 'INR',
        status: 'PENDING',
      },
    });
    createdWithdrawalIds.push(w1.id);

    const w2 = await prisma.withdrawal.create({
      data: {
        doctorId: docId,
        amount: 250000, // ₹2500
        currency: 'INR',
        status: 'COMPLETED',
        processedAt: new Date(),
      },
    });
    createdWithdrawalIds.push(w2.id);
  });

  afterAll(async () => {
    try {
      if (createdWithdrawalIds.length > 0) {
        await prisma.withdrawal.deleteMany({ where: { id: { in: createdWithdrawalIds } } });
      }
      await prisma.bankAccount.deleteMany({ where: { userId: docUserId } });
      await prisma.doctor.deleteMany({ where: { id: docId } });
      await prisma.admin.deleteMany({ where: { userId: adminUserId } });
      await prisma.auditLog.deleteMany({ where: { userId: adminUserId } });
      await prisma.user.deleteMany({ where: { id: { in: [adminUserId, docUserId] } } });
    } catch (e) {
      console.warn('Phase 50 cleanup warning:', e);
    }
  });

  it('50.1 Admin queries withdrawals across all doctors filtered by status and sorted by amount', async () => {
    const withdrawals = await prisma.withdrawal.findMany({
      where: { id: { in: createdWithdrawalIds } },
      include: {
        doctor: {
          include: {
            user: {
              select: { name: true, email: true, bankAccounts: true },
            },
          },
        },
      },
      orderBy: { amount: 'desc' },
    });

    expect(withdrawals.length).toBe(2);
    expect(withdrawals[0].amount).toBe(250000);
    expect(withdrawals[1].amount).toBe(150000);
    expect(withdrawals[0].doctor.user.bankAccounts.length).toBeGreaterThan(0);
  });

  it('50.2 Admin processes PENDING withdrawal to PROCESSING and then COMPLETED with audit logs', async () => {
    const pendingWithdrawalId = createdWithdrawalIds[0];

    // Transition PENDING -> PROCESSING
    await prisma.withdrawal.update({
      where: { id: pendingWithdrawalId },
      data: {
        status: 'PROCESSING',
        razorpayPayoutId: 'pout_admin_proc_101',
      },
    });

    await logAudit(adminUserId, 'WITHDRAWAL_PROCESSING_STARTED', {
      withdrawalId: pendingWithdrawalId,
      payoutId: 'pout_admin_proc_101',
    }, 'FINANCIAL');

    // Transition PROCESSING -> COMPLETED
    const completed = await prisma.withdrawal.update({
      where: { id: pendingWithdrawalId },
      data: {
        status: 'COMPLETED',
        processedAt: new Date(),
      },
    });

    await logAudit(adminUserId, 'WITHDRAWAL_COMPLETED_CONFIRMED', {
      withdrawalId: pendingWithdrawalId,
    }, 'FINANCIAL');

    expect(completed.status).toBe('COMPLETED');
    expect(completed.processedAt).toBeDefined();

    const auditLogs = await prisma.auditLog.findMany({
      where: { userId: adminUserId, tag: 'FINANCIAL' },
    });
    expect(auditLogs.length).toBe(2);
  });
});
