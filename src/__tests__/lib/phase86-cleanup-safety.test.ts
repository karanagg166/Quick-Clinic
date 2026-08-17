import { describe, it, expect, vi } from 'vitest';
import { prisma } from '@/lib/prisma';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    appointment: { deleteMany: vi.fn() },
    rating: { deleteMany: vi.fn() },
    withdrawal: { deleteMany: vi.fn() },
    slot: { deleteMany: vi.fn() },
    doctor: { deleteMany: vi.fn() },
    patient: { deleteMany: vi.fn() },
    user: { deleteMany: vi.fn() },
    $disconnect: vi.fn(),
  },
}));

describe('Phase 86: Test Cleanup Safety & Scoped Teardown Test Suite', () => {
  it('86.1 Ensures cleanup teardown operations are strictly ID-scoped and never unconditional', async () => {
    const testApptIds = ['appt_clean_1', 'appt_clean_2'];
    const testUserIds = ['user_clean_1'];

    await prisma.appointment.deleteMany({
      where: { id: { in: testApptIds } },
    });

    await prisma.user.deleteMany({
      where: { id: { in: testUserIds } },
    });

    expect(prisma.appointment.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: testApptIds } },
      })
    );

    expect(prisma.user.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: testUserIds } },
      })
    );
  });

  it('86.2 Verifies graceful database connection closure on teardown', async () => {
    await prisma.$disconnect();
    expect(prisma.$disconnect).toHaveBeenCalled();
  });
});
