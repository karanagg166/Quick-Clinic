import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SocketServer } from '../../../socket-server/server';

describe('Phase 32: Socket.IO Chat Authorization & Room Binding Test Suite', () => {
  let mockIo: any;
  let mockPrisma: any;
  let socketServer: SocketServer;

  beforeEach(() => {
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

    socketServer = new SocketServer(mockIo, mockPrisma);
  });

  it('32.1 Doctor connects authenticated to Doctor 1 <-> Patient 1 relation', async () => {
    const authMiddleware = mockIo.use.mock.calls[0][0];
    const mockSocket: any = {
      handshake: {
        auth: { userId: 'doc_user_1', relationId: 'rel_1' },
      },
    };
    const mockNext = vi.fn();

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

  it('32.2 Patient connects authenticated to Doctor 1 <-> Patient 1 relation', async () => {
    const authMiddleware = mockIo.use.mock.calls[0][0];
    const mockSocket: any = {
      handshake: {
        auth: { userId: 'patient_user_1', relationId: 'rel_1' },
      },
    };
    const mockNext = vi.fn();

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

  it('32.3 Rejects connection when userId is missing with Missing userId error', async () => {
    const authMiddleware = mockIo.use.mock.calls[0][0];
    const mockSocket: any = {
      handshake: {
        auth: {},
      },
    };
    const mockNext = vi.fn();

    await authMiddleware(mockSocket, mockNext);

    expect(mockNext).toHaveBeenCalledWith(expect.any(Error));
    expect(mockNext.mock.calls[0][0].message).toMatch(/missing (token|userId)/i);
  });

  it('32.4 Rejects connection when relationId is not found with Relation not found error', async () => {
    const authMiddleware = mockIo.use.mock.calls[0][0];
    const mockSocket: any = {
      handshake: {
        auth: { userId: 'doc_user_1', relationId: 'non_existent_relation' },
      },
    };
    const mockNext = vi.fn();

    mockPrisma.doctorPatientRelation.findUnique.mockResolvedValueOnce(null);

    await authMiddleware(mockSocket, mockNext);

    expect(mockNext).toHaveBeenCalledWith(expect.any(Error));
    expect(mockNext.mock.calls[0][0].message).toBe('Relation not found');
  });

  it('32.5 Patient 2 / unauthorized third party cannot join Doctor 1 <-> Patient 1 relation (Unauthorized)', async () => {
    const authMiddleware = mockIo.use.mock.calls[0][0];
    const mockSocket: any = {
      handshake: {
        auth: { userId: 'unauthorized_patient_2', relationId: 'rel_1' },
      },
    };
    const mockNext = vi.fn();

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
    const mockSocket: any = {
      handshake: {
        auth: { userId: 'doc_user_2_unrelated', relationId: 'rel_1' },
      },
    };
    const mockNext = vi.fn();

    mockPrisma.doctorPatientRelation.findUnique.mockResolvedValueOnce({
      id: 'rel_1',
      doctor: { user: { id: 'doc_user_1', name: 'Dr. Gregory House' } },
      patient: { user: { id: 'patient_user_1', name: 'James Wilson' } },
    });

    await authMiddleware(mockSocket, mockNext);

    expect(mockNext).toHaveBeenCalledWith(expect.any(Error));
    expect(mockNext.mock.calls[0][0].message).toBe('Unauthorized');
  });

  it('32.7 Authenticates notification connection when valid userId provided (without relationId)', async () => {
    const authMiddleware = mockIo.use.mock.calls[0][0];
    const mockSocket: any = {
      handshake: {
        auth: { userId: 'user_notification_1' },
      },
    };
    const mockNext = vi.fn();

    mockPrisma.user.findUnique.mockResolvedValueOnce({
      id: 'user_notification_1',
      name: 'Notification Subscriber',
      role: 'PATIENT',
    });

    await authMiddleware(mockSocket, mockNext);

    expect(mockNext).toHaveBeenCalledWith();
    expect(mockSocket.userId).toBe('user_notification_1');
    expect(mockSocket.userName).toBe('Notification Subscriber');
    expect(mockSocket.userRole).toBe('PATIENT');
    expect(mockSocket.relationId).toBeUndefined();
  });

  it('32.8 Rejects notification connection when userId does not exist with User not found error', async () => {
    const authMiddleware = mockIo.use.mock.calls[0][0];
    const mockSocket: any = {
      handshake: {
        auth: { userId: 'non_existent_user_99' },
      },
    };
    const mockNext = vi.fn();

    mockPrisma.user.findUnique.mockResolvedValueOnce(null);

    await authMiddleware(mockSocket, mockNext);

    expect(mockNext).toHaveBeenCalledWith(expect.any(Error));
    expect(mockNext.mock.calls[0][0].message).toBe('User not found');
  });
});
