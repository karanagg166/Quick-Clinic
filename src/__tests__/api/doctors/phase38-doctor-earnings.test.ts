import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { GET as earningsGET } from '@/app/api/doctors/[doctorId]/earnings/route';
import { GET as balanceGET } from '@/app/api/doctors/[doctorId]/balance/route';
import { prisma } from '@/lib/prisma';
import { buildUserPayload } from '@/__tests__/helpers/factories';

describe('Phase 38: Doctor Earnings Calculation & Balance Inquiries Test Suite', () => {
  let doc1UserId: string;
  let doc1Id: string;

  let doc2UserId: string;
  let doc2Id: string;

  let patientUserId: string;
  let patientId: string;

  const slotIds: string[] = [];
  const apptIds: string[] = [];

  beforeAll(async () => {
    // 1. Create Doctor 1 (fee: 800 INR)
    const doc1Payload = buildUserPayload({
      name: 'Dr. Earnings Master',
      email: `doc_earn1_${Date.now()}@quickclinic.test`,
      role: 'DOCTOR',
    });
    const doc1User = await prisma.user.create({
      data: {
        name: doc1Payload.name,
        email: doc1Payload.email,
        phoneNo: doc1Payload.phoneNo,
        password: doc1Payload.password,
        age: 49,
        address: doc1Payload.address,
        role: 'DOCTOR',
        gender: 'MALE',
        location: {
          connectOrCreate: {
            where: { pincode: 121004 },
            create: { pincode: 121004, city: 'Faridabad', state: 'Haryana' },
          },
        },
      },
    });
    doc1UserId = doc1User.id;

    const d1 = await prisma.doctor.create({
      data: {
        userId: doc1User.id,
        specialty: 'ORTHOPEDIC',
        fees: 800,
        experience: 16,
        balance: 160000, // 1600 INR in paise
      },
    });
    doc1Id = d1.id;

    // 2. Create Doctor 2 (for isolation)
    const doc2Payload = buildUserPayload({
      name: 'Dr. Other Earnings',
      email: `doc_earn2_${Date.now()}@quickclinic.test`,
      role: 'DOCTOR',
    });
    const doc2User = await prisma.user.create({
      data: {
        name: doc2Payload.name,
        email: doc2Payload.email,
        phoneNo: doc2Payload.phoneNo,
        password: doc2Payload.password,
        age: 40,
        address: doc2Payload.address,
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
    doc2UserId = doc2User.id;

    const d2 = await prisma.doctor.create({
      data: {
        userId: doc2User.id,
        specialty: 'PEDIATRICIAN',
        fees: 500,
        experience: 8,
        balance: 50000,
      },
    });
    doc2Id = d2.id;

    // 3. Create Patient
    const patPayload = buildUserPayload({
      name: 'Patient Earn Test',
      email: `pat_earn_${Date.now()}@quickclinic.test`,
      role: 'PATIENT',
    });
    const patUser = await prisma.user.create({
      data: {
        name: patPayload.name,
        email: patPayload.email,
        phoneNo: patPayload.phoneNo,
        password: patPayload.password,
        age: 33,
        address: patPayload.address,
        role: 'PATIENT',
        gender: 'MALE',
        location: {
          connectOrCreate: {
            where: { pincode: 121004 },
            create: { pincode: 121004, city: 'Faridabad', state: 'Haryana' },
          },
        },
      },
    });
    patientUserId = patUser.id;

    const p = await prisma.patient.create({ data: { userId: patUser.id } });
    patientId = p.id;

    // Helper to create slot and appointment
    const createTestAppt = async (
      dateStr: string,
      startTimeStr: string,
      endTimeStr: string,
      status: 'PENDING' | 'CONFIRMED' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW',
      isOffline: boolean,
      targetDocId: string = doc1Id
    ) => {
      const slot = await prisma.slot.create({
        data: {
          doctorId: targetDocId,
          date: new Date(`${dateStr}T00:00:00Z`),
          startTime: new Date(`${dateStr}T${startTimeStr}Z`),
          endTime: new Date(`${dateStr}T${endTimeStr}Z`),
          status: status === 'COMPLETED' ? 'UNAVAILABLE' : 'BOOKED',
        },
      });
      slotIds.push(slot.id);

      const appt = await prisma.appointment.create({
        data: {
          doctorId: targetDocId,
          patientId,
          slotId: slot.id,
          status,
          paymentMethod: isOffline ? 'OFFLINE' : 'ONLINE',
          isAppointmentOffline: isOffline,
        },
      });
      apptIds.push(appt.id);
      return appt;
    };

    // Appointment A: COMPLETED (Online) on 2026-08-01
    await createTestAppt('2026-08-01', '09:00:00', '09:30:00', 'COMPLETED', false);

    // Appointment B: COMPLETED (Offline) on 2026-08-05
    await createTestAppt('2026-08-05', '10:00:00', '10:30:00', 'COMPLETED', true);

    // Appointment C: CANCELLED on 2026-08-10
    await createTestAppt('2026-08-10', '11:00:00', '11:30:00', 'CANCELLED', false);

    // Appointment D: NO_SHOW on 2026-08-12
    await createTestAppt('2026-08-12', '14:00:00', '14:30:00', 'NO_SHOW', false);

    // Appointment E: CONFIRMED (Future) on 2026-08-20
    await createTestAppt('2026-08-20', '15:00:00', '15:30:00', 'CONFIRMED', false);

    // Appointment for Doctor 2 (Doctor 2 completed appointment)
    await createTestAppt('2026-08-01', '09:00:00', '09:30:00', 'COMPLETED', false, doc2Id);
  });

  afterAll(async () => {
    try {
      await prisma.appointment.deleteMany({ where: { id: { in: apptIds } } });
      await prisma.slot.deleteMany({ where: { id: { in: slotIds } } });
      await prisma.patient.deleteMany({ where: { id: patientId } });
      await prisma.doctor.deleteMany({ where: { id: { in: [doc1Id, doc2Id] } } });
      await prisma.user.deleteMany({ where: { id: { in: [doc1UserId, doc2UserId, patientUserId] } } });
    } catch (e) {
      console.warn('Phase 38 cleanup warning:', e);
    }
  });

  it('38.1 GET earnings returns 404 for non-existent doctorId', async () => {
    const req = new NextRequest('http://localhost:3000/api/doctors/non_existent_doc/earnings');
    const res = await earningsGET(req, { params: Promise.resolve({ doctorId: 'non_existent_doc' }) });
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toBe('Doctor not found');
  });

  it('38.2 Calculates total earnings strictly from COMPLETED appointments (excluding CANCELLED, NO_SHOW, CONFIRMED)', async () => {
    const req = new NextRequest(`http://localhost:3000/api/doctors/${doc1Id}/earnings`);
    const res = await earningsGET(req, { params: Promise.resolve({ doctorId: doc1Id }) });
    expect(res.status).toBe(200);
    const data = await res.json();

    // 2 completed appointments * 800 fee = 1600 INR
    expect(data.count).toBe(2);
    expect(data.total).toBe(1600);
    expect(data.earnings.length).toBe(2);
    expect(data.earnings[0].earned).toBe(800);
    expect(data.earnings[1].earned).toBe(800);
  });

  it('38.3 Filters earnings accurately using startDate and endDate query parameters', async () => {
    // Filter only 2026-08-01
    const req = new NextRequest(
      `http://localhost:3000/api/doctors/${doc1Id}/earnings?startDate=2026-08-01&endDate=2026-08-02`
    );
    const res = await earningsGET(req, { params: Promise.resolve({ doctorId: doc1Id }) });
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.count).toBe(1);
    expect(data.total).toBe(800);
    expect(data.earnings.length).toBe(1);
  });

  it('38.4 GET balance returns raw balance in paise and calculated balanceInRupees', async () => {
    const req = new NextRequest(`http://localhost:3000/api/doctors/${doc1Id}/balance`);
    const res = await balanceGET(req, { params: Promise.resolve({ doctorId: doc1Id }) });
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.balance).toBe(160000); // In paise
    expect(data.balanceInRupees).toBe(1600); // In INR
    expect(data.fees).toBe(800);
  });

  it('38.5 GET balance returns 0 gracefully for non-existent doctor', async () => {
    const req = new NextRequest('http://localhost:3000/api/doctors/non_existent_doc/balance');
    const res = await balanceGET(req, { params: Promise.resolve({ doctorId: 'non_existent_doc' }) });
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.balance).toBe(0);
    expect(data.balanceInRupees).toBe(0);
    expect(data.fees).toBe(0);
  });

  it('38.6 Isolation: Doctor 1 earnings query does not leak Doctor 2 appointments', async () => {
    const req1 = new NextRequest(`http://localhost:3000/api/doctors/${doc1Id}/earnings`);
    const res1 = await earningsGET(req1, { params: Promise.resolve({ doctorId: doc1Id }) });
    const data1 = await res1.json();

    const req2 = new NextRequest(`http://localhost:3000/api/doctors/${doc2Id}/earnings`);
    const res2 = await earningsGET(req2, { params: Promise.resolve({ doctorId: doc2Id }) });
    const data2 = await res2.json();

    expect(data1.total).toBe(1600);
    expect(data2.total).toBe(500);
    expect(data2.count).toBe(1);
  });
});
