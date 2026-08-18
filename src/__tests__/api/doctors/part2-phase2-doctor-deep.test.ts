import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { createToken } from '@/lib/auth';
import { POST as doctorsPOST, GET as doctorsGET } from '@/app/api/doctors/route';
import { GET as doctorDetailGET, PUT as doctorDetailPUT, PATCH as doctorDetailPATCH } from '@/app/api/doctors/[doctorId]/route';
import { POST as schedulePOST, GET as scheduleGET } from '@/app/api/doctors/[doctorId]/schedule/route';
import { POST as leavePOST, GET as leaveGET, DELETE as leaveDELETE } from '@/app/api/doctors/[doctorId]/leave/route';
import { GET as earningsGET } from '@/app/api/doctors/[doctorId]/earnings/route';
import { GET as balanceGET } from '@/app/api/doctors/[doctorId]/balance/route';
import { POST as withdrawalPOST, GET as withdrawalGET } from '@/app/api/doctors/[doctorId]/withdrawals/route';
import { PATCH as doctorAppointmentPATCH, GET as doctorAppointmentGET } from '@/app/api/doctors/[doctorId]/appointments/[appointmentId]/route';
import { seedPart2Dataset, cleanupPart2Dataset, Part2Dataset, PART2_PASSWORD } from '@/__tests__/helpers/part2-dataset';

