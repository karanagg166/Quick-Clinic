import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { createToken } from '@/lib/auth';
import { POST as leavePOST, GET as leaveGET, DELETE as leaveDELETE } from '@/app/api/doctors/[doctorId]/leave/route';
import { GET as patientsGET } from '@/app/api/patients/route';
import { seedPart2Dataset, cleanupPart2Dataset, Part2Dataset } from '@/__tests__/helpers/part2-dataset';

describe('Doctor Leave Overlap Invariant, Cancellation Safety & Patient History Suite', () => {
  let dataset: Part2Dataset;
  let doctor: any;
  let doctorToken: string;
  let patient1: any;
  let patient2: any;

  beforeAll(async () => {
    dataset = await seedPart2Dataset('p2_leave_test');
    doctor = dataset.doctors[0];
    patient1 = dataset.patients[0];
    patient2 = dataset.patients[1];

    doctorToken = await createToken({
      id: doctor.id,
      userId: doctor.id,
      role: 'DOCTOR',
      email: doctor.email,
      name: doctor.name,
    });
  }, 30000);

  afterAll(async () => {
    if (dataset) {
      await cleanupPart2Dataset(dataset);
    }
  });

  // ==========================================
  // 1. 1-MINUTE OVERLAP AUTO-CANCELLATION TEST
  // ==========================================
  it('1. Overlap by 1+ minutes cancels ONLY the overlapping appointment, non-overlapping remain CONFIRMED', async () => {
    const baseDate = new Date();
    baseDate.setDate(baseDate.getDate() + 60); // 60 days in future
    baseDate.setUTCHours(0, 0, 0, 0);

    // Setup 4 distinct time slots:
    // Slot 1: 10:00 - 10:10
    // Slot 2: 11:00 - 11:10
    // Slot 3: 12:00 - 12:10
    // Slot 4: 13:00 - 13:10
    const createSlotAndAppt = async (startH: number, startM: number, endH: number, endM: number, patientId: string, notes: string) => {
      const slotStart = new Date(baseDate);
      slotStart.setUTCHours(startH, startM, 0, 0);
      const slotEnd = new Date(baseDate);
      slotEnd.setUTCHours(endH, endM, 0, 0);

      const slot = await prisma.slot.create({
        data: {
          doctorId: doctor.doctorId,
          date: baseDate,
          startTime: slotStart,
          endTime: slotEnd,
          status: 'BOOKED',
        },
      });

      const appt = await prisma.appointment.create({
        data: {
          doctorId: doctor.doctorId,
          patientId,
          slotId: slot.id,
          status: 'CONFIRMED',
          paymentMethod: 'ONLINE',
          transactionId: `txn_overlap_${startH}_${Date.now()}`,
          isAppointmentOffline: false,
          notes,
        },
      });

      return { slot, appt };
    };

    const appt1 = await createSlotAndAppt(10, 0, 10, 10, patient1.patientId, 'Routine checkup');
    const appt2 = await createSlotAndAppt(11, 0, 11, 10, patient2.patientId, 'Follow-up cardiology');
    const appt3 = await createSlotAndAppt(12, 0, 12, 10, patient1.patientId, 'ECG consultation');
    const appt4 = await createSlotAndAppt(13, 0, 13, 10, patient2.patientId, 'Blood pressure review');

    // Doctor takes leave from 09:00 to 10:05 (overlaps Appointment 1 from 10:00 to 10:05 by 5 mins)
    const leaveStart = new Date(baseDate);
    leaveStart.setUTCHours(9, 0, 0, 0);
    const leaveEnd = new Date(baseDate);
    leaveEnd.setUTCHours(10, 5, 0, 0);

    const req = new NextRequest(`http://localhost:3000/api/doctors/${doctor.doctorId}/leave`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${doctorToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        startDate: leaveStart.toISOString(),
        endDate: leaveEnd.toISOString(),
        reason: 'Emergency hospital round',
        userId: doctor.id,
      }),
    });

    const res = await leavePOST(req, { params: Promise.resolve({ doctorId: doctor.doctorId }) });
    expect(res.status).toBe(201);
    const leaveData = await res.json();
    expect(leaveData.cancelledAppointments).toBe(1);

    // Verify Appointment 1 is CANCELLED and its slot is ON_LEAVE
    const dbAppt1 = await prisma.appointment.findUnique({ where: { id: appt1.appt.id } });
    const dbSlot1 = await prisma.slot.findUnique({ where: { id: appt1.slot.id } });
    expect(dbAppt1?.status).toBe('CANCELLED');
    expect(dbSlot1?.status).toBe('ON_LEAVE');

    // Verify Appointments 2, 3, 4 remain strictly CONFIRMED and their slots BOOKED
    const dbAppt2 = await prisma.appointment.findUnique({ where: { id: appt2.appt.id } });
    const dbSlot2 = await prisma.slot.findUnique({ where: { id: appt2.slot.id } });
    expect(dbAppt2?.status).toBe('CONFIRMED');
    expect(dbSlot2?.status).toBe('BOOKED');

    const dbAppt3 = await prisma.appointment.findUnique({ where: { id: appt3.appt.id } });
    const dbSlot3 = await prisma.slot.findUnique({ where: { id: appt3.slot.id } });
    expect(dbAppt3?.status).toBe('CONFIRMED');
    expect(dbSlot3?.status).toBe('BOOKED');

    const dbAppt4 = await prisma.appointment.findUnique({ where: { id: appt4.appt.id } });
    const dbSlot4 = await prisma.slot.findUnique({ where: { id: appt4.slot.id } });
    expect(dbAppt4?.status).toBe('CONFIRMED');
    expect(dbSlot4?.status).toBe('BOOKED');

    // Verify patient1 received a cancellation notification
    const notification = await prisma.notification.findFirst({
      where: {
        userId: patient1.id,
        message: { contains: 'Emergency hospital round' },
      },
    });
    expect(notification).toBeDefined();
  });

  // ==========================================
  // 2. LEAVE CANCELLATION INVARIANT
  // ==========================================
  it('2. Cancelling leave restores slots to AVAILABLE, but cancelled appointments REMAIN CANCELLED', async () => {
    const baseDate = new Date();
    baseDate.setDate(baseDate.getDate() + 70); // 70 days in future
    baseDate.setUTCHours(0, 0, 0, 0);

    const slotStart = new Date(baseDate);
    slotStart.setUTCHours(14, 0, 0, 0);
    const slotEnd = new Date(baseDate);
    slotEnd.setUTCHours(14, 30, 0, 0);

    const slot = await prisma.slot.create({
      data: {
        doctorId: doctor.doctorId,
        date: baseDate,
        startTime: slotStart,
        endTime: slotEnd,
        status: 'BOOKED',
      },
    });

    const appt = await prisma.appointment.create({
      data: {
        doctorId: doctor.doctorId,
        patientId: patient1.patientId,
        slotId: slot.id,
        status: 'CONFIRMED',
        paymentMethod: 'ONLINE',
        transactionId: `txn_leave_cancel_${Date.now()}`,
        isAppointmentOffline: false,
        notes: 'Pre-procedure consultation',
      },
    });

    // Doctor takes leave covering 14:00 - 15:00
    const leaveStart = new Date(baseDate);
    leaveStart.setUTCHours(14, 0, 0, 0);
    const leaveEnd = new Date(baseDate);
    leaveEnd.setUTCHours(15, 0, 0, 0);

    const createLeaveReq = new NextRequest(`http://localhost:3000/api/doctors/${doctor.doctorId}/leave`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${doctorToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        startDate: leaveStart.toISOString(),
        endDate: leaveEnd.toISOString(),
        reason: 'Personal leave',
      }),
    });

    const createRes = await leavePOST(createLeaveReq, { params: Promise.resolve({ doctorId: doctor.doctorId }) });
    const leaveData = await createRes.json();
    const leaveId = leaveData.id;

    // Verify appointment was cancelled and slot marked ON_LEAVE
    const apptDuringLeave = await prisma.appointment.findUnique({ where: { id: appt.id } });
    const slotDuringLeave = await prisma.slot.findUnique({ where: { id: slot.id } });
    expect(apptDuringLeave?.status).toBe('CANCELLED');
    expect(slotDuringLeave?.status).toBe('ON_LEAVE');

    // Doctor now CANCELS the leave
    const deleteLeaveReq = new NextRequest(
      `http://localhost:3000/api/doctors/${doctor.doctorId}/leave?leaveId=${leaveId}`,
      {
        method: 'DELETE',
        headers: {
          authorization: `Bearer ${doctorToken}`,
        },
      }
    );

    const deleteRes = await leaveDELETE(deleteLeaveReq, { params: Promise.resolve({ doctorId: doctor.doctorId }) });
    expect(deleteRes.status).toBe(200);

    // INVARIANT 1: Slot is freed back to AVAILABLE
    const slotAfterLeaveCancel = await prisma.slot.findUnique({ where: { id: slot.id } });
    expect(slotAfterLeaveCancel?.status).toBe('AVAILABLE');

    // INVARIANT 2: Cancelled appointment is NEVER restored (strictly stays CANCELLED)
    const apptAfterLeaveCancel = await prisma.appointment.findUnique({ where: { id: appt.id } });
    expect(apptAfterLeaveCancel?.status).toBe('CANCELLED');
  });

  // ==========================================
  // 3. PAST LEAVE VALIDATIONS
  // ==========================================
  it('3. Past Leave Guards: Cannot create a leave in the past, cannot cancel an already ended leave', async () => {
    // 3.1 Attempt to create leave in the past
    const pastStart = new Date();
    pastStart.setDate(pastStart.getDate() - 5);
    const pastEnd = new Date();
    pastEnd.setDate(pastEnd.getDate() - 3);

    const pastLeaveReq = new NextRequest(`http://localhost:3000/api/doctors/${doctor.doctorId}/leave`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${doctorToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        startDate: pastStart.toISOString(),
        endDate: pastEnd.toISOString(),
        reason: 'Retroactive leave attempt',
      }),
    });

    const pastRes = await leavePOST(pastLeaveReq, { params: Promise.resolve({ doctorId: doctor.doctorId }) });
    expect(pastRes.status).toBe(400);

    // 3.2 Attempt to delete a past leave record directly from DB
    const historicalLeave = await prisma.leave.create({
      data: {
        doctorId: doctor.doctorId,
        startDate: pastStart,
        endDate: pastEnd,
        reason: 'Historical completed leave',
      },
    });

    const deletePastReq = new NextRequest(
      `http://localhost:3000/api/doctors/${doctor.doctorId}/leave?leaveId=${historicalLeave.id}`,
      {
        method: 'DELETE',
        headers: {
          authorization: `Bearer ${doctorToken}`,
        },
      }
    );

    const deletePastRes = await leaveDELETE(deletePastReq, { params: Promise.resolve({ doctorId: doctor.doctorId }) });
    expect(deletePastRes.status).toBe(400);

    // Cleanup
    await prisma.leave.delete({ where: { id: historicalLeave.id } });
  });

  // ==========================================
  // 4. PATIENT SEARCH WITH APPOINTMENT HISTORY & NOTES
  // ==========================================
  it('4. Doctor Patient Search: Returns full appointment history, notes, medications, and details', async () => {
    // Create appointments with notes for patient1 with this doctor
    const testDate = new Date();
    testDate.setDate(testDate.getDate() + 80);

    const slot1 = await prisma.slot.create({
      data: {
        doctorId: doctor.doctorId,
        date: testDate,
        startTime: testDate,
        endTime: new Date(testDate.getTime() + 1800000),
        status: 'BOOKED',
      },
    });

    await prisma.appointment.create({
      data: {
        doctorId: doctor.doctorId,
        patientId: patient1.patientId,
        slotId: slot1.id,
        status: 'COMPLETED',
        paymentMethod: 'ONLINE',
        transactionId: `txn_search_hist_${Date.now()}`,
        isAppointmentOffline: false,
        notes: 'Prescribed Atorvastatin 20mg daily. Lipid panel follow-up in 3 months.',
      },
    });

    // Query patients endpoint as doctor
    const req = new NextRequest(
      `http://localhost:3000/api/patients?doctorId=${doctor.doctorId}&name=${encodeURIComponent(patient1.name)}`,
      {
        method: 'GET',
        headers: {
          authorization: `Bearer ${doctorToken}`,
        },
      }
    );

    const res = await patientsGET(req);
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThanOrEqual(1);

    const patientRecord = data.find((p: any) => p.id === patient1.patientId);
    expect(patientRecord).toBeDefined();
    expect(patientRecord.name).toBe(patient1.name);
    expect(patientRecord.medicalHistory).toBeDefined();
    expect(patientRecord.allergies).toBeDefined();
    expect(patientRecord.currentMedications).toBeDefined();

    // Verify appointments history and notes are included
    expect(Array.isArray(patientRecord.appointments)).toBe(true);
    expect(patientRecord.appointments.length).toBeGreaterThanOrEqual(1);

    const completedAppt = patientRecord.appointments.find((a: any) => a.status === 'COMPLETED');
    expect(completedAppt).toBeDefined();
    expect(completedAppt.notes).toContain('Prescribed Atorvastatin 20mg daily');
  });
});
