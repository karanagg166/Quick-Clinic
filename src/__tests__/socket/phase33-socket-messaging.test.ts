import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SocketServer } from '../../../socket-server/server';

describe('Phase 33: Socket.IO Messaging & Realtime Events Test Suite', () => {
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

  const setupMockConnection = (userId: string, userName: string, userRole: string, relationId?: string) => {
    const connectionHandler = mockIo.on.mock.calls.find((call: any[]) => call[0] === 'connection')[1];
    const registeredHandlers: Record<string, (...args: any[]) => any> = {};
    const mockSocket: any = {
      userId,
      userName,
      userRole,
      relationId,
      join: vi.fn(),
      leave: vi.fn(),
      emit: vi.fn(),
      to: vi.fn().mockReturnThis(),
      on: vi.fn((event: string, handler: (...args: any[]) => any) => {
        registeredHandlers[event] = handler;
      }),
    };

    connectionHandler(mockSocket);
    return { mockSocket, registeredHandlers };
  };

  it('33.1 Patient sends valid message: persists to DB and broadcasts new_message to relation room', async () => {
    const { mockSocket, registeredHandlers } = setupMockConnection(
      'patient_user_1',
      'Patient Alice',
      'PATIENT',
      'rel_100'
    );

    expect(mockSocket.join).toHaveBeenCalledWith('relation_rel_100');
    expect(mockSocket.emit).toHaveBeenCalledWith('connected', expect.objectContaining({
      userId: 'patient_user_1',
      userName: 'Patient Alice',
      userRole: 'PATIENT',
    }));

    const mockCreatedMessage = {
      id: 'msg_999',
      text: 'Good morning Dr. Smith',
      senderId: 'patient_user_1',
      doctorPatientRelationId: 'rel_100',
      createdAt: new Date('2026-08-20T10:00:00Z'),
      sender: {
        id: 'patient_user_1',
        name: 'Patient Alice',
        role: 'PATIENT',
      },
    };

    mockPrisma.chatMessages.create.mockResolvedValueOnce(mockCreatedMessage);

    await registeredHandlers['send_message']({ text: '  Good morning Dr. Smith  ' });

    expect(mockPrisma.chatMessages.create).toHaveBeenCalledWith({
      data: {
        text: 'Good morning Dr. Smith',
        senderId: 'patient_user_1',
        doctorPatientRelationId: 'rel_100',
      },
      include: {
        sender: {
          select: { id: true, name: true, role: true },
        },
      },
    });

    expect(mockIo.to).toHaveBeenCalledWith('relation_rel_100');
    expect(mockIo.emit).toHaveBeenCalledWith('new_message', {
      message: {
        id: 'msg_999',
        text: 'Good morning Dr. Smith',
        senderId: 'patient_user_1',
        senderName: 'Patient Alice',
        senderRole: 'PATIENT',
        createdAt: '2026-08-20T10:00:00.000Z',
      },
    });
  });

  it('33.2 Doctor replies with message: persists to DB and broadcasts to relation room', async () => {
    const { mockSocket, registeredHandlers } = setupMockConnection(
      'doc_user_1',
      'Dr. Bob',
      'DOCTOR',
      'rel_100'
    );

    const mockCreatedMessage = {
      id: 'msg_1000',
      text: 'Hello Alice, how is your fever today?',
      senderId: 'doc_user_1',
      doctorPatientRelationId: 'rel_100',
      createdAt: new Date('2026-08-20T10:02:00Z'),
      sender: {
        id: 'doc_user_1',
        name: 'Dr. Bob',
        role: 'DOCTOR',
      },
    };

    mockPrisma.chatMessages.create.mockResolvedValueOnce(mockCreatedMessage);

    await registeredHandlers['send_message']({ text: 'Hello Alice, how is your fever today?' });

    expect(mockPrisma.chatMessages.create).toHaveBeenCalledWith({
      data: {
        text: 'Hello Alice, how is your fever today?',
        senderId: 'doc_user_1',
        doctorPatientRelationId: 'rel_100',
      },
      include: {
        sender: {
          select: { id: true, name: true, role: true },
        },
      },
    });

    expect(mockIo.to).toHaveBeenCalledWith('relation_rel_100');
    expect(mockIo.emit).toHaveBeenCalledWith('new_message', expect.objectContaining({
      message: expect.objectContaining({
        id: 'msg_1000',
        senderRole: 'DOCTOR',
      }),
    }));
  });

  it('33.3 Rejects empty or whitespace-only messages without saving to DB', async () => {
    const { mockSocket, registeredHandlers } = setupMockConnection(
      'patient_user_1',
      'Patient Alice',
      'PATIENT',
      'rel_100'
    );

    await registeredHandlers['send_message']({ text: '   ' });

    expect(mockPrisma.chatMessages.create).not.toHaveBeenCalled();
    expect(mockSocket.emit).toHaveBeenCalledWith('error', {
      message: 'Message cannot be empty',
    });
  });

  it('33.4 Relays user_typing event to other room participants', async () => {
    const { mockSocket, registeredHandlers } = setupMockConnection(
      'doc_user_1',
      'Dr. Bob',
      'DOCTOR',
      'rel_100'
    );

    registeredHandlers['user_typing']();

    expect(mockSocket.to).toHaveBeenCalledWith('relation_rel_100');
    expect(mockSocket.emit).toHaveBeenCalledWith('user_typing', {
      userId: 'doc_user_1',
      userName: 'Dr. Bob',
      userRole: 'DOCTOR',
    });
  });

  it('33.5 Relays mark_as_read event to other room participants', async () => {
    const { mockSocket, registeredHandlers } = setupMockConnection(
      'patient_user_1',
      'Patient Alice',
      'PATIENT',
      'rel_100'
    );

    registeredHandlers['mark_as_read']({ messageId: 'msg_1000' });

    expect(mockSocket.to).toHaveBeenCalledWith('relation_rel_100');
    expect(mockSocket.emit).toHaveBeenCalledWith('message_read', {
      messageId: 'msg_1000',
      readBy: 'patient_user_1',
    });
  });

  it('33.6 Handles get_initial_messages and emits initial_messages with pagination', async () => {
    const { mockSocket, registeredHandlers } = setupMockConnection(
      'patient_user_1',
      'Patient Alice',
      'PATIENT',
      'rel_100'
    );

    mockPrisma.chatMessages.findMany.mockResolvedValueOnce([
      {
        id: 'msg_1',
        text: 'Initial message',
        senderId: 'patient_user_1',
        createdAt: new Date('2026-08-20T09:00:00Z'),
        sender: { id: 'patient_user_1', name: 'Patient Alice', role: 'PATIENT' },
      },
    ]);
    mockPrisma.chatMessages.count.mockResolvedValueOnce(1);

    await registeredHandlers['get_initial_messages']({ page: 1, limit: 10 });

    expect(mockPrisma.chatMessages.findMany).toHaveBeenCalledWith({
      where: { doctorPatientRelationId: 'rel_100' },
      include: {
        sender: {
          select: { id: true, name: true, role: true },
        },
      },
      orderBy: { createdAt: 'asc' },
      skip: 0,
      take: 10,
    });

    expect(mockSocket.emit).toHaveBeenCalledWith('initial_messages', {
      messages: [
        {
          id: 'msg_1',
          text: 'Initial message',
          senderId: 'patient_user_1',
          senderName: 'Patient Alice',
          senderRole: 'PATIENT',
          createdAt: '2026-08-20T09:00:00.000Z',
        },
      ],
      pagination: {
        page: 1,
        limit: 10,
        total: 1,
        hasMore: false,
      },
    });
  });

  it('33.7 Emits error event when DB fails during send_message', async () => {
    const { mockSocket, registeredHandlers } = setupMockConnection(
      'patient_user_1',
      'Patient Alice',
      'PATIENT',
      'rel_100'
    );

    mockPrisma.chatMessages.create.mockRejectedValueOnce(new Error('DB Connection Timeout'));

    await registeredHandlers['send_message']({ text: 'Hello' });

    expect(mockSocket.emit).toHaveBeenCalledWith('error', {
      message: 'Failed to send message',
    });
  });
});
