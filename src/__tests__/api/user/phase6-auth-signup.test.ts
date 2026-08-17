import { describe, it, expect, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as signupPOST } from '@/app/api/user/signup/route';
import { prisma } from '@/lib/prisma';
import { buildUserPayload } from '@/__tests__/helpers/factories';

describe('Phase 6: Authentication & Signup Test Suite', () => {
  const createdEmails: string[] = [];

  afterAll(async () => {
    if (createdEmails.length > 0) {
      await prisma.auditLog.deleteMany({
        where: { user: { email: { in: createdEmails } } },
      });
      await prisma.user.deleteMany({
        where: { email: { in: createdEmails } },
      });
    }
  });

  it('6.1 registers a new PATIENT with valid fields', async () => {
    const payload = buildUserPayload({ role: 'PATIENT', gender: 'MALE', age: 26 });
    createdEmails.push(payload.email);

    const req = new NextRequest('http://localhost:3000/api/user/signup', {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    const res = await signupPOST(req);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.message).toBe('User created successfully');
    expect(body.user.email).toBe(payload.email);
    expect(body.user.role).toBe('PATIENT');
    expect(body.user.age).toBe(26);

    const tokenCookie = res.cookies.get('token');
    expect(tokenCookie?.value).toBeDefined();

    const dbUser = await prisma.user.findUnique({
      where: { email: payload.email },
      include: { location: true },
    });
    expect(dbUser).not.toBeNull();
    expect(dbUser?.role).toBe('PATIENT');
    expect(dbUser?.location.pincode).toBe(payload.pinCode);
  });

  it('6.2 registers a new DOCTOR with valid fields and verified role DOCTOR', async () => {
    const payload = buildUserPayload({
      name: 'Dr. Registration Test',
      role: 'DOCTOR',
      gender: 'FEMALE',
      age: 38,
    });
    createdEmails.push(payload.email);

    const req = new NextRequest('http://localhost:3000/api/user/signup', {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    const res = await signupPOST(req);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.user.role).toBe('DOCTOR');

    const dbUser = await prisma.user.findUnique({
      where: { email: payload.email },
    });
    expect(dbUser?.role).toBe('DOCTOR');
  });

  it('6.3 rejects signup when email is already registered', async () => {
    const payload = buildUserPayload({ role: 'PATIENT' });
    createdEmails.push(payload.email);

    const req1 = new NextRequest('http://localhost:3000/api/user/signup', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    const res1 = await signupPOST(req1);
    expect(res1.status).toBe(201);

    const req2 = new NextRequest('http://localhost:3000/api/user/signup', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    const res2 = await signupPOST(req2);
    expect(res2.status).toBe(400);
    const body2 = await res2.json();
    expect(body2.error).toBe('User already exists');
  });

  it('6.4 verifies audit log creation upon successful user registration', async () => {
    const payload = buildUserPayload({ role: 'PATIENT' });
    createdEmails.push(payload.email);

    const req = new NextRequest('http://localhost:3000/api/user/signup', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    const res = await signupPOST(req);
    expect(res.status).toBe(201);

    const dbUser = await prisma.user.findUnique({
      where: { email: payload.email },
      include: { auditLogs: true },
    });
    expect(dbUser?.auditLogs.length).toBeGreaterThan(0);
    expect(dbUser?.auditLogs.some((l) => l.action === 'User Created')).toBe(true);
  });
});
