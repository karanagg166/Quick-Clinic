import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { createToken, verifyToken, getAuthenticatedUser, requireAdmin } from '@/lib/auth';
import { POST as signupPOST } from '@/app/api/user/signup/route';
import { GET as getPatientGET } from '@/app/api/patients/[patientId]/route';
import { GET as getPatientAppointmentsGET } from '@/app/api/patients/[patientId]/appointments/route';
import { GET as getDoctorEarningsGET } from '@/app/api/doctors/[doctorId]/earnings/route';
import { GET as getDoctorBalanceGET } from '@/app/api/doctors/[doctorId]/balance/route';
import { prisma } from '@/lib/prisma';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    patient: {
      findUnique: vi.fn(),
    },
    doctor: {
      findUnique: vi.fn(),
    },
  },
}));

describe('Quick-Clinic: Authentication, RBAC, and IDOR Security Matrix', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.user.findUnique).mockImplementation(async (args) => ({
      id: args.where.id,
      role: args.where.id?.includes("doctor") ? "DOCTOR" : "PATIENT",
      isActive: true,
      email: "user@test.com", name: "User",
    }) as never);
  });

  describe('JWT Verification & Authoritative Identity Claims', () => {
    it('rejects token with missing role claim (no silent PATIENT fallback)', async () => {
      const token = await createToken({ id: 'user_no_role', email: 'norole@test.com' });
      const req = new NextRequest('http://localhost:3000/api/test', {
        headers: { authorization: `Bearer ${token}` },
      });
      const user = await getAuthenticatedUser(req);
      expect(user).toBeNull();
    });

    it('rejects token with invalid or spoofed role claim', async () => {
      const token = await createToken({ id: 'user_bad_role', role: 'SUPER_HACKER' });
      const req = new NextRequest('http://localhost:3000/api/test', {
        headers: { authorization: `Bearer ${token}` },
      });
      const user = await getAuthenticatedUser(req);
      expect(user).toBeNull();
    });

    it('rejects tampered or forged JWT tokens', async () => {
      const req = new NextRequest('http://localhost:3000/api/test', {
        headers: { authorization: 'Bearer invalid.tampered.token' },
      });
      const user = await getAuthenticatedUser(req);
      expect(user).toBeNull();
    });

    it('verifies DB-authoritative role when verifyDb option is used', async () => {
      const token = await createToken({ id: 'user_tampered_role', role: 'ADMIN' });
      const req = new NextRequest('http://localhost:3000/api/test', {
        headers: { authorization: `Bearer ${token}` },
      });

      // Mock DB returning PATIENT role for this user
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
        id: 'user_tampered_role',
        role: 'PATIENT',
        isActive: true,
        email: 'user@test.com',
        name: 'Normal User',
      } as any);

      // Even though token says ADMIN, verifyDb detects mismatch with DB role
      const user = await getAuthenticatedUser(req, { verifyDb: true });
      expect(user).toBeNull();
    });

    it('requireAdmin rejects token when DB user does not exist or has non-admin role', async () => {
      const token = await createToken({ id: 'demoted_user', role: 'ADMIN' });
      const req = new NextRequest('http://localhost:3000/api/admin', {
        headers: { authorization: `Bearer ${token}` },
      });

      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
        id: 'demoted_user',
        role: 'DOCTOR',
        isActive: true,
        email: 'demoted@test.com',
        name: 'Demoted Doc',
      } as any);

      const admin = await requireAdmin(req, { verifyDb: true });
      expect(admin).toBeNull();
    });
  });

  describe('Registration & Role Tampering Prevention', () => {
    it('rejects public signup requesting role=ADMIN with 403 Forbidden', async () => {
      const req = new NextRequest('http://localhost:3000/api/user/signup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'Hacker Admin',
          email: 'hacker@clinic.test',
          phoneNo: '1234567890',
          password: 'Password123!',
          age: 30,
          address: '123 Test St',
          city: 'Delhi',
          state: 'Delhi',
          pinCode: 110001,
          gender: 'MALE',
          role: 'ADMIN',
        }),
      });

      const res = await signupPOST(req);
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toMatch(/ADMIN accounts cannot be self-registered/i);
    });
  });

  describe('IDOR & Cross-User Resource Isolation', () => {
    it('Patient A cannot access Patient B profile (403 Forbidden)', async () => {
      const patientAToken = await createToken({ id: 'user_patient_A', role: 'PATIENT' });
      
      vi.mocked(prisma.patient.findUnique).mockResolvedValueOnce({
        id: 'patient_B',
        userId: 'user_patient_B',
        user: { name: 'Patient B' },
      } as any);

      const req = new NextRequest('http://localhost:3000/api/patients/patient_B', {
        headers: { authorization: `Bearer ${patientAToken}` },
      });

      const res = await getPatientGET(req, {
        params: Promise.resolve({ patientId: 'patient_B' }),
      });
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toBe('Forbidden');
    });

    it('Patient A cannot access Patient B appointments (403 Forbidden)', async () => {
      const patientAToken = await createToken({ id: 'user_patient_A', role: 'PATIENT' });

      vi.mocked(prisma.patient.findUnique).mockResolvedValueOnce({
        id: 'patient_B',
        userId: 'user_patient_B',
      } as any);

      const req = new NextRequest('http://localhost:3000/api/patients/patient_B/appointments', {
        headers: { authorization: `Bearer ${patientAToken}` },
      });

      const res = await getPatientAppointmentsGET(req, {
        params: Promise.resolve({ patientId: 'patient_B' }),
      });
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toBe('Forbidden');
    });

    it('Doctor A cannot access Doctor B earnings (403 Forbidden)', async () => {
      const docAToken = await createToken({ id: 'user_doctor_A', role: 'DOCTOR' });

      vi.mocked(prisma.doctor.findUnique).mockResolvedValueOnce({
        id: 'doctor_B',
        userId: 'user_doctor_B',
        fees: 1000,
      } as any);

      const req = new NextRequest('http://localhost:3000/api/doctors/doctor_B/earnings', {
        headers: { authorization: `Bearer ${docAToken}` },
      });

      const res = await getDoctorEarningsGET(req, {
        params: Promise.resolve({ doctorId: 'doctor_B' }),
      });
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toBe('Forbidden');
    });

    it('Doctor A cannot access Doctor B balance (403 Forbidden)', async () => {
      const docAToken = await createToken({ id: 'user_doctor_A', role: 'DOCTOR' });

      vi.mocked(prisma.doctor.findUnique).mockResolvedValueOnce({
        id: 'doctor_B',
        userId: 'user_doctor_B',
        balance: 500000,
        fees: 1000,
      } as any);

      const req = new NextRequest('http://localhost:3000/api/doctors/doctor_B/balance', {
        headers: { authorization: `Bearer ${docAToken}` },
      });

      const res = await getDoctorBalanceGET(req, {
        params: Promise.resolve({ doctorId: 'doctor_B' }),
      });
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toBe('Forbidden');
    });
  });
});
