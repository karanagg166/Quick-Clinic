import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { GET as slotsGET } from '@/app/api/doctors/[doctorId]/slots/route';
import { GET as patientAppointmentsGET } from '@/app/api/patients/[patientId]/appointments/route';
import { prisma } from '@/lib/prisma';
import { buildUserPayload } from '@/__tests__/helpers/factories';

describe('Phase 15: Appointment & Slot Availability Search Engine Test Suite', () => {
  let doctorUserId: string;
  let doctorId: string;
  let patientUserId: string;
  let patientId: string;

  const testFutureDate = '2028-11-20'; // Future date for availability test
  const testPastDate = '2020-01-10'; // Past date

  beforeAll(async () => {
    // 1. Create Doctor
    const docUserPayload = buildUserPayload({
      name: 'Dr. Availability Finder',
      email: `doc_avail_${Date.now()}@quickclinic.test`,
      role: 'DOCTOR',
    });

    const docUser = await prisma.user.create({
      data: {
        name: docUserPayload.name,
        email: docUserPayload.email,
        phoneNo: docUserPayload.phoneNo,
        password: docUserPayload.password,
        age: 48,
        address: docUserPayload.address,
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
    doctorUserId = docUser.id;

    const doc = await prisma.doctor.create({
      data: {
        userId: docUser.id,
        specialty: 'PEDIATRICIAN',
        fees: 650,
        experience: 14,
      },
    });
    doctorId = doc.id;

    // 2. Create Patient
    const patUserPayload = buildUserPayload({
      name: 'Searching Patient',
      email: `pat_avail_${Date.now()}@quickclinic.test`,
      role: 'PATIENT',
    });

    const patUser = await prisma.user.create({
      data: {
        name: patUserPayload.name,
        email: patUserPayload.email,
        phoneNo: patUserPayload.phoneNo,
        password: patUserPayload.password,
        age: 26,
        address: patUserPayload.address,
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

    const pat = await prisma.patient.create({
      data: {
        userId: patUser.id,
        medicalHistory: 'None',
      },
    });
    patientId = pat.id;

    // 3. Create discrete slots on testFutureDate with different appointment statuses:
    // Slot 1: AVAILABLE
    await prisma.slot.create({
      data: {
        doctorId,
        date: new Date(`${testFutureDate}T00:00:00.000Z`),
        startTime: new Date(`${testFutureDate}T09:00:00.000Z`),
        endTime: new Date(`${testFutureDate}T09:10:00.000Z`),
        status: 'AVAILABLE',
      },
    });

    // Slot 2: BOOKED (with CONFIRMED appointment)
    const slotBooked = await prisma.slot.create({
      data: {
        doctorId,
        date: new Date(`${testFutureDate}T00:00:00.000Z`),
        startTime: new Date(`${testFutureDate}T09:10:00.000Z`),
        endTime: new Date(`${testFutureDate}T09:20:00.000Z`),
        status: 'BOOKED',
      },
    });

    await prisma.appointment.create({
      data: {
        doctorId,
        patientId,
        slotId: slotBooked.id,
        status: 'CONFIRMED',
        paymentMethod: 'ONLINE',
        isAppointmentOffline: false,
      },
    });

    // Slot 3: ON_LEAVE
    await prisma.slot.create({
      data: {
        doctorId,
        date: new Date(`${testFutureDate}T00:00:00.000Z`),
        startTime: new Date(`${testFutureDate}T09:20:00.000Z`),
        endTime: new Date(`${testFutureDate}T09:30:00.000Z`),
        status: 'ON_LEAVE',
      },
    });

    // Slot 4: Past slot on past date
    await prisma.slot.create({
      data: {
        doctorId,
        date: new Date(`${testPastDate}T00:00:00.000Z`),
        startTime: new Date(`${testPastDate}T10:00:00.000Z`),
        endTime: new Date(`${testPastDate}T10:10:00.000Z`),
        status: 'AVAILABLE', // will be transformed to UNAVAILABLE because time has passed
      },
    });
  });

  afterAll(async () => {
    try {
      await prisma.appointment.deleteMany({ where: { doctorId } });
      await prisma.slot.deleteMany({ where: { doctorId } });
      await prisma.doctor.deleteMany({ where: { id: doctorId } });
      await prisma.patient.deleteMany({ where: { id: patientId } });
      await prisma.user.deleteMany({ where: { id: { in: [doctorUserId, patientUserId] } } });
    } catch (e) {
      console.warn('Phase 15 cleanup warning:', e);
    }
  });

  it('15.1 returns distinct slot statuses accurately across AVAILABLE, BOOKED, and ON_LEAVE', async () => {
    const req = new NextRequest(`http://localhost:3000/api/doctors/${doctorId}/slots?date=${testFutureDate}`);
    const res = await slotsGET(req, { params: Promise.resolve({ doctorId }) });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.slots.length).toBe(3);

    const availableSlot = body.slots.find((s: any) => s.startTime.includes('09:00:00'));
    expect(availableSlot?.status).toBe('AVAILABLE');

    const bookedSlot = body.slots.find((s: any) => s.startTime.includes('09:10:00'));
    expect(bookedSlot?.status).toBe('BOOKED');

    const leaveSlot = body.slots.find((s: any) => s.startTime.includes('09:20:00'));
    expect(leaveSlot?.status).toBe('ON_LEAVE');
  });

  it('15.2 dynamically marks past slots as UNAVAILABLE in availability query', async () => {
    const req = new NextRequest(`http://localhost:3000/api/doctors/${doctorId}/slots?date=${testPastDate}`);
    const res = await slotsGET(req, { params: Promise.resolve({ doctorId }) });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.slots.length).toBe(1);
    expect(body.slots[0].status).toBe('UNAVAILABLE');
  });

  it('15.3 filters patient appointments by status, specialty, and doctor name', async () => {
    const req = new NextRequest(
      `http://localhost:3000/api/patients/${patientId}/appointments?status=CONFIRMED&specialty=PEDIATRICIAN&doctorName=Availability`
    );
    const res = await patientAppointmentsGET(req, { params: Promise.resolve({ patientId }) });

    expect(res.status).toBe(200);
    const appointments = await res.json();
    expect(Array.isArray(appointments)).toBe(true);
    expect(appointments.length).toBe(1);
    expect(appointments[0].status).toBe('CONFIRMED');
    expect(appointments[0].specialty).toBe('PEDIATRICIAN');
    expect(appointments[0].doctorName).toContain('Availability');
  });

  it('15.4 returns empty array when patient search criteria yield no matches', async () => {
    const req = new NextRequest(`http://localhost:3000/api/patients/${patientId}/appointments?status=CANCELLED`);
    const res = await patientAppointmentsGET(req, { params: Promise.resolve({ patientId }) });

    expect(res.status).toBe(200);
    const appointments = await res.json();
    expect(appointments).toEqual([]);
  });
});
