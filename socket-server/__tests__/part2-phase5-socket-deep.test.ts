import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { createServer, Server as HttpServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { io as Client, Socket as ClientSocket } from 'socket.io-client';
import express from 'express';
import cors from 'cors';
import crypto from 'crypto';
import { SocketServer, verifySocketJWT } from '../server';

const TEST_SECRET = 'socket_deep_test_jwt_secret_key_32_characters_min';

function generateTestToken(payload: Record<string, any>, secret = TEST_SECRET): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signatureB64 = crypto
    .createHmac('sha256', secret)
    .update(`${headerB64}.${payloadB64}`)
    .digest('base64url');
  return `${headerB64}.${payloadB64}.${signatureB64}`;
}

describe('Phase 5 — Socket.IO & Real-Time Deep Testing Suite', () => {
  let app: express.Application;
  let httpServer: HttpServer;
  let ioServer: SocketIOServer;
  let socketServer: SocketServer;
  let port: number;

  const mockPrisma: any = {
    doctorPatientRelation: {
      findUnique: vi.fn(),
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
    process.env.JWT_SECRET = TEST_SECRET;

    app = express();
    app.use(cors());
    app.use(express.json());

    httpServer = createServer(app);
    ioServer = new SocketIOServer(httpServer, {
      cors: { origin: '*' },
    });

    socketServer = new SocketServer(ioServer, mockPrisma, TEST_SECRET);

    // Endpoints
    app.post('/api/notifications/broadcast', (req, res) => {
      const { userId, notification } = req.body;
      if (!userId || !notification?.id) {
        return res.status(400).json({ error: 'Invalid body' });
      }
      socketServer.sendNotificationToUser(userId, notification);
      return res.json({ success: true });
    });

    app.post('/api/notifications/new-appointment', (req, res) => {
      const { doctorUserId, notification, appointment } = req.body;
      socketServer.sendNotificationToUser(doctorUserId, notification);
      socketServer.sendAppointmentRequest(doctorUserId, appointment);
      return res.json({ success: true });
    });

    await new Promise<void>((resolve) => {
      httpServer.listen(0, () => {
        const addr = httpServer.address();
        port = typeof addr === 'object' && addr ? addr.port : 4002;
        resolve();
      });
    });
  });

  afterAll(async () => {
    if (ioServer) await ioServer.close();
    if (httpServer) await new Promise((resolve) => httpServer.close(resolve));
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // --------------------------------------------------------------------------
  // 5.1 Authentication & Connection Security
  // --------------------------------------------------------------------------
  describe('5.1 Authentication & Connection Security', () => {
    it('5.1.1 Rejects connection without JWT token', async () => {
      const client = Client(`http://localhost:${port}`, {
        transports: ['websocket'],
        reconnection: false,
      });

      const errorPromise = new Promise((resolve) => {
        client.on('connect_error', (err) => resolve(err.message));
      });

      const message = await errorPromise;
      expect(message).toMatch(/missing token/i);
      client.close();
    });

    it('5.1.2 Rejects connection with tampered JWT signature', async () => {
      const validToken = generateTestToken({ id: 'user-tampered', role: 'PATIENT' });
      const tamperedToken = validToken.slice(0, -5) + 'xxxxx';

      const client = Client(`http://localhost:${port}`, {
        auth: { token: tamperedToken },
        transports: ['websocket'],
        reconnection: false,
      });

      const errorPromise = new Promise((resolve) => {
        client.on('connect_error', (err) => resolve(err.message));
      });

      const message = await errorPromise;
      expect(message).toMatch(/invalid token signature/i);
      client.close();
    });

    it('5.1.3 Authenticates valid user notification connection and joins private user room', async () => {
      const userId = 'user-notif-1';
      mockPrisma.user.findUnique.mockResolvedValue({
        id: userId,
        name: 'Jane Doe',
        role: 'PATIENT',
      });

      const token = generateTestToken({ id: userId, role: 'PATIENT' });
      const client = Client(`http://localhost:${port}`, {
        auth: { token },
        transports: ['websocket'],
        reconnection: false,
      });

      const connectedPromise = new Promise((resolve) => {
        client.on('notification_connected', (data) => resolve(data));
      });

      const data: any = await connectedPromise;
      expect(data.userId).toBe(userId);
      expect(data.userName).toBe('Jane Doe');
      expect(data.userRole).toBe('PATIENT');
      client.close();
    });
  });

  // --------------------------------------------------------------------------
  // 5.2 Real-time Chat & IDOR Room Isolation
  // --------------------------------------------------------------------------
  describe('5.2 Real-time Chat & IDOR Room Isolation', () => {
    const relationId = 'rel-chat-123';
    const doctorUserId = 'doc-user-1';
    const patientUserId = 'pat-user-1';
    const unrelatedUserId = 'unrelated-user-9';

    beforeEach(() => {
      mockPrisma.doctorPatientRelation.findUnique.mockResolvedValue({
        id: relationId,
        doctorId: 'doc-rec-1',
        patientId: 'pat-rec-1',
        doctor: { user: { id: doctorUserId, name: 'Dr. House' } },
        patient: { user: { id: patientUserId, name: 'John Patient' } },
      });
    });

    it('5.2.1 IDOR Protection: Unrelated third-party user cannot join doctor-patient chat room', async () => {
      const token = generateTestToken({ id: unrelatedUserId, role: 'PATIENT' });
      const client = Client(`http://localhost:${port}`, {
        auth: { token, relationId },
        transports: ['websocket'],
        reconnection: false,
      });

      const errorPromise = new Promise((resolve) => {
        client.on('connect_error', (err) => resolve(err.message));
      });

      const message = await errorPromise;
      expect(message).toMatch(/unauthorized/i);
      client.close();
    });

    it('5.2.2 Doctor and Patient establish two-way real-time communication', async () => {
      const docToken = generateTestToken({ id: doctorUserId, role: 'DOCTOR' });
      const patToken = generateTestToken({ id: patientUserId, role: 'PATIENT' });

      mockPrisma.chatMessages.findMany.mockResolvedValue([]);
      mockPrisma.chatMessages.count.mockResolvedValue(0);
      mockPrisma.chatMessages.create.mockImplementation(({ data }: any) =>
        Promise.resolve({
          id: `msg-${Date.now()}`,
          text: data.text,
          senderId: data.senderId,
          doctorPatientRelationId: data.doctorPatientRelationId,
          sender: {
            id: data.senderId,
            name: data.senderId === doctorUserId ? 'Dr. House' : 'John Patient',
            role: data.senderId === doctorUserId ? 'DOCTOR' : 'PATIENT',
          },
          createdAt: new Date(),
        })
      );

      const docClient = Client(`http://localhost:${port}`, {
        auth: { token: docToken, relationId },
        transports: ['websocket'],
        reconnection: false,
      });

      const patClient = Client(`http://localhost:${port}`, {
        auth: { token: patToken, relationId },
        transports: ['websocket'],
        reconnection: false,
      });

      await Promise.all([
        new Promise((resolve) => docClient.on('connected', resolve)),
        new Promise((resolve) => patClient.on('connected', resolve)),
      ]);

      // Patient sends message to doctor
      const messagePromise = new Promise((resolve) => {
        docClient.on('new_message', (data: any) => resolve(data.message));
      });

      patClient.emit('send_message', { text: 'Hello doctor, I have a question about my medication.' });

      const received: any = await messagePromise;
      expect(received.text).toBe('Hello doctor, I have a question about my medication.');
      expect(received.senderId).toBe(patientUserId);
      expect(received.senderName).toBe('John Patient');

      // Verify message was durably inserted into database via Prisma
      expect(mockPrisma.chatMessages.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            doctorPatientRelationId: relationId,
            senderId: patientUserId,
            text: 'Hello doctor, I have a question about my medication.',
          }),
        })
      );

      docClient.close();
      patClient.close();
    });
  });

  // --------------------------------------------------------------------------
  // 5.3 Notifications & Appointment Broadcasts
  // --------------------------------------------------------------------------
  describe('5.3 Notifications & Appointment Broadcasts', () => {
    it('5.3.1 Delivers instant notification to targeted user room', async () => {
      const targetUserId = 'target-user-456';
      mockPrisma.user.findUnique.mockResolvedValue({
        id: targetUserId,
        name: 'Targeted User',
        role: 'PATIENT',
      });

      const token = generateTestToken({ id: targetUserId, role: 'PATIENT' });
      const client = Client(`http://localhost:${port}`, {
        auth: { token },
        transports: ['websocket'],
        reconnection: false,
      });

      await new Promise((resolve) => client.on('notification_connected', resolve));

      const notifPromise = new Promise((resolve) => {
        client.on('new_notification', (data) => resolve(data));
      });

      // Broadcast via server HTTP trigger
      await request(app)
        .post('/api/notifications/broadcast')
        .send({
          userId: targetUserId,
          notification: {
            id: 'notif-1',
            message: 'Your lab report is ready for download.',
            createdAt: new Date().toISOString(),
            isRead: false,
          },
        })
        .expect(200);

      const received: any = await notifPromise;
      expect(received.notification.message).toBe('Your lab report is ready for download.');
      client.close();
    });
  });
});
