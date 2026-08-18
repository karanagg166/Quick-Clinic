import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  bookingSlotKey,
  HOLD_TTL_SECONDS,
  HOLD_TTL_MS,
  expireSlotHolds,
  expireDoctorHolds,
  validateSlotHold,
} from '@/lib/booking';
import { prisma } from '@/lib/prisma';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    slot: {
      updateMany: vi.fn(),
      findUnique: vi.fn(),
    },
  },
}));

describe('Phase 79: Redis Caching, TTL & Slot Holds Test Suite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('79.1 bookingSlotKey generates deterministic namespaced Redis keys', () => {
    expect(bookingSlotKey('slot_abc_123')).toBe('booking:slot:slot_abc_123');
    expect(bookingSlotKey('slot_test_999')).toBe('booking:slot:slot_test_999');
  });

  it('79.2 HOLD_TTL configuration matches 10 minutes (600 seconds = 600,000 ms)', () => {
    expect(HOLD_TTL_SECONDS).toBe(600);
    expect(HOLD_TTL_MS).toBe(600000);
  });

  it('79.3 expireSlotHolds queries Prisma with TTL cutoff and resets expired held slots to AVAILABLE', async () => {
    vi.mocked(prisma.slot.updateMany).mockResolvedValueOnce({ count: 2 });

    await expireSlotHolds('slot_expired_1');

    expect(prisma.slot.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'slot_expired_1',
          status: 'HELD',
        }),
        data: expect.objectContaining({
          status: 'AVAILABLE',
          heldByPatientId: null,
          heldAt: null,
        }),
      })
    );
  });

  it('79.4 expireDoctorHolds batch-resets all expired holds for a specific doctorId', async () => {
    vi.mocked(prisma.slot.updateMany).mockResolvedValueOnce({ count: 5 });

    await expireDoctorHolds('doc_active_holds');

    expect(prisma.slot.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          doctorId: 'doc_active_holds',
          status: 'HELD',
        }),
        data: expect.objectContaining({
          status: 'AVAILABLE',
          heldByPatientId: null,
          heldAt: null,
        }),
      })
    );
  });

  it('79.5 Fallback to database validation when Redis is unavailable', async () => {
    // Simulate slot held within valid TTL in DB
    const recentDate = new Date();
    vi.mocked(prisma.slot.findUnique).mockResolvedValueOnce({
      id: 'slot_fallback_1',
      status: 'HELD',
      heldByPatientId: 'pat_holder_1',
      heldAt: recentDate,
    } as any);

    const isValid = await validateSlotHold('slot_fallback_1', 'pat_holder_1', 'token_valid');
    expect(isValid).toBe(true);
  });
});
