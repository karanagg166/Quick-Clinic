import { describe, it, expect, vi, beforeEach } from 'vitest';
import { persistChatMessage } from '@/lib/chat-service';

describe('Chat Idempotency, Retries, and Persistence Contract', () => {
  const relationId = 'rel_test_100';
  const doctorUserId = 'doc_test_1';
  const patientUserId = 'pat_test_1';
  const thirdPartyUserId = 'attacker_test_9';

  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      doctorPatientRelation: {
        findUnique: vi.fn().mockImplementation(async ({ where }) => {
          if (where.id === relationId) {
            return {
              id: relationId,
              doctorsUserId: doctorUserId,
              patientsUserId: patientUserId,
            };
          }
          return null;
        }),
      },
      chatMessages: {
        findFirst: vi.fn(),
        create: vi.fn(),
      },
    };
  });

  it('stores message successfully when authorized and valid', async () => {
    const clientMessageId = 'msg_client_001';
    mockPrisma.chatMessages.findFirst.mockResolvedValueOnce(null);
    mockPrisma.chatMessages.create.mockResolvedValueOnce({
      id: 'db_msg_001',
      clientMessageId,
      text: 'Hello Dr. Test',
      senderId: patientUserId,
      doctorPatientRelationId: relationId,
      createdAt: new Date('2026-10-19T10:00:00Z'),
      sender: { id: patientUserId, name: 'Pat Test', role: 'PATIENT' },
    });

    const result = await persistChatMessage({
      doctorPatientRelationId: relationId,
      senderId: patientUserId,
      text: 'Hello Dr. Test',
      clientMessageId,
      prismaClient: mockPrisma,
    });

    expect(result.statusCode).toBe(201);
    expect(result.success).toBe(true);
    expect(result.chat.id).toBe('db_msg_001');
    expect(result.chat.clientMessageId).toBe(clientMessageId);
  });

  it('returns existing canonical message on repeated request with same clientMessageId (lost ack scenario)', async () => {
    const clientMessageId = 'msg_client_lost_ack';
    const canonicalMessage = {
      id: 'db_canonical_123',
      clientMessageId,
      text: 'My message whose ack was lost',
      senderId: patientUserId,
      doctorPatientRelationId: relationId,
      createdAt: new Date('2026-10-19T10:05:00Z'),
      sender: { id: patientUserId, name: 'Pat Test', role: 'PATIENT' },
    };

    mockPrisma.chatMessages.findFirst.mockResolvedValueOnce(canonicalMessage);

    const result = await persistChatMessage({
      doctorPatientRelationId: relationId,
      senderId: patientUserId,
      text: 'My message whose ack was lost',
      clientMessageId,
      prismaClient: mockPrisma,
    });

    expect(result.statusCode).toBe(200);
    expect(result.success).toBe(true);
    expect(result.chat.id).toBe('db_canonical_123');
    expect(result.isDuplicate).toBe(true);
    expect(mockPrisma.chatMessages.create).not.toHaveBeenCalled();
  });

  it('handles concurrent race condition (P2002 conflict) by fetching canonical message', async () => {
    const clientMessageId = 'msg_client_race_condition';
    const canonicalMessage = {
      id: 'db_winner_777',
      clientMessageId,
      text: 'Concurrent message race',
      senderId: patientUserId,
      doctorPatientRelationId: relationId,
      createdAt: new Date('2026-10-19T10:10:00Z'),
      sender: { id: patientUserId, name: 'Pat Test', role: 'PATIENT' },
    };

    // Pre-check finds nothing due to concurrent execution
    mockPrisma.chatMessages.findFirst.mockResolvedValueOnce(null);
    // Create throws P2002 unique constraint violation
    const p2002Error: any = new Error('Unique constraint failed on the fields: (`clientMessageId`)');
    p2002Error.code = 'P2002';
    mockPrisma.chatMessages.create.mockRejectedValueOnce(p2002Error);
    // Conflict recovery fetch returns the winner's record
    mockPrisma.chatMessages.findFirst.mockResolvedValueOnce(canonicalMessage);

    const result = await persistChatMessage({
      doctorPatientRelationId: relationId,
      senderId: patientUserId,
      text: 'Concurrent message race',
      clientMessageId,
      prismaClient: mockPrisma,
    });

    expect(result.statusCode).toBe(200);
    expect(result.success).toBe(true);
    expect(result.chat.id).toBe('db_winner_777');
    expect(result.isDuplicate).toBe(true);
  });

  it('rejects conflicting reuse of clientMessageId with different text (409 Conflict)', async () => {
    const clientMessageId = 'msg_same_id';
    mockPrisma.chatMessages.findFirst.mockResolvedValueOnce({
      id: 'db_msg_original',
      clientMessageId,
      text: 'Original message text',
      senderId: patientUserId,
      doctorPatientRelationId: relationId,
      createdAt: new Date(),
      sender: { id: patientUserId, name: 'Pat Test', role: 'PATIENT' },
    });

    const result = await persistChatMessage({
      doctorPatientRelationId: relationId,
      senderId: patientUserId,
      text: 'Altered different text with same ID',
      clientMessageId,
      prismaClient: mockPrisma,
    });

    expect(result.statusCode).toBe(409);
    expect(result.error).toMatch(/conflicting reuse.*content/i);
  });

  it('rejects conflicting reuse of clientMessageId with different sender (409 Conflict)', async () => {
    const clientMessageId = 'msg_same_id_sender';
    mockPrisma.chatMessages.findFirst.mockResolvedValueOnce({
      id: 'db_msg_doc',
      clientMessageId,
      text: 'Doctor sent this first',
      senderId: doctorUserId,
      doctorPatientRelationId: relationId,
      createdAt: new Date(),
      sender: { id: doctorUserId, name: 'Dr. Test', role: 'DOCTOR' },
    });

    const result = await persistChatMessage({
      doctorPatientRelationId: relationId,
      senderId: patientUserId,
      text: 'Doctor sent this first',
      clientMessageId,
      prismaClient: mockPrisma,
    });

    expect(result.statusCode).toBe(409);
    expect(result.error).toMatch(/conflicting reuse.*sender/i);
  });

  it('rejects clientMessageId that belongs to another relation (403 Forbidden)', async () => {
    const clientMessageId = 'msg_other_rel';
    mockPrisma.chatMessages.findFirst.mockResolvedValueOnce({
      id: 'db_msg_secret',
      clientMessageId,
      text: 'Private conversation in relation 999',
      senderId: patientUserId,
      doctorPatientRelationId: 'rel_other_999',
      createdAt: new Date(),
      sender: { id: patientUserId, name: 'Pat Test', role: 'PATIENT' },
    });

    const result = await persistChatMessage({
      doctorPatientRelationId: relationId,
      senderId: patientUserId,
      text: 'Private conversation in relation 999',
      clientMessageId,
      prismaClient: mockPrisma,
    });

    expect(result.statusCode).toBe(403);
    expect(result.error).toMatch(/does not belong to this relation/i);
  });

  it('creates two distinct messages for deliberate identical-text sends with different IDs', async () => {
    mockPrisma.chatMessages.findFirst.mockResolvedValue(null);
    mockPrisma.chatMessages.create
      .mockResolvedValueOnce({
        id: 'msg_1',
        clientMessageId: 'id_1',
        text: 'Identical message text',
        senderId: patientUserId,
        doctorPatientRelationId: relationId,
        createdAt: new Date('2026-10-19T10:00:00Z'),
        sender: { id: patientUserId, name: 'Pat Test', role: 'PATIENT' },
      })
      .mockResolvedValueOnce({
        id: 'msg_2',
        clientMessageId: 'id_2',
        text: 'Identical message text',
        senderId: patientUserId,
        doctorPatientRelationId: relationId,
        createdAt: new Date('2026-10-19T10:00:01Z'),
        sender: { id: patientUserId, name: 'Pat Test', role: 'PATIENT' },
      });

    const res1 = await persistChatMessage({
      doctorPatientRelationId: relationId,
      senderId: patientUserId,
      text: 'Identical message text',
      clientMessageId: 'id_1',
      prismaClient: mockPrisma,
    });
    const res2 = await persistChatMessage({
      doctorPatientRelationId: relationId,
      senderId: patientUserId,
      text: 'Identical message text',
      clientMessageId: 'id_2',
      prismaClient: mockPrisma,
    });

    expect(res1.statusCode).toBe(201);
    expect(res2.statusCode).toBe(201);
    expect(res1.chat.id).toBe('msg_1');
    expect(res2.chat.id).toBe('msg_2');
    expect(res1.chat.id).not.toBe(res2.chat.id);
  });

  it('rejects unauthorized relation access by third-party user (403 Forbidden)', async () => {
    const result = await persistChatMessage({
      doctorPatientRelationId: relationId,
      senderId: thirdPartyUserId,
      text: 'Sneaky message into private relation',
      clientMessageId: 'idor_001',
      prismaClient: mockPrisma,
    });

    expect(result.statusCode).toBe(403);
    expect(result.error).toBe('Forbidden');
    expect(mockPrisma.chatMessages.create).not.toHaveBeenCalled();
  });

  it('rejects non-existent relation (404 Not Found)', async () => {
    const result = await persistChatMessage({
      doctorPatientRelationId: 'non_existent_relation',
      senderId: patientUserId,
      text: 'Hello',
      clientMessageId: 'non_existent_001',
      prismaClient: mockPrisma,
    });

    expect(result.statusCode).toBe(404);
    expect(result.error).toBe('Relation not found');
  });

  it('validates input types and returns 400 for malformed text or fields without 500 crashes', async () => {
    // Number instead of string
    const res1 = await persistChatMessage({
      doctorPatientRelationId: relationId,
      senderId: patientUserId,
      text: 12345 as any,
      prismaClient: mockPrisma,
    });
    expect(res1.statusCode).toBe(400);
    expect(res1.error).toMatch(/required/i);

    // Object instead of string
    const res2 = await persistChatMessage({
      doctorPatientRelationId: relationId,
      senderId: patientUserId,
      text: { malicious: 'object' } as any,
      prismaClient: mockPrisma,
    });
    expect(res2.statusCode).toBe(400);

    // Non-string clientMessageId
    const res3 = await persistChatMessage({
      doctorPatientRelationId: relationId,
      senderId: patientUserId,
      text: 'Valid text',
      clientMessageId: 98765 as any,
      prismaClient: mockPrisma,
    });
    expect(res3.statusCode).toBe(400);
    expect(res3.error).toMatch(/clientMessageId must be a string/i);
  });

  it('enforces maximum character length of 5000 characters (400 Bad Request)', async () => {
    const oversizedText = 'A'.repeat(5001);
    const result = await persistChatMessage({
      doctorPatientRelationId: relationId,
      senderId: patientUserId,
      text: oversizedText,
      prismaClient: mockPrisma,
    });

    expect(result.statusCode).toBe(400);
    expect(result.error).toMatch(/exceeds maximum length/i);
  });
});
