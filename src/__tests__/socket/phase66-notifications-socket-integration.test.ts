import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SocketServer } from '../../../socket-server/server';

describe('Phase 66: Notifications & Socket Integration Test Suite', () => {
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
      notification: {
        findMany: vi.fn(),
        create: vi.fn(),
      },
    };

    socketServer = new SocketServer(mockIo, mockPrisma);
  });

  it('66.1 Handles notification client connection, joins user room, and emits notification_connected', () => {
    const connectionHandler = mockIo.on.mock.calls.find((call: any) => call[0] === 'connection')?.[1];
    expect(connectionHandler).toBeDefined();

    const mockSocket: any = {
      userId: 'user_target_1',
      userName: 'Alice Patient',
      userRole: 'PATIENT',
      relationId: undefined, // Notification connection has no relationId
      join: vi.fn(),
      emit: vi.fn(),
      on: vi.fn(),
      leave: vi.fn(),
    };

    connectionHandler(mockSocket);

    expect(mockSocket.join).toHaveBeenCalledWith('user_user_target_1');
    expect(mockSocket.emit).toHaveBeenCalledWith('notification_connected', {
      message: 'Connected to notifications',
      userId: 'user_target_1',
      userRole: 'PATIENT',
      userName: 'Alice Patient',
    });
  });

  it('66.2 sendNotificationToUser dispatches new_notification event directly to user channel', () => {
    const notificationPayload = {
      id: 'notif_100',
      message: 'Your appointment with Dr. House has been confirmed!',
      actionHref: '/appointments/appt_100',
      actionLabel: 'View Details',
      createdAt: new Date().toISOString(),
      isRead: false,
    };

    socketServer.sendNotificationToUser('user_target_1', notificationPayload);

    expect(mockIo.to).toHaveBeenCalledWith('user_user_target_1');
    expect(mockIo.emit).toHaveBeenCalledWith('new_notification', {
      notification: notificationPayload,
    });
  });

  it('66.3 sendAppointmentRequest dispatches new_appointment_request to doctor channel', () => {
    const appointmentPayload = {
      id: 'appt_200',
      patientName: 'Jane Doe',
      patientString: 'Jane Doe, 29, Female',
      gender: 'FEMALE',
      appointmentDate: '2026-10-15T10:00:00.000Z',
      appointmentTime: '10:00 AM',
      paymentMethod: 'ONLINE',
      reason: 'General Consultation',
    };

    socketServer.sendAppointmentRequest('doctor_user_1', appointmentPayload);

    expect(mockIo.to).toHaveBeenCalledWith('user_doctor_user_1');
    expect(mockIo.emit).toHaveBeenCalledWith('new_appointment_request', {
      appointment: appointmentPayload,
    });
  });

  it('66.4 Chat connection joins relation room and emits connection confirmation', () => {
    const connectionHandler = mockIo.on.mock.calls.find((call: any) => call[0] === 'connection')?.[1];

    const mockSocket: any = {
      userId: 'doc_user_1',
      userName: 'Dr. House',
      userRole: 'DOCTOR',
      relationId: 'rel_room_1',
      join: vi.fn(),
      emit: vi.fn(),
      on: vi.fn(),
      leave: vi.fn(),
    };

    connectionHandler(mockSocket);

    expect(mockSocket.join).toHaveBeenCalledWith('relation_rel_room_1');
    expect(mockSocket.emit).toHaveBeenCalledWith('connected', {
      message: 'Connected successfully',
      userId: 'doc_user_1',
      userName: 'Dr. House',
      userRole: 'DOCTOR',
    });
  });

  it('66.5 Handles disconnect cleanly and unregisters room subscriptions', () => {
    const connectionHandler = mockIo.on.mock.calls.find((call: any) => call[0] === 'connection')?.[1];

    let disconnectCallback: any;
    const mockSocket: any = {
      userId: 'user_target_1',
      userName: 'Alice Patient',
      userRole: 'PATIENT',
      relationId: undefined,
      join: vi.fn(),
      emit: vi.fn(),
      on: vi.fn((event: string, cb: any) => {
        if (event === 'disconnect') disconnectCallback = cb;
      }),
      leave: vi.fn(),
    };

    connectionHandler(mockSocket);
    expect(disconnectCallback).toBeDefined();

    disconnectCallback();
    expect(mockSocket.leave).toHaveBeenCalledWith('user_user_target_1');
  });
});
