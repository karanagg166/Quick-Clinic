import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/prisma';
import { buildUserPayload } from '@/__tests__/helpers/factories';

describe('Phase 49: Admin Appointment Management & Multi-Criteria Filtering Test Suite', () => {
  let adminUserId: string;
  let doc1UserId: string;
  let doc1Id: string;
  let doc2UserId: string;
  let doc2Id: string;
  let patientUserId: string;
  let patientId: string;

  const slotIds: string[] = [];
  const apptIds: string[] = [];

  beforeAll(async () => {
    // 1. Admin
    const adminPayload = buildUserPayload({
      name: 'Admin Appt Inspector',
      email: `admin_appt_${Date.now()}@quickclinic.test`,
      role: 'ADMIN',
    });
    const adminUser = await prisma.user.create({
      data: {
        name: adminPayload.name,
        email: adminPayload.email,
        phoneNo: adminPayload.phoneNo,
        password: adminPayload.password,
        age: 45,
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

    // 2. Doctor 1 (Cardiologist)
    const doc1Payload = buildUserPayload({
      name: 'Dr. Appt Cardio',
      email: `doc_appt1_${Date.now()}@quickclinic.test`,
      role: 'DOCTOR',
    });
    const doc1User = await prisma.user.create({
      data: {
        name: doc1Payload.name,
        email: doc1Payload.email,
        phoneNo: doc1Payload.phoneNo,
        password: doc1Payload.password,
        age: 48,
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
        userId: doc1UserId,
        specialty: 'CARDIOLOGIST',
        fees: 800,
        experience: 16,
      },
    });
    doc1Id = d1.id;

    // 3. Doctor 2 (Neurologist)
    const doc2Payload = buildUserPayload({
      name: 'Dr. Appt Neuro',
      email: `doc_appt2_${Date.now()}@quickclinic.test`,
      role: 'DOCTOR',
    });
    const doc2User = await prisma.user.create({
      data: {
        name: doc2Payload.name,
        email: doc2Payload.email,
        phoneNo: doc2Payload.phoneNo,
        password: doc2Payload.password,
        age: 42,
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
        userId: doc2UserId,
        specialty: 'NEUROLOGIST',
        fees: 1500,
        experience: 14,
      },
    });
    doc2Id = d2.id;

    // 4. Patient
    const patPayload = buildUserPayload({
      name: 'Patient Cross-Inspector',
      email: `pat_cross_${Date.now()}@quickclinic.test`,
      role: 'PATIENT',
    });
    const patUser = await prisma.user.create({
      data: {
        name: patPayload.name,
        email: patPayload.email,
        phoneNo: patPayload.phoneNo,
        password: patPayload.password,
        age: 29,
        address: patPayload.address,
        role: 'PATIENT',
        gender: 'FEMALE',
        location: {
          connectOrCreate: {
            where: { pincode: 121004 },
            create: { pincode: 121004, city: 'Faridabad', state: 'Haryana' },
          },
        },
      },
    });
    patientUserId = patUser.id;

    const p = await prisma.patient.create({ data: { userId: patientUserId } });
    patientId = p.id;

    // Create 3 diverse appointments
    const createAppointment = async (
      targetDocId: string,
      dateStr: string,
      status: 'CONFIRMED' | 'COMPLETED' | 'CANCELLED',
      paymentMethod: 'ONLINE' | 'OFFLINE'
    ) => {
      const slot = await prisma.slot.create({
        data: {
          doctorId: targetDocId,
          date: new Date(`${dateStr}T00:00:00Z`),
          startTime: new Date(`${dateStr}T10:00:00Z`),
          endTime: new Date(`${dateStr}T10:30:00Z`),
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
          paymentMethod,
          isAppointmentOffline: paymentMethod === 'OFFLINE',
        },
      });
      apptIds.push(appt.id);
      return appt;
    };

    // Appt 1: Doctor 1, CONFIRMED, ONLINE on 2026-09-10
    await createAppointment(doc1Id, '2026-09-10', 'CONFIRMED', 'ONLINE');

    // Appt 2: Doctor 1, COMPLETED, OFFLINE on 2026-09-11
    await createAppointment(doc1Id, '2026-09-11', 'COMPLETED', 'OFFLINE');

    // Appt 3: Doctor 2, CANCELLED, ONLINE on 2026-09-12
    await createAppointment(doc2Id, '2026-09-12', 'CANCELLED', 'ONLINE');
  });

  afterAll(async () => {
    try {
      await prisma.appointment.deleteMany({ where: { id: { in: apptIds } } });
      await prisma.slot.deleteMany({ where: { id: { in: slotIds } } });
      await prisma.patient.deleteMany({ where: { id: patientId } });
      await prisma.doctor.deleteMany({ where: { id: { in: [doc1Id, doc2Id] } } });
      await prisma.admin.deleteMany({ where: { userId: adminUserId } });
      await prisma.user.deleteMany({
        where: { id: { in: [adminUserId, doc1UserId, doc2UserId, patientUserId] } },
      });
    } catch (e) {
      console.warn('Phase 49 cleanup warning:', e);
    }
  });

  it('49.1 Admin queries global appointments across all doctors with pagination and relations', async () => {
    const appointments = await prisma.appointment.findMany({
      where: { id: { in: apptIds } },
      include: {
        doctor: { include: { user: { select: { name: true } } } },
        patient: { include: { user: { select: { name: true } } } },
        slot: true,
      },
      orderBy: { bookedAt: 'desc' },
    });

    expect(appointments.length).toBe(3);
    expect(appointments[0].doctor.user.name).toBeDefined();
    expect(appointments[0].patient.user.name).toBeDefined();
  });

  it('49.2 Filters appointments by doctorId and status', async () => {
    const doc1Confirmed = await prisma.appointment.findMany({
      where: { doctorId: doc1Id, status: 'CONFIRMED', id: { in: apptIds } },
    });
    expect(doc1Confirmed.length).toBe(1);
    expect(doc1Confirmed[0].status).toBe('CONFIRMED');
    expect(doc1Confirmed[0].paymentMethod).toBe('ONLINE');
  });

  it('49.3 Filters appointments by paymentMethod (ONLINE vs OFFLINE)', async () => {
    const offlineAppts = await prisma.appointment.findMany({
      where: { paymentMethod: 'OFFLINE', id: { in: apptIds } },
    });
    expect(offlineAppts.length).toBe(1);
    expect(offlineAppts[0].status).toBe('COMPLETED');
    expect(offlineAppts[0].isAppointmentOffline).toBe(true);
  });

  it('49.4 Filters appointments by date range', async () => {
    const targetDateStart = new Date('2026-09-12T00:00:00Z');
    const targetDateEnd = new Date('2026-09-13T00:00:00Z');

    const apptsOnDate = await prisma.appointment.findMany({
      where: {
        id: { in: apptIds },
        slot: {
          date: {
            gte: targetDateStart,
            lt: targetDateEnd,
          },
        },
      },
      include: { slot: true },
    });

    expect(apptsOnDate.length).toBe(1);
    expect(apptsOnDate[0].doctorId).toBe(doc2Id);
    expect(apptsOnDate[0].status).toBe('CANCELLED');
  });
});
