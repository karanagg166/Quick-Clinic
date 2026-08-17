import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as sendOtpPOST } from '@/app/api/user/[userId]/otp/send/route';
import { POST as verifyOtpPOST } from '@/app/api/user/[userId]/otp/verify/route';
import { prisma } from '@/lib/prisma';
import { buildUserPayload } from '@/__tests__/helpers/factories';

describe('Phase 7: Email Verification & OTP Test Suite', () => {
  let testUser: any;

  beforeEach(async () => {
    const payload = buildUserPayload({ role: 'PATIENT' });
    const created = await prisma.user.create({
      data: {
        name: payload.name,
        email: payload.email,
        phoneNo: payload.phoneNo,
        password: payload.password,
        age: payload.age,
        address: payload.address,
        role: payload.role,
        gender: payload.gender,
        location: {
          connectOrCreate: {
            where: { pincode: payload.pinCode },
            create: {
              pincode: payload.pinCode,
              city: payload.city,
              state: payload.state,
            },
          },
        },
      },
    });
    testUser = created;
  });

  afterAll(async () => {
    await prisma.otp.deleteMany({
      where: { user: { email: { contains: '@quickclinic.test' } } },
    });
    await prisma.user.deleteMany({
      where: { email: { contains: '@quickclinic.test' } },
    });
  });

  it('7.1 sends/generates OTP and stores in database', async () => {
    const req = new NextRequest(`http://localhost:3000/api/user/${testUser.id}/otp/send`, {
      method: 'POST',
    });
    const res = await sendOtpPOST(req, { params: Promise.resolve({ userId: testUser.id }) });
    expect(res.status).toBe(200);

    const otpRecord = await prisma.otp.findFirst({
      where: { userId: testUser.id },
    });
    expect(otpRecord).not.toBeNull();
    expect(otpRecord?.code).toHaveLength(6);
    expect(otpRecord?.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('7.2 verifies correct OTP and marks user emailVerified', async () => {
    // Seed OTP
    await prisma.otp.upsert({
      where: { email: testUser.email },
      update: { code: '123456', userId: testUser.id, expiresAt: new Date(Date.now() + 600000) },
      create: { email: testUser.email, code: '123456', userId: testUser.id, expiresAt: new Date(Date.now() + 600000) },
    });

    const req = new NextRequest(`http://localhost:3000/api/user/${testUser.id}/otp/verify`, {
      method: 'POST',
      body: JSON.stringify({ otp: '123456' }),
    });

    const res = await verifyOtpPOST(req, { params: Promise.resolve({ userId: testUser.id }) });
    expect(res.status).toBe(200);

    const updatedUser = await prisma.user.findUnique({ where: { id: testUser.id } });
    expect(updatedUser?.emailVerified).toBe(true);

    const otpRemaining = await prisma.otp.findFirst({ where: { userId: testUser.id } });
    expect(otpRemaining).toBeNull();
  });

  it('7.3 rejects incorrect OTP code', async () => {
    await prisma.otp.upsert({
      where: { email: testUser.email },
      update: { code: '123456', userId: testUser.id, expiresAt: new Date(Date.now() + 600000) },
      create: { email: testUser.email, code: '123456', userId: testUser.id, expiresAt: new Date(Date.now() + 600000) },
    });

    const req = new NextRequest(`http://localhost:3000/api/user/${testUser.id}/otp/verify`, {
      method: 'POST',
      body: JSON.stringify({ otp: '999999' }),
    });

    const res = await verifyOtpPOST(req, { params: Promise.resolve({ userId: testUser.id }) });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.message).toBe('Invalid OTP');
  });

  it('7.4 rejects expired OTP code', async () => {
    await prisma.otp.upsert({
      where: { email: testUser.email },
      update: { code: '123456', userId: testUser.id, expiresAt: new Date(Date.now() - 60000) },
      create: { email: testUser.email, code: '123456', userId: testUser.id, expiresAt: new Date(Date.now() - 60000) },
    });

    const req = new NextRequest(`http://localhost:3000/api/user/${testUser.id}/otp/verify`, {
      method: 'POST',
      body: JSON.stringify({ otp: '123456' }),
    });

    const res = await verifyOtpPOST(req, { params: Promise.resolve({ userId: testUser.id }) });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.message).toBe('OTP has expired');
  });

  it('7.5 prevents reuse of already verified OTP', async () => {
    await prisma.otp.upsert({
      where: { email: testUser.email },
      update: { code: '123456', userId: testUser.id, expiresAt: new Date(Date.now() + 600000) },
      create: { email: testUser.email, code: '123456', userId: testUser.id, expiresAt: new Date(Date.now() + 600000) },
    });

    // First verification succeeds
    const req1 = new NextRequest(`http://localhost:3000/api/user/${testUser.id}/otp/verify`, {
      method: 'POST',
      body: JSON.stringify({ otp: '123456' }),
    });
    const res1 = await verifyOtpPOST(req1, { params: Promise.resolve({ userId: testUser.id }) });
    expect(res1.status).toBe(200);

    // Second verification must fail because OTP was deleted
    const req2 = new NextRequest(`http://localhost:3000/api/user/${testUser.id}/otp/verify`, {
      method: 'POST',
      body: JSON.stringify({ otp: '123456' }),
    });
    const res2 = await verifyOtpPOST(req2, { params: Promise.resolve({ userId: testUser.id }) });
    expect(res2.status).toBe(400);
  });
});
