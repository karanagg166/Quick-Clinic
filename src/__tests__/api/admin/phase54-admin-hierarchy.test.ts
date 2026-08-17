import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as adminOnboardingPOST } from '@/app/api/admin/onboarding/route';
import { createToken } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { buildUserPayload } from '@/__tests__/helpers/factories';

describe('Phase 54: Admin Hierarchy & Onboarding Flow Test Suite', () => {
  let superAdminUserId: string;
  let superAdminToken: string;
  let superAdminEmail: string;

  let subAdminUserId: string;
  let subAdminToken: string;

  beforeAll(async () => {
    // 1. Create Super Admin User (role ADMIN)
    const superPayload = buildUserPayload({
      name: 'Super Manager Admin',
      email: `super_adm_${Date.now()}@quickclinic.test`,
      role: 'ADMIN',
    });
    superAdminEmail = superPayload.email;

    const superUser = await prisma.user.create({
      data: {
        name: superPayload.name,
        email: superPayload.email,
        phoneNo: superPayload.phoneNo,
        password: superPayload.password,
        age: 48,
        address: superPayload.address,
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
    superAdminUserId = superUser.id;
    superAdminToken = await createToken({ id: superAdminUserId, email: superUser.email, role: 'ADMIN', name: superUser.name });

    // 2. Create Sub-Admin User (role ADMIN, not onboarded yet)
    const subPayload = buildUserPayload({
      name: 'Junior Sub Admin',
      email: `sub_adm_${Date.now()}@quickclinic.test`,
      role: 'ADMIN',
    });
    const subUser = await prisma.user.create({
      data: {
        name: subPayload.name,
        email: subPayload.email,
        phoneNo: subPayload.phoneNo,
        password: subPayload.password,
        age: 32,
        address: subPayload.address,
        role: 'ADMIN',
        gender: 'FEMALE',
        location: {
          connectOrCreate: {
            where: { pincode: 121004 },
            create: { pincode: 121004, city: 'Faridabad', state: 'Haryana' },
          },
        },
      },
    });
    subAdminUserId = subUser.id;
    subAdminToken = await createToken({ id: subAdminUserId, email: subUser.email, role: 'ADMIN', name: subUser.name });
  });

  afterAll(async () => {
    try {
      await prisma.auditLog.deleteMany({ where: { userId: { in: [superAdminUserId, subAdminUserId] } } });
      await prisma.admin.deleteMany({ where: { userId: { in: [superAdminUserId, subAdminUserId] } } });
      await prisma.user.deleteMany({ where: { id: { in: [superAdminUserId, subAdminUserId] } } });
    } catch (e) {
      console.warn('Phase 54 cleanup warning:', e);
    }
  });

  it('54.1 Super Admin onboards with valid secret code and becomes active without manager', async () => {
    const req = new NextRequest('http://localhost:3000/api/admin/onboarding', {
      method: 'POST',
      headers: { Cookie: `token=${superAdminToken}` },
      body: JSON.stringify({
        userId: superAdminUserId,
        secretCode: process.env.SUPER_ADMIN_CODE || 'QUICK_CLINIC_SUPER_ADMIN',
        name: 'Super Manager Admin',
        phoneNo: '9811199999',
        gender: 'MALE',
        age: 48,
      }),
    });
    const res = await adminOnboardingPOST(req);
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.success).toBe(true);
    expect(data.isActive).toBe(true);
    expect(data.managerId).toBeNull();

    // Verify DB
    const adminRecord = await prisma.admin.findUnique({
      where: { userId: superAdminUserId },
    });
    expect(adminRecord).toBeDefined();
    expect(adminRecord?.managerId).toBeNull();
  });

  it('54.2 Sub-Admin onboarding rejects invalid manager email with 404', async () => {
    const req = new NextRequest('http://localhost:3000/api/admin/onboarding', {
      method: 'POST',
      headers: { Cookie: `token=${subAdminToken}` },
      body: JSON.stringify({
        userId: subAdminUserId,
        managerEmail: 'non_existent_mgr@quickclinic.test',
        name: 'Junior Sub Admin',
      }),
    });
    const res = await adminOnboardingPOST(req);
    expect(res.status).toBe(404);
  });

  it('54.3 Sub-Admin onboards by linking to Super Admin managerEmail', async () => {
    const req = new NextRequest('http://localhost:3000/api/admin/onboarding', {
      method: 'POST',
      headers: { Cookie: `token=${subAdminToken}` },
      body: JSON.stringify({
        userId: subAdminUserId,
        managerEmail: superAdminEmail,
        name: 'Junior Sub Admin',
        phoneNo: '9822288888',
        gender: 'FEMALE',
        age: 32,
      }),
    });
    const res = await adminOnboardingPOST(req);
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.success).toBe(true);
    expect(data.managerId).toBeDefined();

    // Verify Hierarchy in DB
    const superAdmin = await prisma.admin.findUnique({
      where: { userId: superAdminUserId },
      include: { subAdmins: true },
    });

    expect(superAdmin?.subAdmins.length).toBe(1);
    expect(superAdmin?.subAdmins[0].userId).toBe(subAdminUserId);
  });
});
