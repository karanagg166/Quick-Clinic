import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { GET as getDoctorGET } from '@/app/api/doctors/[doctorId]/route';
import { prisma } from '@/lib/prisma';
import { createToken } from '@/lib/auth';
import { buildUserPayload } from '@/__tests__/helpers/factories';

describe('Phase 11: Doctor Profile Visibility & Privacy Test Suite', () => {
  let doctorUserId: string;
  let doctorId: string;
  let patientUserId: string;
  let patientId: string;
  let patientToken: string;

  beforeAll(async () => {
    // 1. Create Doctor with full profile, qualification, and location
    const docUserPayload = buildUserPayload({
      name: 'Dr. Visibility Specialist',
      email: `doc_vis_${Date.now()}@quickclinic.test`,
      role: 'DOCTOR',
      gender: 'FEMALE',
      address: 'Suite 404 Medical Tower',
    });

    const docUser = await prisma.user.create({
      data: {
        name: docUserPayload.name,
        email: docUserPayload.email,
        phoneNo: docUserPayload.phoneNo,
        password: docUserPayload.password,
        age: 42,
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
        specialty: 'CARDIOLOGIST',
        fees: 850,
        experience: 16,
        doctorBio: 'Expert in clinical cardiology and heart wellness.',
        latitude: 28.4089,
        longitude: 77.3178,
        balance: 500000, // 5000 INR in paise - sensitive
        doctorQualifications: {
          create: [{ qualification: 'MBBS' }, { qualification: 'MD' }],
        },
      },
    });
    doctorId = doc.id;

    // 2. Create Patient
    const patUserPayload = buildUserPayload({
      name: 'Patient Viewer',
      email: `pat_vis_${Date.now()}@quickclinic.test`,
      role: 'PATIENT',
    });

    const patUser = await prisma.user.create({
      data: {
        name: patUserPayload.name,
        email: patUserPayload.email,
        phoneNo: patUserPayload.phoneNo,
        password: patUserPayload.password,
        age: 28,
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

    patientToken = await createToken({ id: patientUserId, role: 'PATIENT', email: patUser.email });

    // 3. Add rating and comment
    await prisma.rating.create({
      data: {
        doctorId,
        patientId,
        rating: 5,
      },
    });

    await prisma.comment.create({
      data: {
        doctorId,
        patientId,
        text: 'Outstanding consultation and clear diagnosis.',
      },
    });
  });

  afterAll(async () => {
    try {
      await prisma.accessLog.deleteMany({ where: { targetId: doctorId } });
      await prisma.comment.deleteMany({ where: { doctorId } });
      await prisma.rating.deleteMany({ where: { doctorId } });
      await prisma.doctorQualification.deleteMany({ where: { doctorId } });
      await prisma.doctor.deleteMany({ where: { id: doctorId } });
      await prisma.patient.deleteMany({ where: { id: patientId } });
      await prisma.user.deleteMany({ where: { id: { in: [doctorUserId, patientUserId] } } });
    } catch (e) {
      console.warn('Phase 11 cleanup warning:', e);
    }
  });

  it('11.1 retrieves full public doctor profile with allowed fields', async () => {
    const req = new NextRequest(`http://localhost:3000/api/doctors/${doctorId}`);
    const res = await getDoctorGET(req, { params: Promise.resolve({ doctorId }) });

    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.doctor).toBeDefined();
    expect(body.doctor.id).toBe(doctorId);
    expect(body.doctor.name).toBe('Dr. Visibility Specialist');
    expect(body.doctor.specialty).toBe('CARDIOLOGIST');
    expect(body.doctor.fees).toBe(850);
    expect(body.doctor.experience).toBe(16);
    expect(body.doctor.doctorBio).toBe('Expert in clinical cardiology and heart wellness.');
    expect(body.doctor.qualifications).toEqual(expect.arrayContaining(['MBBS', 'MD']));
    expect(body.doctor.city).toBe('Faridabad');
    expect(body.doctor.state).toBe('Haryana');
    expect(body.doctor.latitude).toBeCloseTo(28.4089, 3);
    expect(body.doctor.longitude).toBeCloseTo(77.3178, 3);
  });

  it('11.2 guarantees sensitive data is NOT exposed in the doctor profile response', async () => {
    const req = new NextRequest(`http://localhost:3000/api/doctors/${doctorId}`);
    const res = await getDoctorGET(req, { params: Promise.resolve({ doctorId }) });
    const body = await res.json();

    // Sensitive doctor attributes must not be leaked
    expect(body.doctor.password).toBeUndefined();
    expect(body.doctor.balance).toBeUndefined();
    expect(body.doctor.bankAccount).toBeUndefined();
    expect(body.doctor.bankAccountNumber).toBeUndefined();
    expect(body.doctor.bankDetails).toBeUndefined();
    expect(body.doctor.auditLogs).toBeUndefined();
    expect(body.doctor.accessLogs).toBeUndefined();
  });

  it('11.3 aggregates rating and returns sanitized patient review comments', async () => {
    const req = new NextRequest(`http://localhost:3000/api/doctors/${doctorId}`);
    const res = await getDoctorGET(req, { params: Promise.resolve({ doctorId }) });
    const body = await res.json();

    expect(body.rating).toBeDefined();
    expect(body.rating.average).toBe(5);
    expect(body.rating.count).toBe(1);

    expect(body.comments).toBeDefined();
    expect(body.comments.length).toBeGreaterThanOrEqual(1);
    const comment = body.comments[0];
    expect(comment.text).toBe('Outstanding consultation and clear diagnosis.');
    expect(comment.user).toBeDefined();
    expect(comment.user.name).toBe('Patient Viewer');
    // Patient password and sensitive attributes must not be included
    expect(comment.user.password).toBeUndefined();
  });

  it('11.4 evaluates review eligibility and userRating for authenticated patient', async () => {
    const req = new NextRequest(`http://localhost:3000/api/doctors/${doctorId}`, {
      headers: {
        authorization: `Bearer ${patientToken}`,
      },
    });
    const res = await getDoctorGET(req, { params: Promise.resolve({ doctorId }) });
    expect(res.status).toBe(200);
    const body = await res.json();

    // Patient has rated the doctor
    expect(body.userRating).toBe(5);
    // Since patient hasn't completed an appointment in this test, canReview should be false
    expect(body.canReview).toBe(false);
  });

  it('11.5 returns 404 for non-existent doctor ID and 400 for empty doctor ID', async () => {
    const nonExistentReq = new NextRequest('http://localhost:3000/api/doctors/non_existent_doctor_id_999');
    const nonExistentRes = await getDoctorGET(nonExistentReq, {
      params: Promise.resolve({ doctorId: 'non_existent_doctor_id_999' }),
    });
    expect(nonExistentRes.status).toBe(404);

    const emptyReq = new NextRequest('http://localhost:3000/api/doctors/');
    const emptyRes = await getDoctorGET(emptyReq, {
      params: Promise.resolve({ doctorId: '' }),
    });
    expect(emptyRes.status).toBe(400);
  });
});
