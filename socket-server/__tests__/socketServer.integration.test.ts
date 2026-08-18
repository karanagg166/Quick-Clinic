import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { createServer, Server as HttpServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { io as Client, Socket as ClientSocket } from 'socket.io-client';
import express from 'express';
import cors from 'cors';
import crypto from 'crypto';
import { SocketServer } from '../server';

const TEST_SECRET = 'default_test_secret_for_jwt_auth_32_characters_minimum';

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
    process.env.JWT_SECRET = TEST_SECRET;

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

  describe('2. Cryptographic WebSocket Authentication & 8 Security Attack Scenarios', () => {
    it('Attack Case 6: rejects connection when token is omitted', async () => {
      const client = Client(`http://localhost:${port}`, {
        auth: {},
        transports: ['websocket'],
      });

      const err = await new Promise<Error>((resolve) => {
        client.on('connect_error', (e) => resolve(e));
      });

      expect(err.message).toBe('Missing token');
      client.disconnect();
    });

    it('Attack Case 4: rejects connection when JWT signature is forged/invalid', async () => {
      const forgedToken = generateTestToken({ id: 'user_fake', role: 'PATIENT' }, 'wrong_secret_key');
      const client = Client(`http://localhost:${port}`, {
        auth: { token: forgedToken },
        transports: ['websocket'],
      });

      const err = await new Promise<Error>((resolve) => {
        client.on('connect_error', (e) => resolve(e));
      });

      expect(err.message).toBe('Invalid token signature');
      client.disconnect();
    });

    it('Attack Case 5: rejects connection when JWT is expired', async () => {
      const expiredToken = generateTestToken({
        id: 'user_expired',
        role: 'PATIENT',
        exp: Math.floor(Date.now() / 1000) - 3600, // Expired 1 hr ago
      });

      const client = Client(`http://localhost:${port}`, {
        auth: { token: expiredToken },
        transports: ['websocket'],
      });

      const err = await new Promise<Error>((resolve) => {
        client.on('connect_error', (e) => resolve(e));
      });

      expect(err.message).toBe('Token expired');
      client.disconnect();
    });

    it('Attack Case 1: ignores client-supplied userId and derives identity strictly from cryptographic token', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'real_patient_id',
        name: 'Real Patient',
        role: 'PATIENT',
      });

      const token = generateTestToken({ id: 'real_patient_id', name: 'Real Patient', role: 'PATIENT' });
      const client = Client(`http://localhost:${port}`, {
        auth: {
          token,
          userId: 'victim_patient_id', // Client tries to claim someone else's ID
        },
        transports: ['websocket'],
      });

      const data = await new Promise<any>((resolve) => {
        client.on('notification_connected', (d) => resolve(d));
      });

      // Must be authenticated as the token owner, NOT the client-supplied victim ID
      expect(data.userId).toBe('real_patient_id');
      expect(data.userName).toBe('Real Patient');
      client.disconnect();
    });

    it('Attack Case 2: prevents privilege escalation when patient claims doctor role in handshake body', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'patient_alice',
        name: 'Alice',
        role: 'PATIENT',
      });

      const token = generateTestToken({ id: 'patient_alice', name: 'Alice', role: 'PATIENT' });
      const client = Client(`http://localhost:${port}`, {
        auth: {
          token,
          userRole: 'DOCTOR', // Client tries to escalate to DOCTOR
        },
        transports: ['websocket'],
      });

      const data = await new Promise<any>((resolve) => {
        client.on('notification_connected', (d) => resolve(d));
      });

      expect(data.userRole).toBe('PATIENT');
      client.disconnect();
    });

    it('Attack Case 3: rejects chat connection when user does not belong to relation (IDOR attempt)', async () => {
      mockPrisma.doctorPatientRelation.findUnique.mockResolvedValue({
        id: 'rel_private_1',
        doctor: { user: { id: 'doc_bob', name: 'Dr. Bob' } },
        patient: { user: { id: 'patient_charlie', name: 'Charlie' } },
      });

      const eavesdropperToken = generateTestToken({ id: 'attacker_eve', name: 'Eve', role: 'PATIENT' });
      const client = Client(`http://localhost:${port}`, {
        auth: { token: eavesdropperToken, relationId: 'rel_private_1' },
        transports: ['websocket'],
      });

      const err = await new Promise<Error>((resolve) => {
        client.on('connect_error', (e) => resolve(e));
      });

      expect(err.message).toBe('Unauthorized');
      client.disconnect();
    });

    it('rejects chat connection when relation does not exist', async () => {
      mockPrisma.doctorPatientRelation.findUnique.mockResolvedValue(null);

      const token = generateTestToken({ id: 'user_1', role: 'PATIENT' });
      const client = Client(`http://localhost:${port}`, {
        auth: { token, relationId: 'non_existent_rel' },
        transports: ['websocket'],
      });

      const err = await new Promise<Error>((resolve) => {
        client.on('connect_error', (e) => resolve(e));
      });

      expect(err.message).toBe('Relation not found');
      client.disconnect();
    });

    it('Attack Case 7: connects successfully for chat when valid token matches relation member', async () => {
      mockPrisma.doctorPatientRelation.findUnique.mockResolvedValue({
        id: 'rel_legit',
        doctor: { user: { id: 'doc_house', name: 'Dr. House' } },
        patient: { user: { id: 'pat_wilson', name: 'Wilson' } },
      });

      const token = generateTestToken({ id: 'doc_house', name: 'Dr. House', role: 'DOCTOR' });
      const client = Client(`http://localhost:${port}`, {
        auth: { token, relationId: 'rel_legit' },
        transports: ['websocket'],
      });

      const data = await new Promise<any>((resolve) => {
        client.on('connected', (d) => resolve(d));
      });

      expect(data.userId).toBe('doc_house');
      expect(data.userName).toBe('Dr. House');
      expect(data.userRole).toBe('DOCTOR');
      client.disconnect();
    });

    it('Attack Case 8: strictly isolates notification rooms so Patient A never receives Patient B events', async () => {
      mockPrisma.user.findUnique.mockImplementation(async ({ where }: any) => {
        if (where.id === 'patient_a') return { id: 'patient_a', name: 'Patient A', role: 'PATIENT' };
        if (where.id === 'patient_b') return { id: 'patient_b', name: 'Patient B', role: 'PATIENT' };
        return null;
      });

      const tokenA = generateTestToken({ id: 'patient_a', name: 'Patient A', role: 'PATIENT' });
      const clientA = Client(`http://localhost:${port}`, {
        auth: { token: tokenA },
        transports: ['websocket'],
      });

      await new Promise<void>((resolve) => {
        clientA.on('notification_connected', () => resolve());
      });

      let receivedSecretNotification = false;
      clientA.on('new_notification', (data) => {
        if (data.notification.id === 'secret_for_b') {
          receivedSecretNotification = true;
        }
      });

      // Send private notification intended strictly for Patient B
      socketServer.sendNotificationToUser('patient_b', {
        id: 'secret_for_b',
        message: 'Patient B private medical record',
        createdAt: new Date().toISOString(),
        isRead: false,
      });

      // Wait 100ms to confirm no leakage
      await new Promise((r) => setTimeout(r, 100));
      expect(receivedSecretNotification).toBe(false);

      clientA.disconnect();
    });
  });

  describe('3. Real-Time Event Delivery & Broadcasts', () => {
    let notificationClient: ClientSocket;
    const recipientToken = generateTestToken({ id: 'recipient_user_1', name: 'Notification Receiver', role: 'PATIENT' });

    beforeEach(async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'recipient_user_1',
        name: 'Notification Receiver',
        role: 'PATIENT',
      });

      notificationClient = Client(`http://localhost:${port}`, {
        auth: { token: recipientToken },
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
    const docToken = generateTestToken({ id: 'doc_chat', name: 'Dr. Chat', role: 'DOCTOR' });
    const patientToken = generateTestToken({ id: 'patient_chat', name: 'Patient Chat', role: 'PATIENT' });

    beforeEach(async () => {
      mockPrisma.doctorPatientRelation.findUnique.mockResolvedValue({
        id: 'rel_room_1',
        doctor: { user: { id: 'doc_chat', name: 'Dr. Chat' } },
        patient: { user: { id: 'patient_chat', name: 'Patient Chat' } },
      });

      doctorClient = Client(`http://localhost:${port}`, {
        auth: { token: docToken, relationId: 'rel_room_1' },
        transports: ['websocket'],
      });

      patientClient = Client(`http://localhost:${port}`, {
        auth: { token: patientToken, relationId: 'rel_room_1' },
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
