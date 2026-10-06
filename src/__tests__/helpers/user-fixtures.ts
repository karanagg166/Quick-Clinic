import { prisma } from '@/lib/prisma';
import { buildUserPayload } from './factories';

// Each suite owns its users; shared canonical locations are connected without
// modifying or deleting them.
export async function createTestUser(overrides: Parameters<typeof buildUserPayload>[0] = {}) {
  const { city, state, pinCode, ...user } = buildUserPayload(overrides);
  return prisma.user.create({
    data: {
      ...user,
      location: {
        connectOrCreate: {
          where: { pincode: pinCode },
          create: { pincode: pinCode, city, state },
        },
      },
    },
  });
}

export async function cleanupTestUsers(ids: string[]) {
  if (!ids.length) return;
  await prisma.accessLog.deleteMany({
    where: { OR: [{ userId: { in: ids } }, { targetId: { in: ids } }] },
  });
  await prisma.auditLog.deleteMany({ where: { userId: { in: ids } } });
  // Patient/Doctor records cascade from these dedicated users.
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
}
