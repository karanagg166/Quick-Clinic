import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/prisma';
import { createSlotHold, ownsHold, confirmSlotHold, cancelSlotHold, validateSlotHold } from '@/lib/booking';
import { seedPart2Dataset, cleanupPart2Dataset, Part2Dataset } from '@/__tests__/helpers/part2-dataset';

describe('PART 2B — Phase 5: Actual Redis Failure Injection & Fallback Suite', () => {
  let dataset: Part2Dataset;
  let doctor: any;
  let patient: any;
  const originalEnvUrl = process.env.UPSTASH_REDIS_REST_URL;
  const originalEnvToken = process.env.UPSTASH_REDIS_REST_TOKEN;

  beforeAll(async () => {
    dataset = await seedPart2Dataset('p2b_redis');
    doctor = dataset.doctors[0];
    patient = dataset.patients[0];
  }, 30000);

  afterAll(async () => {
    // Restore original env vars
    process.env.UPSTASH_REDIS_REST_URL = originalEnvUrl;
    process.env.UPSTASH_REDIS_REST_TOKEN = originalEnvToken;

    if (dataset) {
      await cleanupPart2Dataset(dataset);
    }
  });

  // Helper to create a fresh available slot
  async function createTestSlot(offsetDays = 40) {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + offsetDays);
    const slotEnd = new Date(futureDate);
    slotEnd.setMinutes(slotEnd.getMinutes() + 30);

    return prisma.slot.create({
      data: {
        doctorId: doctor.doctorId,
        date: futureDate,
        startTime: futureDate,
        endTime: slotEnd,
        status: 'AVAILABLE',
      },
    });
  }

  // --------------------------------------------------------------------------
  // Scenario A: Redis Available (or fallback active) -> Standard Hold Creation
  // --------------------------------------------------------------------------
  it('Scenario A: Standard Hold Creation creates durable state in PostgreSQL', async () => {
    const slot = await createTestSlot(41);

    const holdResult = await createSlotHold(slot.id, doctor.doctorId, patient.patientId);
    expect(holdResult.kind).toBe('ok');
    if (holdResult.kind === 'ok') {
      expect(holdResult.token).toBeDefined();

      const slotInDb = await prisma.slot.findUnique({ where: { id: slot.id } });
      expect(slotInDb?.status).toBe('HELD');
      expect(slotInDb?.heldByPatientId).toBe(patient.patientId);
      expect(slotInDb?.holdToken).toBe(holdResult.token);
    }
  });

  // --------------------------------------------------------------------------
  // Scenario B: Stop Redis before hold request -> Application falls back to DB
  // --------------------------------------------------------------------------
  it('Scenario B: Redis Outage / Unreachable before hold -> Falls back gracefully to PostgreSQL', async () => {
    // Simulate dead Redis endpoint
    process.env.UPSTASH_REDIS_REST_URL = 'http://127.0.0.1:59999/unreachable_redis';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'invalid_token_dead_redis';

    const slot = await createTestSlot(42);

    const holdResult = await createSlotHold(slot.id, doctor.doctorId, patient.patientId);
    expect(holdResult.kind).toBe('ok');

    if (holdResult.kind === 'ok') {
      expect(holdResult.token).toBeDefined();

      // Verify PostgreSQL holds authoritative state
      const slotInDb = await prisma.slot.findUnique({ where: { id: slot.id } });
      expect(slotInDb?.status).toBe('HELD');
      expect(slotInDb?.heldByPatientId).toBe(patient.patientId);
      expect(slotInDb?.holdToken).toBe(holdResult.token);

      // Verify conflict check still works with dead Redis (a second hold must fail)
      const secondHold = await createSlotHold(slot.id, doctor.doctorId, dataset.patients[1].patientId);
      expect(secondHold.kind).toBe('conflict');
    }
  });

  // --------------------------------------------------------------------------
  // Scenario C: Create hold, then stop Redis -> DB token continues proving ownership
  // --------------------------------------------------------------------------
  it('Scenario C: Create hold, crash Redis -> DB token proves ownership & allows confirmation', async () => {
    const slot = await createTestSlot(43);

    const holdResult = await createSlotHold(slot.id, doctor.doctorId, patient.patientId);
    expect(holdResult.kind).toBe('ok');

    if (holdResult.kind === 'ok') {
      const holdToken = holdResult.token;

      // Crash Redis now
      process.env.UPSTASH_REDIS_REST_URL = 'http://127.0.0.1:59998/crashed_redis';
      process.env.UPSTASH_REDIS_REST_TOKEN = 'crashed_token';

      // Verify ownership still proven via DB
      const isOwner = await ownsHold(slot.id, patient.patientId, holdToken);
      expect(isOwner).toBe(true);

      // Confirm appointment despite dead Redis
      const confirmedAppt = await confirmSlotHold({
        slotId: slot.id,
        doctorId: doctor.doctorId,
        patientId: patient.patientId,
        token: holdToken,
        paymentMethod: 'OFFLINE',
      });

      expect(confirmedAppt).toBeDefined();
      expect(confirmedAppt?.status).toBe('CONFIRMED');

      const slotAfter = await prisma.slot.findUnique({ where: { id: slot.id } });
      expect(slotAfter?.status).toBe('BOOKED');
    }
  });

  // --------------------------------------------------------------------------
  // Scenario D: Restart Redis -> System recovers without corrupting durable state
  // --------------------------------------------------------------------------
  it('Scenario D: Restart Redis -> System recovers cleanly and maintains hold consistency', async () => {
    // Restore environment
    process.env.UPSTASH_REDIS_REST_URL = originalEnvUrl;
    process.env.UPSTASH_REDIS_REST_TOKEN = originalEnvToken;

    const slot = await createTestSlot(44);

    const holdResult = await createSlotHold(slot.id, doctor.doctorId, patient.patientId);
    expect(holdResult.kind).toBe('ok');

    if (holdResult.kind === 'ok') {
      const validated = await validateSlotHold(slot.id, patient.patientId, holdResult.token);
      expect(validated).toBe(true);

      const cancelRes = await cancelSlotHold(slot.id, patient.patientId, holdResult.token);
      expect(cancelRes).toBe(true);

      const slotReleased = await prisma.slot.findUnique({ where: { id: slot.id } });
      expect(slotReleased?.status).toBe('AVAILABLE');
      expect(slotReleased?.heldByPatientId).toBeNull();
    }
  });

  // --------------------------------------------------------------------------
  // Scenario E: Simulated Unreachable Redis -> Request does not hang indefinitely
  // --------------------------------------------------------------------------
  it('Scenario E: Simulated Unreachable Redis -> Finishes within bounded time and falls back to PostgreSQL', async () => {
    process.env.UPSTASH_REDIS_REST_URL = 'http://10.255.255.1:65432/blackhole';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'blackhole_token';

    const slot = await createTestSlot(45);
    const start = performance.now();

    const holdResult = await createSlotHold(slot.id, doctor.doctorId, patient.patientId);
    const elapsed = performance.now() - start;

    expect(holdResult.kind).toBe('ok');
    // Bounded execution time (must not hang indefinitely)
    expect(elapsed).toBeLessThan(10000);

    // Clean up
    process.env.UPSTASH_REDIS_REST_URL = originalEnvUrl;
    process.env.UPSTASH_REDIS_REST_TOKEN = originalEnvToken;
  });
});
