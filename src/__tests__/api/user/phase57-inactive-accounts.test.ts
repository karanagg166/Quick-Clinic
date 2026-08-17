import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/prisma';
import { buildUserPayload } from '@/__tests__/helpers/factories';

describe('Phase 57: Inactive Accounts & User State Integrity Test Suite', () => {
  let inactiveDocUserId: string;
  let inactiveDocId: string;
  let activeDocUserId: string;
  let activeDocId: string;

  beforeAll(async () => {
    // 1. Inactive Doctor
    const inactPayload = buildUserPayload({
      name: 'Dr. Inactive Physician',
      email: `doc_inact_${Date.now()}@quickclinic.test`,
      role: 'DOCTOR',
    });
    const inactUser = await prisma.user.create({
      data: {
        name: inactPayload.name,
        email: inactPayload.email,
        phoneNo: inactPayload.phoneNo,
        password: inactPayload.password,
        age: 50,
        address: inactPayload.address,
        role: 'DOCTOR',
        gender: 'MALE',
        isActive: false, // INACTIVE
        location: {
          connectOrCreate: {
            where: { pincode: 121004 },
            create: { pincode: 121004, city: 'Faridabad', state: 'Haryana' },
          },
        },
      },
    });
    inactiveDocUserId = inactUser.id;

    const dInact = await prisma.doctor.create({
      data: {
        userId: inactiveDocUserId,
        specialty: 'PSYCHIATRIST',
        fees: 1100,
        experience: 15,
      },
    });
    inactiveDocId = dInact.id;

    // 2. Active Doctor
    const actPayload = buildUserPayload({
      name: 'Dr. Active Physician',
      email: `doc_act_${Date.now()}@quickclinic.test`,
      role: 'DOCTOR',
    });
    const actUser = await prisma.user.create({
      data: {
        name: actPayload.name,
        email: actPayload.email,
        phoneNo: actPayload.phoneNo,
        password: actPayload.password,
        age: 42,
        address: actPayload.address,
        role: 'DOCTOR',
        gender: 'FEMALE',
        isActive: true, // ACTIVE
        location: {
          connectOrCreate: {
            where: { pincode: 121004 },
            create: { pincode: 121004, city: 'Faridabad', state: 'Haryana' },
          },
        },
      },
    });
    activeDocUserId = actUser.id;

    const dAct = await prisma.doctor.create({
      data: {
        userId: activeDocUserId,
        specialty: 'PSYCHIATRIST',
        fees: 1100,
        experience: 10,
      },
    });
    activeDocId = dAct.id;
  });

  afterAll(async () => {
    try {
      await prisma.doctor.deleteMany({ where: { id: { in: [inactiveDocId, activeDocId] } } });
      await prisma.user.deleteMany({ where: { id: { in: [inactiveDocUserId, activeDocUserId] } } });
    } catch (e) {
      console.warn('Phase 57 cleanup warning:', e);
    }
  });

  it('57.1 Inactive doctor user has isActive set to false in database', async () => {
    const user = await prisma.user.findUnique({
      where: { id: inactiveDocUserId },
      select: { isActive: true },
    });
    expect(user?.isActive).toBe(false);
  });

  it('57.2 Active doctor search query strictly excludes inactive doctors when filtering active users', async () => {
    const activeDoctors = await prisma.doctor.findMany({
      where: {
        specialty: 'PSYCHIATRIST',
        user: { isActive: true },
        id: { in: [inactiveDocId, activeDocId] },
      },
    });

    expect(activeDoctors.length).toBe(1);
    expect(activeDoctors[0].id).toBe(activeDocId);
  });
});
