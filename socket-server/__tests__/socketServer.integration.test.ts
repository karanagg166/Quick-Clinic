import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { createServer, Server as HttpServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { io as Client, Socket as ClientSocket } from 'socket.io-client';
import express from 'express';
import cors from 'cors';
import { SocketServer } from '../server';

describe('Socket Server - Comprehensive HTTP & WebSocket Integration Suite', () => {
  let app: express.Application;
  let httpServer: HttpServer;
  let ioServer: SocketIOServer;
  let socketServer: SocketServer;
  let port: number;

  const mockPrisma: any = {
    doctorPatientRelation: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
    notification: {
      create: vi.fn(),
    },
    chatMessages: {
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
    },
  };

  beforeAll(async () => {
    app = express();
    app.use(cors());
    app.use(express.json());

    httpServer = createServer(app);
    ioServer = new SocketIOServer(httpServer, {
      cors: { origin: '*' },
    });

    socketServer = new SocketServer(ioServer, mockPrisma);

    // Mount HTTP endpoints
    app.get('/', (req, res) => {
      res.json({ status: 'ok', service: 'quick-clinic-socket-server' });
    });

    app.get('/health', (req, res) => {
      res.json({ status: 'ok', timestamp: new Date().toISOString() });
    });

    app.post('/api/notifications/broadcast', (req, res) => {
      const { userId, notification } = req.body;
      if (!userId || !notification?.id || !notification.message) {
        return res.status(400).json({ error: 'userId and a notification are required' });
      }
      socketServer.sendNotificationToUser(userId, notification);
      return res.json({ success: true });
    });

    app.post('/api/notifications/new-appointment', (req, res) => {
      const { doctorUserId, notification, appointment } = req.body;
      if (!doctorUserId || !notification?.id || !appointment?.id) {
        return res.status(400).json({ error: 'doctorUserId, notification, and appointment are required' });
      }
      socketServer.sendNotificationToUser(doctorUserId, notification);
      socketServer.sendAppointmentRequest(doctorUserId, appointment);
      return res.json({ success: true });
    });

    await new Promise<void>((resolve) => {
      httpServer.listen(0, () => {
        const addr = httpServer.address();
        port = typeof addr === 'object' && addr ? addr.port : 4001;
        resolve();
      });
    });
  });

  afterAll(async () => {
    ioServer.close();
    await new Promise<void>((resolve) => {
      httpServer.close(() => resolve());
    });
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('1. HTTP API Route Testing (Supertest)', () => {
    it('GET / returns service status ok', async () => {
      const res = await request(app).get('/');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: 'ok', service: 'quick-clinic-socket-server' });
    });

    it('GET /health returns health status ok with ISO timestamp', async () => {
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.timestamp).toBeDefined();
    });

    it('POST /api/notifications/broadcast validates payload and returns 400 for missing fields', async () => {
      const res = await request(app)
        .post('/api/notifications/broadcast')
        .send({ userId: 'u1' });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('userId and a notification are required');
    });

    it('POST /api/notifications/broadcast broadcasts notification successfully with 200', async () => {
      const res = await request(app)
        .post('/api/notifications/broadcast')
        .send({
          userId: 'user_target_123',
          notification: {
            id: 'notif_1',
            message: 'Appointment confirmed!',
            createdAt: new Date().toISOString(),
            isRead: false,
          },
        });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('POST /api/notifications/new-appointment returns 400 for invalid payload', async () => {
      const res = await request(app)
        .post('/api/notifications/new-appointment')
        .send({ doctorUserId: 'doc_1' });
      expect(res.status).toBe(400);
    });

    it('POST /api/notifications/new-appointment broadcasts appointment request with 200', async () => {
      const res = await request(app)
        .post('/api/notifications/new-appointment')
        .send({
          doctorUserId: 'doc_101',
          notification: {
            id: 'notif_2',
            message: 'New Appointment booked',
            createdAt: new Date().toISOString(),
            isRead: false,
          },
          appointment: {
            id: 'appt_101',
            patientName: 'John Doe',
            patientString: 'john@example.com',
            gender: 'MALE',
            appointmentDate: '2026-08-20',
            appointmentTime: '10:00 AM',
            status: 'CONFIRMED',
            city: 'Delhi',
            age: 30,
            paymentMethod: 'OFFLINE',
          },
        });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe('2. Real WebSocket Client Connection & Authentication (socket.io-client)', () => {
    it('rejects connection when userId is omitted', async () => {
      const client = Client(`http://localhost:${port}`, {
        auth: {},
        transports: ['websocket'],
      });

      const err = await new Promise<Error>((resolve) => {
        client.on('connect_error', (e) => resolve(e));
      });

      expect(err.message).toBe('Missing userId');
      client.disconnect();
    });

    it('rejects chat connection when relationId does not exist', async () => {
      mockPrisma.doctorPatientRelation.findUnique.mockResolvedValue(null);

      const client = Client(`http://localhost:${port}`, {
        auth: { userId: 'user_1', relationId: 'non_existent_rel' },
        transports: ['websocket'],
      });

      const err = await new Promise<Error>((resolve) => {
        client.on('connect_error', (e) => resolve(e));
      });

      expect(err.message).toBe('Relation not found');
      client.disconnect();
    });

    it('rejects chat connection when user is neither doctor nor patient in relation', async () => {
      mockPrisma.doctorPatientRelation.findUnique.mockResolvedValue({
        id: 'rel_1',
        doctor: { user: { id: 'doc_real', name: 'Dr. Real' } },
        patient: { user: { id: 'patient_real', name: 'Patient Real' } },
      });

      const client = Client(`http://localhost:${port}`, {
        auth: { userId: 'attacker_user_999', relationId: 'rel_1' },
        transports: ['websocket'],
      });

      const err = await new Promise<Error>((resolve) => {
        client.on('connect_error', (e) => resolve(e));
      });

      expect(err.message).toBe('Unauthorized');
      client.disconnect();
    });

    it('connects successfully for notifications when valid userId is provided', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user_valid_1',
        name: 'Jane Doe',
        role: 'PATIENT',
      });

      const client = Client(`http://localhost:${port}`, {
        auth: { userId: 'user_valid_1' },
        transports: ['websocket'],
      });

      const data = await new Promise<any>((resolve) => {
        client.on('notification_connected', (d) => resolve(d));
      });

      expect(data.userId).toBe('user_valid_1');
      expect(data.userName).toBe('Jane Doe');
      expect(data.userRole).toBe('PATIENT');
      client.disconnect();
    });

    it('connects successfully for chat when user belongs to relation', async () => {
      mockPrisma.doctorPatientRelation.findUnique.mockResolvedValue({
        id: 'rel_100',
        doctor: { user: { id: 'doc_100', name: 'Dr. House' } },
        patient: { user: { id: 'pat_100', name: 'Wilson' } },
      });

      const client = Client(`http://localhost:${port}`, {
        auth: { userId: 'doc_100', relationId: 'rel_100' },
        transports: ['websocket'],
      });

      const data = await new Promise<any>((resolve) => {
        client.on('connected', (d) => resolve(d));
      });

      expect(data.userId).toBe('doc_100');
      expect(data.userName).toBe('Dr. House');
      expect(data.userRole).toBe('DOCTOR');
      client.disconnect();
    });
  });

  describe('3. Real-Time Event Delivery & Broadcasts', () => {
    let notificationClient: ClientSocket;

    beforeEach(async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'recipient_user_1',
        name: 'Notification Receiver',
        role: 'PATIENT',
      });

      notificationClient = Client(`http://localhost:${port}`, {
        auth: { userId: 'recipient_user_1' },
        transports: ['websocket'],
      });

      await new Promise<void>((resolve) => {
        notificationClient.on('notification_connected', () => resolve());
      });
    });

    afterEach(() => {
      if (notificationClient.connected) {
        notificationClient.disconnect();
      }
    });

    it('receives new_notification event in real-time when broadcast endpoint is invoked', async () => {
      const notifPromise = new Promise<any>((resolve) => {
        notificationClient.on('new_notification', (data) => resolve(data));
      });

      // Send via HTTP endpoint
      await request(app)
        .post('/api/notifications/broadcast')
        .send({
          userId: 'recipient_user_1',
          notification: {
            id: 'n_live_99',
            message: 'Your lab report is ready!',
            createdAt: new Date().toISOString(),
            isRead: false,
          },
        });

      const payload = await notifPromise;
      expect(payload.notification.id).toBe('n_live_99');
      expect(payload.notification.message).toBe('Your lab report is ready!');
    });

    it('receives appointment_status_update event in real-time', async () => {
      const statusPromise = new Promise<any>((resolve) => {
        notificationClient.on('appointment_status_update', (data) => resolve(data));
      });

      socketServer.sendAppointmentStatusUpdate('recipient_user_1', {
        id: 'appt_555',
        status: 'CONFIRMED',
        appointmentDate: '2026-08-22',
        appointmentTime: '11:00 AM',
        doctorName: 'Dr. Strange',
      });

      const payload = await statusPromise;
      expect(payload.appointment.id).toBe('appt_555');
      expect(payload.appointment.status).toBe('CONFIRMED');
      expect(payload.appointment.doctorName).toBe('Dr. Strange');
    });
  });

  describe('4. Bi-Directional Chat & Typing Flow', () => {
    let doctorClient: ClientSocket;
    let patientClient: ClientSocket;

    beforeEach(async () => {
      mockPrisma.doctorPatientRelation.findUnique.mockResolvedValue({
        id: 'rel_room_1',
        doctor: { user: { id: 'doc_chat', name: 'Dr. Chat' } },
        patient: { user: { id: 'patient_chat', name: 'Patient Chat' } },
      });

      doctorClient = Client(`http://localhost:${port}`, {
        auth: { userId: 'doc_chat', relationId: 'rel_room_1' },
        transports: ['websocket'],
      });

      patientClient = Client(`http://localhost:${port}`, {
        auth: { userId: 'patient_chat', relationId: 'rel_room_1' },
        transports: ['websocket'],
      });

      await Promise.all([
        new Promise<void>((resolve) => doctorClient.on('connected', () => resolve())),
        new Promise<void>((resolve) => patientClient.on('connected', () => resolve())),
      ]);
    });

    afterEach(() => {
      if (doctorClient.connected) doctorClient.disconnect();
      if (patientClient.connected) patientClient.disconnect();
    });

    it('relays typing event to the other participant in the relation room', async () => {
      const typingPromise = new Promise<any>((resolve) => {
        patientClient.on('user_typing', (d) => resolve(d));
      });

      // Small delay to ensure socket.io room subscription is fully active
      await new Promise((r) => setTimeout(r, 50));
      doctorClient.emit('user_typing');

      const typingData = await typingPromise;
      expect(typingData.userId).toBe('doc_chat');
      expect(typingData.userName).toBe('Dr. Chat');
      expect(typingData.userRole).toBe('DOCTOR');
    });

    it('persists and broadcasts send_message to recipient', async () => {
      const mockCreatedMessage = {
        id: 'msg_123',
        text: 'Hello, how are you feeling today?',
        senderId: 'doc_chat',
        doctorPatientRelationId: 'rel_room_1',
        createdAt: new Date(),
        sender: { id: 'doc_chat', name: 'Dr. Chat', role: 'DOCTOR' },
      };

      mockPrisma.chatMessages.create.mockResolvedValue(mockCreatedMessage);

      const messageReceivedPromise = new Promise<any>((resolve) => {
        patientClient.on('new_message', (d) => resolve(d));
      });

      await new Promise((r) => setTimeout(r, 50));
      doctorClient.emit('send_message', {
        text: 'Hello, how are you feeling today?',
      });

      const received = await messageReceivedPromise;
      expect(received.message.id).toBe('msg_123');
      expect(received.message.text).toBe('Hello, how are you feeling today?');
      expect(mockPrisma.chatMessages.create).toHaveBeenCalledWith({
        data: {
          doctorPatientRelationId: 'rel_room_1',
          senderId: 'doc_chat',
          text: 'Hello, how are you feeling today?',
        },
        include: {
          sender: {
            select: { id: true, name: true, role: true },
          },
        },
      });
    });
  });
});
