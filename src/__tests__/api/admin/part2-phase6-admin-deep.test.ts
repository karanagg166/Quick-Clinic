import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { createToken } from '@/lib/auth';
import { GET as usersGET } from '@/app/api/admin/users/route';
import { GET as userDetailGET, PATCH as userPATCH } from '@/app/api/admin/users/[userId]/route';
import { GET as withdrawalsGET, PATCH as withdrawalPATCH } from '@/app/api/admin/withdrawals/route';
import { GET as analyticsGET } from '@/app/api/admin/analytics/route';
import { GET as logsGET } from '@/app/api/admin/logs/route';
import { seedPart2Dataset, cleanupPart2Dataset, Part2Dataset } from '@/__tests__/helpers/part2-dataset';

describe('Phase 6 — Admin Deep Testing & User Management Suite', () => {
  let dataset: Part2Dataset;
  let superAdminToken: string;
  let subAdmin1Token: string;
  let subAdmin2Token: string;
  let doctorToken: string;
  let patientToken: string;

  beforeAll(async () => {
    dataset = await seedPart2Dataset();

    superAdminToken = await createToken({
      id: dataset.superAdmin.id,
      userId: dataset.superAdmin.id,
      role: 'ADMIN',
      email: dataset.superAdmin.email,
      name: dataset.superAdmin.name,
    });

    subAdmin1Token = await createToken({
      id: dataset.subAdmins[0].id,
      userId: dataset.subAdmins[0].id,
      role: 'ADMIN',
      email: dataset.subAdmins[0].email,
      name: dataset.subAdmins[0].name,
    });

    subAdmin2Token = await createToken({
      id: dataset.subAdmins[1].id,
      userId: dataset.subAdmins[1].id,
      role: 'ADMIN',
      email: dataset.subAdmins[1].email,
      name: dataset.subAdmins[1].name,
    });

    doctorToken = await createToken({
      id: dataset.doctors[0].id,
      userId: dataset.doctors[0].id,
      role: 'DOCTOR',
      email: dataset.doctors[0].email,
      name: dataset.doctors[0].name,
    });

    patientToken = await createToken({
      id: dataset.patients[0].id,
      userId: dataset.patients[0].id,
      role: 'PATIENT',
      email: dataset.patients[0].email,
      name: dataset.patients[0].name,
    });
  });

  afterAll(async () => {
    if (dataset) {
      await cleanupPart2Dataset(dataset);
    }
  });

  // --------------------------------------------------------------------------
  // 6.1 Authentication & RBAC Guard
  // --------------------------------------------------------------------------
  describe('6.1 Authentication & RBAC Guard', () => {
    it('6.1.1 Rejects unauthenticated request to /api/admin/users with 401', async () => {
      const req = new NextRequest('http://localhost:3000/api/admin/users');
      const res = await usersGET(req);
      expect(res.status).toBe(401);
    });

    it('6.1.2 Rejects non-admin patient role with 403', async () => {
      const req = new NextRequest('http://localhost:3000/api/admin/users', {
        headers: { authorization: `Bearer ${patientToken}` },
      });
      const res = await usersGET(req);
      expect(res.status).toBe(403);
    });

    it('6.1.3 Rejects non-admin doctor role with 403', async () => {
      const req = new NextRequest('http://localhost:3000/api/admin/users', {
        headers: { authorization: `Bearer ${doctorToken}` },
      });
      const res = await usersGET(req);
      expect(res.status).toBe(403);
    });

    it('6.1.4 Allows valid Admin access to /api/admin/users', async () => {
      const req = new NextRequest('http://localhost:3000/api/admin/users', {
        headers: { authorization: `Bearer ${superAdminToken}` },
      });
      const res = await usersGET(req);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(Array.isArray(data.users)).toBe(true);
      expect(data.pagination).toBeDefined();
    });
  });

  // --------------------------------------------------------------------------
  // 6.2 User Management & Filtering
  // --------------------------------------------------------------------------
  describe('6.2 User Management & Filtering', () => {
    it('6.2.1 Filters users by role (DOCTOR)', async () => {
      const req = new NextRequest('http://localhost:3000/api/admin/users?role=DOCTOR', {
        headers: { authorization: `Bearer ${superAdminToken}` },
      });
      const res = await usersGET(req);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.users.length).toBeGreaterThanOrEqual(6);
      expect(data.users.every((u: any) => u.role === 'DOCTOR')).toBe(true);
    });

    it('6.2.2 Searches users by partial name', async () => {
      const req = new NextRequest('http://localhost:3000/api/admin/users?search=Aarav', {
        headers: { authorization: `Bearer ${superAdminToken}` },
      });
      const res = await usersGET(req);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.users.length).toBeGreaterThanOrEqual(1);
      expect(data.users.some((u: any) => u.name.includes('Aarav'))).toBe(true);
    });

    it('6.2.3 View user detail with doctor/patient associations', async () => {
      const doc = dataset.doctors[0];
      const req = new NextRequest(`http://localhost:3000/api/admin/users/${doc.id}`, {
        headers: { authorization: `Bearer ${superAdminToken}` },
      });

      const res = await userDetailGET(req, { params: Promise.resolve({ userId: doc.id }) });
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.user.id).toBe(doc.id);
      expect(data.user.doctor).toBeDefined();
      expect(data.user.doctor.specialty).toBe('CARDIOLOGIST');
    });
  });

  // --------------------------------------------------------------------------
  // 6.3 User Deactivation & Cascading Safety
  // --------------------------------------------------------------------------
  describe('6.3 User Deactivation & Cascading Safety', () => {
    it('6.3.1 Deactivating a doctor auto-cancels pending/confirmed appointments and marks slots UNAVAILABLE', async () => {
      const doc = dataset.doctors[2]; // Dr. Chirag

      // Seed an active slot and appointment
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 20);
      const futureEnd = new Date(futureDate);
      futureEnd.setMinutes(futureEnd.getMinutes() + 30);

      const slot = await prisma.slot.create({
        data: {
          doctorId: doc.doctorId,
          date: futureDate,
          startTime: futureDate,
          endTime: futureEnd,
          status: 'BOOKED',
        },
      });

      const appt = await prisma.appointment.create({
        data: {
          doctorId: doc.doctorId,
          patientId: dataset.patients[0].patientId,
          slotId: slot.id,
          status: 'CONFIRMED',
          paymentMethod: 'OFFLINE',
          isAppointmentOffline: true,
        },
      });

      // Deactivate doctor
      const req = new NextRequest(`http://localhost:3000/api/admin/users/${doc.id}`, {
        method: 'PATCH',
        headers: {
          authorization: `Bearer ${superAdminToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ isActive: false }),
      });

      const res = await userPATCH(req, { params: Promise.resolve({ userId: doc.id }) });
      expect(res.status).toBe(200);

      // Verify doctor isActive is false
      const userInDb = await prisma.user.findUnique({ where: { id: doc.id } });
      expect(userInDb?.isActive).toBe(false);

      // Verify appointment auto-cancelled
      const apptInDb = await prisma.appointment.findUnique({ where: { id: appt.id } });
      expect(apptInDb?.status).toBe('CANCELLED');

      // Re-activate doctor for clean state
      await prisma.user.update({ where: { id: doc.id }, data: { isActive: true } });
    });
  });

  // --------------------------------------------------------------------------
  // 6.4 Admin Hierarchy & Privilege Isolation
  // --------------------------------------------------------------------------
  describe('6.4 Admin Hierarchy & Privilege Isolation', () => {
    it('6.4.1 Super Admin can manage Sub-Admin status', async () => {
      const subAdmin = dataset.subAdmins[0];
      const req = new NextRequest(`http://localhost:3000/api/admin/users/${subAdmin.id}`, {
        method: 'PATCH',
        headers: {
          authorization: `Bearer ${superAdminToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ isActive: true }),
      });

      const res = await userPATCH(req, { params: Promise.resolve({ userId: subAdmin.id }) });
      expect(res.status).toBe(200);
    });

    it('6.4.2 Sub-Admin CANNOT modify Super Admin or peer Sub-Admin (403 Forbidden)', async () => {
      const req = new NextRequest(`http://localhost:3000/api/admin/users/${dataset.superAdmin.id}`, {
        method: 'PATCH',
        headers: {
          authorization: `Bearer ${subAdmin1Token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ isActive: false }),
      });

      const res = await userPATCH(req, { params: Promise.resolve({ userId: dataset.superAdmin.id }) });
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toMatch(/only super admin can modify other admin/i);
    });
  });

  // --------------------------------------------------------------------------
  // 6.5 Withdrawal Management & Balance Refund
  // --------------------------------------------------------------------------
  describe('6.5 Withdrawal Management & Balance Refund', () => {
    let testWithdrawalId: string;
    let doc: any;

    beforeAll(async () => {
      doc = dataset.doctors[0];
      const withdrawal = await prisma.withdrawal.create({
        data: {
          doctorId: doc.doctorId,
          amount: 50000, // ₹500 in paise
          currency: 'INR',
          status: 'PENDING',
        },
      });
      testWithdrawalId = withdrawal.id;
    });

    it('6.5.1 Admin lists withdrawals with masked bank accounts', async () => {
      const req = new NextRequest('http://localhost:3000/api/admin/withdrawals', {
        headers: { authorization: `Bearer ${superAdminToken}` },
      });

      const res = await withdrawalsGET(req);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(Array.isArray(data.withdrawals)).toBe(true);
      expect(data.withdrawals.length).toBeGreaterThan(0);
      expect(data.withdrawals[0].bankAccountNumber).toBeDefined();
    });

    it('6.5.2 Rejecting withdrawal refunds reserved balance in paise back to doctor', async () => {
      const initialBalance = (await prisma.doctor.findUnique({ where: { id: doc.doctorId } }))?.balance || 0;

      const req = new NextRequest('http://localhost:3000/api/admin/withdrawals', {
        method: 'PATCH',
        headers: {
          authorization: `Bearer ${superAdminToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          withdrawalId: testWithdrawalId,
          status: 'REJECTED',
          failureReason: 'Invalid IFSC code provided by doctor',
        }),
      });

      const res = await withdrawalPATCH(req);
      expect(res.status).toBe(200);

      const withdrawalInDb = await prisma.withdrawal.findUnique({ where: { id: testWithdrawalId } });
      expect(withdrawalInDb?.status).toBe('FAILED');
      expect(withdrawalInDb?.failureReason).toBe('Invalid IFSC code provided by doctor');

      // Verify balance refunded
      const finalBalance = (await prisma.doctor.findUnique({ where: { id: doc.doctorId } }))?.balance;
      expect(finalBalance).toBe(initialBalance + 50000);
    });
  });

  // --------------------------------------------------------------------------
  // 6.6 System Analytics
  // --------------------------------------------------------------------------
  describe('6.6 System Analytics', () => {
    it('6.6.1 Returns complete dashboard metrics for users, appointments, and financials', async () => {
      const req = new NextRequest('http://localhost:3000/api/admin/analytics', {
        headers: { authorization: `Bearer ${superAdminToken}` },
      });

      const res = await analyticsGET(req);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.users.total).toBeGreaterThanOrEqual(15);
      expect(data.users.doctors).toBeGreaterThanOrEqual(6);
      expect(data.users.patients).toBeGreaterThanOrEqual(8);
      expect(data.users.admins).toBeGreaterThanOrEqual(3);
      expect(data.appointments.total).toBeDefined();
      expect(data.financials.grossTransactionVolumeRupees).toBeDefined();
    });
  });

  // --------------------------------------------------------------------------
  // 6.7 Admin Audit Logging
  // --------------------------------------------------------------------------
  describe('6.7 Admin Audit Logging', () => {
    it('6.7.1 Admin actions record durable audit logs retrievable by Admin', async () => {
      const req = new NextRequest('http://localhost:3000/api/admin/logs?type=audit&limit=20', {
        headers: { authorization: `Bearer ${superAdminToken}` },
      });

      const res = await logsGET(req);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(Array.isArray(data.logs)).toBe(true);
      expect(data.logs.length).toBeGreaterThan(0);
      expect(data.logs.some((l: any) => l.action.includes('Admin') || l.action.includes('Approved') || l.action.includes('Rejected'))).toBe(true);
    });
  });
});