describe('Phase 2 — Doctor Feature Deep Testing Suite', () => {
  let dataset: Part2Dataset;
  let doc1: any;
  let doc1Token: string;
  let doc2: any;
  let doc2Token: string;
  let patient1: any;
  let patient1Token: string;
  let superAdminToken: string;

  beforeAll(async () => {
    dataset = await seedPart2Dataset();
    doc1 = dataset.doctors[0]; // Cardiologist
    doc2 = dataset.doctors[1]; // Dermatologist
    patient1 = dataset.patients[0];

    doc1Token = await createToken({ id: doc1.id, userId: doc1.id, role: 'DOCTOR', email: doc1.email, name: doc1.name });
    doc2Token = await createToken({ id: doc2.id, userId: doc2.id, role: 'DOCTOR', email: doc2.email, name: doc2.name });
    patient1Token = await createToken({ id: patient1.id, userId: patient1.id, role: 'PATIENT', email: patient1.email, name: patient1.name });
    superAdminToken = await createToken({ id: dataset.superAdmin.id, userId: dataset.superAdmin.id, role: 'ADMIN', email: dataset.superAdmin.email, name: dataset.superAdmin.name });
  });

  afterAll(async () => {
    if (dataset) {
      await cleanupPart2Dataset(dataset);
    }
  });

  // --------------------------------------------------------------------------
  // 2.1 Doctor Onboarding & Profile Creation
  // --------------------------------------------------------------------------
  describe('2.1 Doctor Onboarding & Profile Creation', () => {
    it('2.1.1 Rejects unauthenticated doctor profile creation with 401', async () => {
      const req = new NextRequest('http://localhost:3000/api/doctors', {
        method: 'POST',
        body: JSON.stringify({
          userId: doc1.id,
          specialty: 'CARDIOLOGIST',
          fees: 500,
        }),
      });
      const res = await doctorsPOST(req);
      expect(res.status).toBe(401);
    });

    it('2.1.2 Rejects IDOR: User A cannot create doctor profile for User B (403)', async () => {
      const req = new NextRequest('http://localhost:3000/api/doctors', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${patient1Token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          userId: doc2.id,
          specialty: 'DERMATOLOGIST',
          fees: 800,
        }),
      });
      const res = await doctorsPOST(req);
      expect(res.status).toBe(403);
    });

    it('2.1.3 Rejects duplicate doctor profile creation with 409 Conflict', async () => {
      const req = new NextRequest('http://localhost:3000/api/doctors', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${doc1Token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          userId: doc1.id,
          specialty: 'CARDIOLOGIST',
          fees: 500,
        }),
      });
      const res = await doctorsPOST(req);
      expect(res.status).toBe(409);
    });

    it('2.1.4 Rejects invalid coordinates during doctor onboarding with 400', async () => {
      const newUser = await prisma.user.create({
        data: {
          name: 'Temp Doctor Coord Test',
          email: `temp_doc_coord_${Date.now()}@quickclinic.test`,
          phoneNo: '9899999901',
          password: 'Password123!',
          role: 'DOCTOR',
          age: 35,
          gender: 'MALE',
          address: 'Coord Test Clinic',
          pinCode: 110001,
        },
      });

      const tempToken = await createToken({ id: newUser.id, role: 'DOCTOR' });

      const req = new NextRequest('http://localhost:3000/api/doctors', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${tempToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          userId: newUser.id,
          specialty: 'GENERAL_PHYSICIAN',
          fees: 400,
          latitude: 999, // Invalid latitude
          longitude: 77.2,
        }),
      });
      const res = await doctorsPOST(req);
      expect(res.status).toBe(400);

      await prisma.user.delete({ where: { id: newUser.id } });
    });
  });

  // --------------------------------------------------------------------------
  // 2.2 Doctor Profile & IDOR Protection
  // --------------------------------------------------------------------------
  describe('2.2 Doctor Profile & IDOR Protection', () => {
    it('2.2.1 Doctor views own profile including qualifications and coordinates', async () => {
      const req = new NextRequest(`http://localhost:3000/api/doctors/${doc1.doctorId}`, {
        headers: { authorization: `Bearer ${doc1Token}` },
      });
      const res = await doctorDetailGET(req, { params: Promise.resolve({ doctorId: doc1.doctorId }) });
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.doctor.id).toBe(doc1.doctorId);
      expect(data.doctor.specialty).toBe('CARDIOLOGIST');
      expect(data.doctor.qualifications).toContain('MBBS');
      expect(data.doctor.qualifications).toContain('DM');
      expect(data.rating).toBeDefined();
    });

    it('2.2.2 Doctor updates bio, fees, experience, and qualifications via PUT/PATCH', async () => {
      const req = new NextRequest(`http://localhost:3000/api/doctors/${doc1.doctorId}`, {
        method: 'PATCH',
        headers: {
          authorization: `Bearer ${doc1Token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          fees: 750,
          experience: 12,
          doctorBio: 'Updated senior interventional cardiology specialist bio.',
          qualifications: ['MBBS', 'MD', 'DM', 'FELLOWSHIP'],
        }),
      });

      const res = await doctorDetailPATCH(req, { params: Promise.resolve({ doctorId: doc1.doctorId }) });
      expect(res.status).toBe(200);

      const updatedInDb = await prisma.doctor.findUnique({
        where: { id: doc1.doctorId },
        include: { doctorQualifications: true },
      });
      expect(updatedInDb?.fees).toBe(750);
      expect(updatedInDb?.experience).toBe(12);
      expect(updatedInDb?.doctorBio).toContain('Updated senior interventional');
      const quals = updatedInDb?.doctorQualifications.map((q) => q.qualification);
      expect(quals).toContain('FELLOWSHIP');
    });

    it('2.2.3 IDOR Protection: Doctor A cannot modify Doctor B profile (403 Forbidden)', async () => {
      const req = new NextRequest(`http://localhost:3000/api/doctors/${doc2.doctorId}`, {
        method: 'PATCH',
        headers: {
          authorization: `Bearer ${doc1Token}`, // Doc1 token targeting Doc2
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          fees: 100, // Attempting to tamper Doctor 2 fees
        }),
      });

      const res = await doctorDetailPATCH(req, { params: Promise.resolve({ doctorId: doc2.doctorId }) });
      expect(res.status).toBe(403);

      const doc2InDb = await prisma.doctor.findUnique({ where: { id: doc2.doctorId } });
      expect(doc2InDb?.fees).toBe(doc2.fees); // Preserved
    });

    it('2.2.4 Patient cannot modify doctor profile (403 Forbidden)', async () => {
      const req = new NextRequest(`http://localhost:3000/api/doctors/${doc1.doctorId}`, {
        method: 'PUT',
        headers: {
          authorization: `Bearer ${patient1Token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          fees: 1,
          specialty: 'DENTIST',
        }),
      });

      const res = await doctorDetailPUT(req, { params: Promise.resolve({ doctorId: doc1.doctorId }) });
      expect(res.status).toBe(403);
    });
  });

  // --------------------------------------------------------------------------
  // 2.3 Doctor Schedule — Deep Testing
  // --------------------------------------------------------------------------
  describe('2.3 Doctor Schedule — Deep Testing', () => {
    it('2.3.1 Doctor creates weekly schedule with split shifts and lunch break', async () => {
      const weeklySchedule = [
        {
          day: 'Monday',
          slots: [
            { slotNo: 1, start: '09:00', end: '13:00' },
            { slotNo: 2, start: '14:00', end: '17:00' },
          ],
        },
        {
          day: 'Tuesday',
          slots: [{ slotNo: 1, start: '10:00', end: '15:00' }],
        },
        { day: 'Wednesday', slots: [] }, // OFF day
        {
          day: 'Saturday',
          slots: [{ slotNo: 1, start: '09:00', end: '12:00' }],
        },
      ];

      const req = new NextRequest(`http://localhost:3000/api/doctors/${doc1.doctorId}/schedule`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${doc1Token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ weeklySchedule }),
      });

      const res = await schedulePOST(req, { params: Promise.resolve({ doctorId: doc1.doctorId }) });
      expect(res.status).toBe(201);

      const getReq = new NextRequest(`http://localhost:3000/api/doctors/${doc1.doctorId}/schedule`);
      const getRes = await scheduleGET(getReq, { params: Promise.resolve({ doctorId: doc1.doctorId }) });
      expect(getRes.status).toBe(200);
      const data = await getRes.json();
      expect(data.weeklySchedule).toEqual(weeklySchedule);
    });

    it('2.3.2 Rejects overlapping slots within same day with 400 Bad Request', async () => {
      const invalidSchedule = [
        {
          day: 'Monday',
          slots: [
            { slotNo: 1, start: '09:00', end: '13:00' },
            { slotNo: 2, start: '12:00', end: '15:00' }, // Overlaps with 09:00-13:00
          ],
        },
      ];

      const req = new NextRequest(`http://localhost:3000/api/doctors/${doc1.doctorId}/schedule`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${doc1Token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ weeklySchedule: invalidSchedule }),
      });

      const res = await schedulePOST(req, { params: Promise.resolve({ doctorId: doc1.doctorId }) });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toMatch(/overlapping/i);
    });

    it('2.3.3 Rejects start time >= end time with 400 Bad Request', async () => {
      const invalidSchedule = [
        {
          day: 'Monday',
          slots: [{ slotNo: 1, start: '17:00', end: '09:00' }],
        },
      ];

      const req = new NextRequest(`http://localhost:3000/api/doctors/${doc1.doctorId}/schedule`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${doc1Token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ weeklySchedule: invalidSchedule }),
      });

      const res = await schedulePOST(req, { params: Promise.resolve({ doctorId: doc1.doctorId }) });
      expect(res.status).toBe(400);
    });

    it('2.3.4 IDOR: Doctor A cannot modify Doctor B schedule (403 Forbidden)', async () => {
      const req = new NextRequest(`http://localhost:3000/api/doctors/${doc2.doctorId}/schedule`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${doc1Token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ weeklySchedule: [] }),
      });

      const res = await schedulePOST(req, { params: Promise.resolve({ doctorId: doc2.doctorId }) });
      expect(res.status).toBe(403);
    });
  });

  // --------------------------------------------------------------------------
  // 2.4 Doctor Leave — Deep Functional & HLD Testing
  // --------------------------------------------------------------------------
  describe('2.4 Doctor Leave — Deep Functional & HLD Testing', () => {
    let bookedSlot1Id: string;
    let bookedAppt1Id: string;
    let bookedSlot2Id: string;
    let bookedAppt2Id: string;
    let leaveStart: Date;
    let leaveEnd: Date;

    beforeAll(async () => {
      leaveStart = new Date();
      leaveStart.setDate(leaveStart.getDate() + 20);
      leaveStart.setHours(9, 0, 0, 0);

      leaveEnd = new Date(leaveStart);
      leaveEnd.setDate(leaveEnd.getDate() + 2);
      leaveEnd.setHours(18, 0, 0, 0);

      // Create 2 test slots and booked appointments inside this future leave window
      const slot1Date = new Date(leaveStart);
      const slot1End = new Date(slot1Date);
      slot1End.setMinutes(slot1End.getMinutes() + 30);

      const slot1 = await prisma.slot.create({
        data: {
          doctorId: doc1.doctorId,
          date: slot1Date,
          startTime: slot1Date,
          endTime: slot1End,
          status: 'BOOKED',
        },
      });
      bookedSlot1Id = slot1.id;

      const appt1 = await prisma.appointment.create({
        data: {
          doctorId: doc1.doctorId,
          patientId: patient1.patientId,
          slotId: slot1.id,
          status: 'CONFIRMED',
          paymentMethod: 'ONLINE',
          isAppointmentOffline: false,
        },
      });
      bookedAppt1Id = appt1.id;

      const slot2Date = new Date(leaveStart);
      slot2Date.setDate(slot2Date.getDate() + 1);
      const slot2End = new Date(slot2Date);
      slot2End.setMinutes(slot2End.getMinutes() + 30);

      const slot2 = await prisma.slot.create({
        data: {
          doctorId: doc1.doctorId,
          date: slot2Date,
          startTime: slot2Date,
          endTime: slot2End,
          status: 'BOOKED',
        },
      });
      bookedSlot2Id = slot2.id;

      const appt2 = await prisma.appointment.create({
        data: {
          doctorId: doc1.doctorId,
          patientId: patient1.patientId,
          slotId: slot2.id,
          status: 'PENDING',
          paymentMethod: 'OFFLINE',
          isAppointmentOffline: true,
        },
      });
      bookedAppt2Id = appt2.id;
    });

    it('2.4.1 Rejects leave where end date < start date with 400', async () => {
      const req = new NextRequest(`http://localhost:3000/api/doctors/${doc1.doctorId}/leave`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${doc1Token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          startDate: '2026-10-15',
          endDate: '2026-10-10',
          reason: 'Invalid inverted dates',
        }),
      });

      const res = await leavePOST(req, { params: Promise.resolve({ doctorId: doc1.doctorId }) });
      expect(res.status).toBe(400);
    });

    it('2.4.2 Creates leave, auto-cancels overlapping appointments, marks slots ON_LEAVE, and creates patient notifications', async () => {
      const req = new NextRequest(`http://localhost:3000/api/doctors/${doc1.doctorId}/leave`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${doc1Token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          startDate: leaveStart.toISOString(),
          endDate: leaveEnd.toISOString(),
          reason: 'Emergency Medical Training',
        }),
      });

      const res = await leavePOST(req, { params: Promise.resolve({ doctorId: doc1.doctorId }) });
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.cancelledAppointments).toBeGreaterThanOrEqual(2);

      // Verify appointments were transitioned to CANCELLED
      const updatedAppt1 = await prisma.appointment.findUnique({ where: { id: bookedAppt1Id } });
      const updatedAppt2 = await prisma.appointment.findUnique({ where: { id: bookedAppt2Id } });
      expect(updatedAppt1?.status).toBe('CANCELLED');
      expect(updatedAppt2?.status).toBe('CANCELLED');

      // Verify slots became ON_LEAVE
      const updatedSlot1 = await prisma.slot.findUnique({ where: { id: bookedSlot1Id } });
      const updatedSlot2 = await prisma.slot.findUnique({ where: { id: bookedSlot2Id } });
      expect(updatedSlot1?.status).toBe('ON_LEAVE');
      expect(updatedSlot2?.status).toBe('ON_LEAVE');

      // Verify durable patient notification created
      const notifs = await prisma.notification.findMany({
        where: { userId: patient1.id },
        orderBy: { createdAt: 'desc' },
      });
      expect(notifs.length).toBeGreaterThan(0);
      expect(notifs[0].message).toContain('cancelled');
    });

    it('2.4.3 Rejects conflicting overlapping leave with 409 Conflict', async () => {
      const req = new NextRequest(`http://localhost:3000/api/doctors/${doc1.doctorId}/leave`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${doc1Token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          startDate: leaveStart.toISOString(),
          endDate: leaveEnd.toISOString(),
          reason: 'Duplicate overlapping leave',
        }),
      });

      const res = await leavePOST(req, { params: Promise.resolve({ doctorId: doc1.doctorId }) });
      expect(res.status).toBe(409);
    });

    it('2.4.4 Cancels leave and restores unbooked slots without reviving cancelled appointments', async () => {
      const leaves = await prisma.leave.findMany({ where: { doctorId: doc1.doctorId } });
      expect(leaves.length).toBeGreaterThan(0);
      const targetLeave = leaves[0];

      const deleteReq = new NextRequest(`http://localhost:3000/api/doctors/${doc1.doctorId}/leave?leaveId=${targetLeave.id}`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${doc1Token}` },
      });

      const deleteRes = await leaveDELETE(deleteReq, { params: Promise.resolve({ doctorId: doc1.doctorId }) });
      expect(deleteRes.status).toBe(200);

      // Verify leave was deleted
      const leaveInDb = await prisma.leave.findUnique({ where: { id: targetLeave.id } });
      expect(leaveInDb).toBeNull();

      // Verify cancelled appointments NEVER revive
      const appt1 = await prisma.appointment.findUnique({ where: { id: bookedAppt1Id } });
      expect(appt1?.status).toBe('CANCELLED');
    });
  });

  // --------------------------------------------------------------------------
  // 2.5 Doctor Appointments & State Machine
  // --------------------------------------------------------------------------
  describe('2.5 Doctor Appointments & State Machine', () => {
    let testSlot: any;
    let testAppt: any;

    beforeAll(async () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 15);
      const slotEnd = new Date(futureDate);
      slotEnd.setMinutes(slotEnd.getMinutes() + 30);

      testSlot = await prisma.slot.create({
        data: {
          doctorId: doc1.doctorId,
          date: futureDate,
          startTime: futureDate,
          endTime: slotEnd,
          status: 'BOOKED',
        },
      });

      testAppt = await prisma.appointment.create({
        data: {
          doctorId: doc1.doctorId,
          patientId: patient1.patientId,
          slotId: testSlot.id,
          status: 'PENDING',
          paymentMethod: 'OFFLINE',
          isAppointmentOffline: true,
        },
      });
    });

    it('2.5.1 Doctor confirms pending offline appointment (PENDING -> CONFIRMED)', async () => {
      const req = new NextRequest(`http://localhost:3000/api/doctors/${doc1.doctorId}/appointments/${testAppt.id}`, {
        method: 'PATCH',
        headers: {
          authorization: `Bearer ${doc1Token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ status: 'CONFIRMED' }),
      });

      const res = await doctorAppointmentPATCH(req, { params: Promise.resolve({ doctorId: doc1.doctorId, appointmentId: testAppt.id }) });
      expect(res.status).toBe(200);

      const inDb = await prisma.appointment.findUnique({ where: { id: testAppt.id } });
      expect(inDb?.status).toBe('CONFIRMED');
    });

    it('2.5.2 IDOR Isolation: Doctor B cannot mutate Doctor A appointment (403 Forbidden)', async () => {
      const req = new NextRequest(`http://localhost:3000/api/doctors/${doc1.doctorId}/appointments/${testAppt.id}`, {
        method: 'PATCH',
        headers: {
          authorization: `Bearer ${doc2Token}`, // Doc2 trying to alter Doc1 appt
          'content-type': 'application/json',
        },
        body: JSON.stringify({ status: 'CANCELLED' }),
      });

      const res = await doctorAppointmentPATCH(req, { params: Promise.resolve({ doctorId: doc1.doctorId, appointmentId: testAppt.id }) });
      expect(res.status).toBe(403);
    });
  });

  // --------------------------------------------------------------------------
  // 2.6 Doctor Earnings Deep Testing & Financial Invariant
  // --------------------------------------------------------------------------
  describe('2.6 Doctor Earnings Deep Testing & Invariants', () => {
    let onlineSlot: any;
    let onlineAppt: any;
    const doctorFeeRupees = 500;
    const expectedCreditPaise = 50000;

    beforeAll(async () => {
      // Set known initial balance
      await prisma.doctor.update({
        where: { id: doc1.doctorId },
        data: { balance: 0, fees: doctorFeeRupees },
      });

      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 10);
      const slotEnd = new Date(futureDate);
      slotEnd.setMinutes(slotEnd.getMinutes() + 30);

      onlineSlot = await prisma.slot.create({
        data: {
          doctorId: doc1.doctorId,
          date: futureDate,
          startTime: futureDate,
          endTime: slotEnd,
          status: 'BOOKED',
        },
      });

      onlineAppt = await prisma.appointment.create({
        data: {
          doctorId: doc1.doctorId,
          patientId: patient1.patientId,
          slotId: onlineSlot.id,
          status: 'CONFIRMED',
          paymentMethod: 'ONLINE',
          transactionId: 'pay_test_online_123',
          isAppointmentOffline: false,
        },
      });
    });

    it('2.6.1 Balance remains 0 before appointment completion (not credited at hold/pending)', async () => {
      const inDb = await prisma.doctor.findUnique({ where: { id: doc1.doctorId } });
      expect(inDb?.balance).toBe(0);
    });

    it('2.6.2 Completing online appointment credits exactly fees * 100 in paise (₹500 -> 50000 paise)', async () => {
      const req = new NextRequest(`http://localhost:3000/api/doctors/${doc1.doctorId}/appointments/${onlineAppt.id}`, {
        method: 'PATCH',
        headers: {
          authorization: `Bearer ${doc1Token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ status: 'COMPLETED' }),
      });

      const res = await doctorAppointmentPATCH(req, { params: Promise.resolve({ doctorId: doc1.doctorId, appointmentId: onlineAppt.id }) });
      expect(res.status).toBe(200);

      const inDb = await prisma.doctor.findUnique({ where: { id: doc1.doctorId } });
      expect(inDb?.balance).toBe(expectedCreditPaise);
    });

    it('2.6.3 Idempotency: Duplicate completion call does NOT double-credit balance', async () => {
      const req = new NextRequest(`http://localhost:3000/api/doctors/${doc1.doctorId}/appointments/${onlineAppt.id}`, {
        method: 'PATCH',
        headers: {
          authorization: `Bearer ${doc1Token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ status: 'COMPLETED' }),
      });

      const res = await doctorAppointmentPATCH(req, { params: Promise.resolve({ doctorId: doc1.doctorId, appointmentId: onlineAppt.id }) });
      const inDb = await prisma.doctor.findUnique({ where: { id: doc1.doctorId } });
      expect(inDb?.balance).toBe(expectedCreditPaise); // Unchanged
    });

    it('2.6.4 Concurrent duplicate completion requests credit balance exactly ONCE', async () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 11);
      const slotEnd = new Date(futureDate);
      slotEnd.setMinutes(slotEnd.getMinutes() + 30);

      const raceSlot = await prisma.slot.create({
        data: {
          doctorId: doc1.doctorId,
          date: futureDate,
          startTime: futureDate,
          endTime: slotEnd,
          status: 'BOOKED',
        },
      });

      const raceAppt = await prisma.appointment.create({
        data: {
          doctorId: doc1.doctorId,
          patientId: patient1.patientId,
          slotId: raceSlot.id,
          status: 'CONFIRMED',
          paymentMethod: 'ONLINE',
          transactionId: 'pay_test_race_123',
          isAppointmentOffline: false,
        },
      });

      const initialBalance = (await prisma.doctor.findUnique({ where: { id: doc1.doctorId } }))?.balance || 0;

      // Send 5 parallel completion requests
      const promises = Array.from({ length: 5 }).map(() => {
        const req = new NextRequest(`http://localhost:3000/api/doctors/${doc1.doctorId}/appointments/${raceAppt.id}`, {
          method: 'PATCH',
          headers: {
            authorization: `Bearer ${doc1Token}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ status: 'COMPLETED' }),
        });
        return doctorAppointmentPATCH(req, { params: Promise.resolve({ doctorId: doc1.doctorId, appointmentId: raceAppt.id }) });
      });

      await Promise.all(promises);

      const finalBalance = (await prisma.doctor.findUnique({ where: { id: doc1.doctorId } }))?.balance;
      expect(finalBalance).toBe(initialBalance + expectedCreditPaise);
    });
  });

  // --------------------------------------------------------------------------
  // 2.7 Doctor Earnings Page / UI API & IDOR Isolation
  // --------------------------------------------------------------------------
  describe('2.7 Doctor Earnings Page & IDOR Isolation', () => {
    it('2.7.1 Doctor views own earnings summary and breakdown', async () => {
      const req = new NextRequest(`http://localhost:3000/api/doctors/${doc1.doctorId}/earnings`, {
        headers: { authorization: `Bearer ${doc1Token}` },
      });

      const res = await earningsGET(req, { params: Promise.resolve({ doctorId: doc1.doctorId }) });
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.total).toBeGreaterThanOrEqual(500);
      expect(data.count).toBeGreaterThanOrEqual(1);
      expect(Array.isArray(data.earnings)).toBe(true);
    });

    it('2.7.2 IDOR: Doctor A cannot view Doctor B earnings (403 Forbidden)', async () => {
      const req = new NextRequest(`http://localhost:3000/api/doctors/${doc2.doctorId}/earnings`, {
        headers: { authorization: `Bearer ${doc1Token}` }, // Doctor 1 querying Doctor 2
      });

      const res = await earningsGET(req, { params: Promise.resolve({ doctorId: doc2.doctorId }) });
      expect(res.status).toBe(403);
    });

    it('2.7.3 Balance endpoint returns correct paise and rupee breakdown with authorization', async () => {
      const req = new NextRequest(`http://localhost:3000/api/doctors/${doc1.doctorId}/balance`, {
        headers: { authorization: `Bearer ${doc1Token}` },
      });

      const res = await balanceGET(req, { params: Promise.resolve({ doctorId: doc1.doctorId }) });
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.balance).toBeGreaterThanOrEqual(50000);
      expect(data.balanceInRupees).toBe(data.balance / 100);
    });
  });

  // --------------------------------------------------------------------------
  // 2.8 Withdrawals Lifecycle, Validation & Bank Masking
  // --------------------------------------------------------------------------
  describe('2.8 Withdrawals Lifecycle, Validation & Bank Masking', () => {
    beforeAll(async () => {
      // Set doc1 balance to ₹10,000 = 1,000,000 paise
      await prisma.doctor.update({
        where: { id: doc1.doctorId },
        data: { balance: 1000000 },
      });
    });

    it('2.8.1 Rejects withdrawal exceeding doctor balance with 400 Insufficient balance', async () => {
      const req = new NextRequest(`http://localhost:3000/api/doctors/${doc1.doctorId}/withdrawals`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${doc1Token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          amount: 2000000, // 20,000 INR (exceeds 10,000 INR)
          currency: 'INR',
          bankAccountNumber: '98765432101234',
          bankIFSC: 'HDFC0001234',
          bankAccountHolderName: 'Dr. Amit Patel',
          bankName: 'HDFC Bank',
        }),
      });

      const res = await withdrawalPOST(req, { params: Promise.resolve({ doctorId: doc1.doctorId }) });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toMatch(/insufficient balance|minimum withdrawal/i);
    });

    it('2.8.2 Rejects negative, zero, or decimal amounts with 400', async () => {
      for (const invalidAmount of [-500, 0, 500.5]) {
        const req = new NextRequest(`http://localhost:3000/api/doctors/${doc1.doctorId}/withdrawals`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${doc1Token}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            amount: invalidAmount,
            bankAccountNumber: '98765432101234',
            bankIFSC: 'HDFC0001234',
            bankAccountHolderName: 'Dr. Amit Patel',
            bankName: 'HDFC Bank',
          }),
        });

        const res = await withdrawalPOST(req, { params: Promise.resolve({ doctorId: doc1.doctorId }) });
        expect(res.status).toBe(400);
      }
    });

    it('2.8.3 Creates PENDING withdrawal, reserves balance atomically, and masks bank account number', async () => {
      const initialBalance = (await prisma.doctor.findUnique({ where: { id: doc1.doctorId } }))?.balance || 0;
      const withdrawAmount = 500; // 500 INR

      const req = new NextRequest(`http://localhost:3000/api/doctors/${doc1.doctorId}/withdrawals`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${doc1Token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          amount: withdrawAmount,
          currency: 'INR',
          bankAccountNumber: '98765432101234',
          bankIFSC: 'HDFC0001234',
          bankAccountHolderName: 'Dr. Amit Patel',
          bankName: 'HDFC Bank',
        }),
      });

      const res = await withdrawalPOST(req, { params: Promise.resolve({ doctorId: doc1.doctorId }) });
      expect(res.status).toBe(201);

      const data = await res.json();
      expect(data.withdrawal.status).toBe('PENDING');
      expect(data.withdrawal.bankAccountNumber).toBe('********1234'); // Masked

      // Verify balance decremented in DB immediately
      const newBalance = (await prisma.doctor.findUnique({ where: { id: doc1.doctorId } }))?.balance;
      expect(newBalance).toBe(initialBalance - (withdrawAmount * 100));
    });

    it('2.8.4 Admin can view all withdrawals with masked account numbers', async () => {
      const req = new NextRequest(`http://localhost:3000/api/doctors/${doc1.doctorId}/withdrawals`, {
        headers: { authorization: `Bearer ${superAdminToken}` },
      });

      const res = await withdrawalGET(req, { params: Promise.resolve({ doctorId: doc1.doctorId }) });
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBeGreaterThan(0);
      expect(data[0].bankAccountNumber).toMatch(/\*{6,}\d{4}/);
    });
  });
});
