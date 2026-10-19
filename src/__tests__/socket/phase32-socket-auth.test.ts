import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';
import { SocketServer } from '../../../socket-server/server';

const TEST_SECRET = 'test_jwt_secret_must_be_long_enough_for_hs256';

function createTestToken(payload: Record<string, any>, secret = TEST_SECRET) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const fullPayload = {
    exp: Math.floor(Date.now() / 1000) + 3600,
    ...payload,
  };
  const body = Buffer.from(JSON.stringify(fullPayload)).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

describe('Phase 32: Socket.IO Chat Authorization & Room Binding Test Suite', () => {
  let mockIo: any;
  let mockPrisma: any;
  let socketServer: SocketServer;

  beforeEach(() => {
    process.env.JWT_SECRET = TEST_SECRET;

    mockIo = {
      use: vi.fn(),
      on: vi.fn(),
      to: vi.fn().mockReturnThis(),
      emit: vi.fn(),
    };

    mockPrisma = {
      doctorPatientRelation: {
        findUnique: vi.fn(),
      },
      user: {
        findUnique: vi.fn(),
      },
      chatMessages: {
        findMany: vi.fn(),
        count: vi.fn(),
        create: vi.fn(),
      },
    };

    socketServer = new SocketServer(mockIo, mockPrisma, TEST_SECRET);
  });

  it('32.1 Doctor connects authenticated with token to Doctor 1 <-> Patient 1 relation', async () => {
    const authMiddleware = mockIo.use.mock.calls[0][0];
    const token = createTestToken({ id: 'doc_user_1', role: 'DOCTOR' });
    const mockSocket: any = {
      handshake: {
        auth: { token, relationId: 'rel_1' },
      },
    };
    const mockNext = vi.fn();

    mockPrisma.user.findUnique.mockResolvedValueOnce({
      id: 'doc_user_1',
      name: 'Dr. Gregory House',
      role: 'DOCTOR',
      isActive: true,
    });

    mockPrisma.doctorPatientRelation.findUnique.mockResolvedValueOnce({
      id: 'rel_1',
      doctor: { user: { id: 'doc_user_1', name: 'Dr. Gregory House' } },
      patient: { user: { id: 'patient_user_1', name: 'James Wilson' } },
    });

    await authMiddleware(mockSocket, mockNext);

    expect(mockNext).toHaveBeenCalledWith();
    expect(mockSocket.userId).toBe('doc_user_1');
    expect(mockSocket.userName).toBe('Dr. Gregory House');
    expect(mockSocket.userRole).toBe('DOCTOR');
    expect(mockSocket.relationId).toBe('rel_1');
  });

  it('32.2 Patient connects authenticated with token to Doctor 1 <-> Patient 1 relation', async () => {
    const authMiddleware = mockIo.use.mock.calls[0][0];
    const token = createTestToken({ id: 'patient_user_1', role: 'PATIENT' });
    const mockSocket: any = {
      handshake: {
        auth: { token, relationId: 'rel_1' },
      },
    };
    const mockNext = vi.fn();

    mockPrisma.user.findUnique.mockResolvedValueOnce({
      id: 'patient_user_1',
      name: 'James Wilson',
      role: 'PATIENT',
      isActive: true,
    });

    mockPrisma.doctorPatientRelation.findUnique.mockResolvedValueOnce({
      id: 'rel_1',
      doctor: { user: { id: 'doc_user_1', name: 'Dr. Gregory House' } },
      patient: { user: { id: 'patient_user_1', name: 'James Wilson' } },
    });

    await authMiddleware(mockSocket, mockNext);

    expect(mockNext).toHaveBeenCalledWith();
    expect(mockSocket.userId).toBe('patient_user_1');
    expect(mockSocket.userName).toBe('James Wilson');
    expect(mockSocket.userRole).toBe('PATIENT');
    expect(mockSocket.relationId).toBe('rel_1');
  });

  it('32.3 Rejects connection when token is missing (even if userId is provided)', async () => {
    const authMiddleware = mockIo.use.mock.calls[0][0];
    const mockSocket: any = {
      handshake: {
        auth: { userId: 'doc_user_1' },
      },
    };
    const mockNext = vi.fn();

    await authMiddleware(mockSocket, mockNext);

    expect(mockNext).toHaveBeenCalledWith(expect.any(Error));
    expect(mockNext.mock.calls[0][0].message).toMatch(/missing token/i);
  });

  it('32.4 Rejects connection when relationId is not found with Relation not found error', async () => {
    const authMiddleware = mockIo.use.mock.calls[0][0];
    const token = createTestToken({ id: 'doc_user_1', role: 'DOCTOR' });
    const mockSocket: any = {
      handshake: {
        auth: { token, relationId: 'non_existent_relation' },
      },
    };
    const mockNext = vi.fn();

    mockPrisma.user.findUnique.mockResolvedValueOnce({
      id: 'doc_user_1',
      name: 'Dr. Gregory House',
      role: 'DOCTOR',
      isActive: true,
    });

    mockPrisma.doctorPatientRelation.findUnique.mockResolvedValueOnce(null);

    await authMiddleware(mockSocket, mockNext);

    expect(mockNext).toHaveBeenCalledWith(expect.any(Error));
    expect(mockNext.mock.calls[0][0].message).toBe('Relation not found');
  });

  it('32.5 Patient 2 / unauthorized third party cannot join Doctor 1 <-> Patient 1 relation (Unauthorized)', async () => {
    const authMiddleware = mockIo.use.mock.calls[0][0];
    const token = createTestToken({ id: 'unauthorized_patient_2', role: 'PATIENT' });
    const mockSocket: any = {
      handshake: {
        auth: { token, relationId: 'rel_1' },
      },
    };
    const mockNext = vi.fn();

    mockPrisma.user.findUnique.mockResolvedValueOnce({
      id: 'unauthorized_patient_2',
      name: 'Intruder Patient',
      role: 'PATIENT',
      isActive: true,
    });

    mockPrisma.doctorPatientRelation.findUnique.mockResolvedValueOnce({
      id: 'rel_1',
      doctor: { user: { id: 'doc_user_1', name: 'Dr. Gregory House' } },
      patient: { user: { id: 'patient_user_1', name: 'James Wilson' } },
    });

    await authMiddleware(mockSocket, mockNext);

    expect(mockNext).toHaveBeenCalledWith(expect.any(Error));
    expect(mockNext.mock.calls[0][0].message).toBe('Unauthorized');
  });

  it('32.6 Doctor 2 cannot join Doctor 1 <-> Patient 1 relation (Unauthorized)', async () => {
    const authMiddleware = mockIo.use.mock.calls[0][0];
    const token = createTestToken({ id: 'doc_user_2_unrelated', role: 'DOCTOR' });
    const mockSocket: any = {
      handshake: {
        auth: { token, relationId: 'rel_1' },
      },
    };
    const mockNext = vi.fn();

    mockPrisma.user.findUnique.mockResolvedValueOnce({
      id: 'doc_user_2_unrelated',
      name: 'Dr. Cuddy',
      role: 'DOCTOR',
      isActive: true,
    });

    mockPrisma.doctorPatientRelation.findUnique.mockResolvedValueOnce({
      id: 'rel_1',
      doctor: { user: { id: 'doc_user_1', name: 'Dr. Gregory House' } },
      patient: { user: { id: 'patient_user_1', name: 'James Wilson' } },
    });

    await authMiddleware(mockSocket, mockNext);

    expect(mockNext).toHaveBeenCalledWith(expect.any(Error));
    expect(mockNext.mock.calls[0][0].message).toBe('Unauthorized');
  });

  it('32.7 Authenticates notification connection when valid token provided (without relationId)', async () => {
    const authMiddleware = mockIo.use.mock.calls[0][0];
    const token = createTestToken({ id: 'user_notification_1', role: 'PATIENT' });
    const mockSocket: any = {
      handshake: {
        auth: { token },
      },
    };
    const mockNext = vi.fn();

    mockPrisma.user.findUnique.mockResolvedValueOnce({
      id: 'user_notification_1',
      name: 'Notification Subscriber',
      role: 'PATIENT',
      isActive: true,
    });

    await authMiddleware(mockSocket, mockNext);

    expect(mockNext).toHaveBeenCalledWith();
    expect(mockSocket.userId).toBe('user_notification_1');
    expect(mockSocket.userName).toBe('Notification Subscriber');
    expect(mockSocket.userRole).toBe('PATIENT');
    expect(mockSocket.relationId).toBeUndefined();
  });

  it('32.8 Rejects notification connection when user does not exist with User not found error', async () => {
    const authMiddleware = mockIo.use.mock.calls[0][0];
    const token = createTestToken({ id: 'non_existent_user_99', role: 'PATIENT' });
    const mockSocket: any = {
      handshake: {
        auth: { token },
      },
    };
    const mockNext = vi.fn();

    mockPrisma.user.findUnique.mockResolvedValueOnce(null);

    await authMiddleware(mockSocket, mockNext);

    expect(mockNext).toHaveBeenCalledWith(expect.any(Error));
    expect(mockNext.mock.calls[0][0].message).toBe('User not found');
  });
});
