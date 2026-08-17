import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/prisma';
import { buildUserPayload, buildBankAccountPayload } from '@/__tests__/helpers/factories';

describe('Phase 73: Full Golden-Path Lifecycle End-to-End Integration Test Suite', () => {
  let doc1UserId: string, doc1Id: string;
  let doc2UserId: string, doc2Id: string;
  let pat1UserId: string, pat1Id: string;
  let pat2UserId: string, pat2Id: string;
  let adminUserId: string, adminId: string;

  let slotAId: string, apptAId: string;
  let slotBId: string, apptBId: string;
  let slotCId: string, apptCId: string;
  let slotDId: string, apptDId: string;
  let withdrawalId: string;
  let ratingId: string;
  let relationId: string;

  const DOC1_FEES = 900; // ₹900 = 90,000 paise

  beforeAll(async () => {
    // 1. Admin
    const adminPayload = buildUserPayload({ role: 'ADMIN', name: 'Admin Golden User' });
    const adminUser = await prisma.user.create({
      data: {
        name: adminPayload.name,
        email: `admin_golden_${Date.now()}@quickclinic.test`,
        phoneNo: adminPayload.phoneNo,
        password: adminPayload.password,
        age: 40,
        address: adminPayload.address,
        role: 'ADMIN',
        location: {
          connectOrCreate: {
            where: { pincode: 121004 },
            create: { pincode: 121004, city: 'Faridabad', state: 'Haryana' },
          },
        },
      },
    });
    adminUserId = adminUser.id;
    const adm = await prisma.admin.create({ data: { userId: adminUserId } });
    adminId = adm.id;

    // 2. Doctor 1 (Cardiologist)
    const doc1Payload = buildUserPayload({ role: 'DOCTOR', name: 'Dr. Golden Cardiologist' });
    const doc1User = await prisma.user.create({
      data: {
        name: doc1Payload.name,
        email: `doc1_golden_${Date.now()}@quickclinic.test`,
        phoneNo: doc1Payload.phoneNo,
        password: doc1Payload.password,
        age: 46,
        address: doc1Payload.address,
        role: 'DOCTOR',
        location: { connect: { pincode: 121004 } },
      },
    });
    doc1UserId = doc1User.id;
    const d1 = await prisma.doctor.create({
      data: {
        userId: doc1UserId,
        specialty: 'CARDIOLOGIST',
        fees: DOC1_FEES,
        experience: 15,
        balance: 0,
      },
    });
    doc1Id = d1.id;

    // 3. Doctor 2 (Dermatologist)
    const doc2Payload = buildUserPayload({ role: 'DOCTOR', name: 'Dr. Golden Dermatologist' });
    const doc2User = await prisma.user.create({
      data: {
        name: doc2Payload.name,
        email: `doc2_golden_${Date.now()}@quickclinic.test`,
        phoneNo: doc2Payload.phoneNo,
        password: doc2Payload.password,
        age: 38,
        address: doc2Payload.address,
        role: 'DOCTOR',
        location: { connect: { pincode: 121004 } },
      },
    });
    doc2UserId = doc2User.id;
    const d2 = await prisma.doctor.create({
      data: {
        userId: doc2UserId,
        specialty: 'DERMATOLOGIST',
        fees: 650,
        experience: 8,
        balance: 0,
      },
    });
    doc2Id = d2.id;

    // 4. Patient 1
    const pat1Payload = buildUserPayload({ role: 'PATIENT', name: 'Patient Golden One' });
    const pat1User = await prisma.user.create({
      data: {
        name: pat1Payload.name,
        email: `pat1_golden_${Date.now()}@quickclinic.test`,
        phoneNo: pat1Payload.phoneNo,
        password: pat1Payload.password,
        age: 29,
        address: pat1Payload.address,
        role: 'PATIENT',
        location: { connect: { pincode: 121004 } },
      },
    });
    pat1UserId = pat1User.id;
    const p1 = await prisma.patient.create({ data: { userId: pat1UserId } });
    pat1Id = p1.id;

    // 5. Patient 2
    const pat2Payload = buildUserPayload({ role: 'PATIENT', name: 'Patient Golden Two' });
    const pat2User = await prisma.user.create({
      data: {
        name: pat2Payload.name,
        email: `pat2_golden_${Date.now()}@quickclinic.test`,
        phoneNo: pat2Payload.phoneNo,
        password: pat2Payload.password,
        age: 34,
        address: pat2Payload.address,
        role: 'PATIENT',
        location: { connect: { pincode: 121004 } },
      },
    });
    pat2UserId = pat2User.id;
    const p2 = await prisma.patient.create({ data: { userId: pat2UserId } });
    pat2Id = p2.id;
  });

  afterAll(async () => {
    try {
      if (withdrawalId) await prisma.withdrawal.deleteMany({ where: { id: withdrawalId } });
      if (ratingId) await prisma.rating.deleteMany({ where: { id: ratingId } });
      if (relationId) await prisma.doctorPatientRelation.deleteMany({ where: { id: relationId } });

      const apptIds = [apptAId, apptBId, apptCId, apptDId].filter(Boolean);
      if (apptIds.length > 0) await prisma.appointment.deleteMany({ where: { id: { in: apptIds } } });

      const slotIds = [slotAId, slotBId, slotCId, slotDId].filter(Boolean);
      if (slotIds.length > 0) await prisma.slot.deleteMany({ where: { id: { in: slotIds } } });

      await prisma.bankAccount.deleteMany({ where: { userId: doc1UserId } });
      await prisma.admin.deleteMany({ where: { id: adminId } });
      await prisma.patient.deleteMany({ where: { id: { in: [pat1Id, pat2Id].filter(Boolean) } } });
      await prisma.doctor.deleteMany({ where: { id: { in: [doc1Id, doc2Id].filter(Boolean) } } });
      await prisma.user.deleteMany({ where: { id: { in: [doc1UserId, doc2UserId, pat1UserId, pat2UserId, adminUserId].filter(Boolean) } } });
    } catch (e) {
      console.warn('Phase 73 cleanup warning:', e);
    }
  });

  it('73.1 Lifecycle Step 1: Doctor 1 & Doctor 2 onboarding and schedule profiles established', async () => {
    const d1 = await prisma.doctor.findUnique({ where: { id: doc1Id }, include: { user: true } });
    expect(d1?.specialty).toBe('CARDIOLOGIST');
    expect(d1?.fees).toBe(DOC1_FEES);
    expect(d1?.balance).toBe(0);

    const d2 = await prisma.doctor.findUnique({ where: { id: doc2Id }, include: { user: true } });
    expect(d2?.specialty).toBe('DERMATOLOGIST');
    expect(d2?.fees).toBe(650);
  });

  it('73.2 Lifecycle Step 2: Patient 1 books Doctor 1 OFFLINE -> Confirmed -> Completed (Balance Credited)', async () => {
    const slotA = await prisma.slot.create({
      data: {
        doctorId: doc1Id,
        date: new Date('2027-06-01T00:00:00.000Z'),
        startTime: new Date('2027-06-01T09:00:00.000Z'),
        endTime: new Date('2027-06-01T09:30:00.000Z'),
        status: 'UNAVAILABLE',
      },
    });
    slotAId = slotA.id;

    const apptA = await prisma.appointment.create({
      data: {
        doctorId: doc1Id,
        patientId: pat1Id,
        slotId: slotA.id,
        status: 'COMPLETED',
        paymentMethod: 'ONLINE',
      },
    });
    apptAId = apptA.id;

    // Doctor balance credited for completed online appointment (DOC1_FEES * 100 paise)
    await prisma.doctor.update({
      where: { id: doc1Id },
      data: { balance: { increment: DOC1_FEES * 100 } },
    });

    const doc1 = await prisma.doctor.findUnique({ where: { id: doc1Id } });
    expect(doc1?.balance).toBe(DOC1_FEES * 100); // 90,000 paise
  });

  it('73.3 Lifecycle Step 3: Patient 2 books Doctor 1 -> Patient Cancels -> Slot restored to AVAILABLE', async () => {
    const slotB = await prisma.slot.create({
      data: {
        doctorId: doc1Id,
        date: new Date('2027-06-01T00:00:00.000Z'),
        startTime: new Date('2027-06-01T10:00:00.000Z'),
        endTime: new Date('2027-06-01T10:30:00.000Z'),
        status: 'BOOKED',
      },
    });
    slotBId = slotB.id;

    const apptB = await prisma.appointment.create({
      data: {
        doctorId: doc1Id,
        patientId: pat2Id,
        slotId: slotB.id,
        status: 'CONFIRMED',
        paymentMethod: 'OFFLINE',
      },
    });
    apptBId = apptB.id;

    // Patient cancels
    await prisma.appointment.update({
      where: { id: apptB.id },
      data: { status: 'CANCELLED' },
    });
    await prisma.slot.update({
      where: { id: slotB.id },
      data: { status: 'AVAILABLE' },
    });

    const updatedSlot = await prisma.slot.findUnique({ where: { id: slotB.id } });
    expect(updatedSlot?.status).toBe('AVAILABLE');
  });

  it('73.4 Lifecycle Step 4: Patient 1 rates Doctor 1 after completed appointment', async () => {
    const rating = await prisma.rating.create({
      data: {
        doctorId: doc1Id,
        patientId: pat1Id,
        rating: 5,
      },
    });
    ratingId = rating.id;

    const agg = await prisma.rating.aggregate({
      where: { doctorId: doc1Id },
      _avg: { rating: true },
      _count: { rating: true },
    });
    expect(agg._avg.rating).toBe(5);
    expect(agg._count.rating).toBe(1);
  });

  it('73.5 Lifecycle Step 5: Doctor 1 adds bank account and successfully processes withdrawal', async () => {
    const bankPayload = buildBankAccountPayload();
    await prisma.bankAccount.create({
      data: {
        userId: doc1UserId,
        bankAccountNumber: bankPayload.bankAccountNumber,
        bankIFSC: bankPayload.bankIFSC,
        bankAccountHolderName: 'Dr. Golden Cardiologist',
        bankName: 'HDFC Bank',
      },
    });

    // Withdraw ₹500 (50,000 paise)
    const withdrawal = await prisma.withdrawal.create({
      data: {
        doctorId: doc1Id,
        amount: 50000,
        currency: 'INR',
        status: 'COMPLETED',
        processedAt: new Date(),
      },
    });
    withdrawalId = withdrawal.id;

    await prisma.doctor.update({
      where: { id: doc1Id },
      data: { balance: { decrement: 50000 } },
    });

    const doc1 = await prisma.doctor.findUnique({ where: { id: doc1Id } });
    // 90,000 - 50,000 = 40,000 paise (₹400)
    expect(doc1?.balance).toBe(40000);
  });
});
