import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { createServer, Server as HttpServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { io as Client, Socket as ClientSocket } from 'socket.io-client';
import express from 'express';
import cors from 'cors';
import crypto from 'crypto';
import { SocketServer } from '../server';

const TEST_SECRET = 'socket_load_verification_secret_32_characters_key';

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

export interface SocketLoadResult {
  clientCount: number;
  connectionAttempts: number;
  successfulConnections: number;
  failedConnections: number;
  avgConnectionLatencyMs: number;
  p95ConnectionLatencyMs: number;
  totalMessagesSent: number;
  totalMessagesReceived: number;
  avgDeliveryLatencyMs: number;
  p95DeliveryLatencyMs: number;
  crossRoomLeakageCount: number;
  duplicateDeliveryCount: number;
  disconnectCount: number;
  reconnectSuccessCount: number;
}

describe('PART 2B — Real Socket.IO High-Scale Load Verification', () => {
  let app: express.Application;
  let httpServer: HttpServer;
  let ioServer: SocketIOServer;
  let socketServer: SocketServer;
  let port: number;

  const validRelations = new Map<string, { doctorId: string; patientId: string }>();

  const mockPrisma: any = {
    doctorPatientRelation: {
      findUnique: vi.fn().mockImplementation(async ({ where }) => {
        const id = where.id;
        const rel = validRelations.get(id);
        if (rel) {
          return {
            id,
            doctorsUserId: rel.doctorId,
            patientsUserId: rel.patientId,
            doctor: { userId: rel.doctorId },
            patient: { userId: rel.patientId },
          };
        }
        return null;
      }),
    },
    user: {
      findUnique: vi.fn().mockImplementation(async ({ where }) => {
        return { id: where.id, name: `User_${where.id}`, role: 'PATIENT' };
      }),
    },
    chatMessages: {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      create: vi.fn().mockImplementation(async ({ data }) => ({
        id: `msg_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        ...data,
        createdAt: new Date(),
      })),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    notification: {
      create: vi.fn().mockResolvedValue({ id: 'notif_1' }),
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
      transports: ['websocket'],
    });

    socketServer = new SocketServer(ioServer, mockPrisma, TEST_SECRET);

    await new Promise<void>((resolve) => {
      httpServer.listen(0, () => {
        const addr = httpServer.address();
        port = typeof addr === 'object' && addr ? addr.port : 4005;
        resolve();
      });
    });
  });

  afterAll(async () => {
    if (ioServer) await ioServer.close();
    if (httpServer) await new Promise((resolve) => httpServer.close(resolve));
  });

  async function runSocketScaleScenario(numClients: number): Promise<SocketLoadResult> {
    const numRooms = numClients / 2;
    const clients: { socket: ClientSocket; role: 'DOCTOR' | 'PATIENT'; userId: string; relationId: string; connLatency: number }[] = [];
    const connLatencies: number[] = [];
    let successfulConnections = 0;
    let failedConnections = 0;

    // Register valid relations
    for (let r = 0; r < numRooms; r++) {
      const relId = `rel_load_${numClients}_${r}`;
      const docId = `doc_${numClients}_${r}`;
      const patId = `pat_${numClients}_${r}`;
      validRelations.set(relId, { doctorId: docId, patientId: patId });
    }

    // 1. Connect all clients simultaneously
    const connectPromises = [];
    for (let r = 0; r < numRooms; r++) {
      const relId = `rel_load_${numClients}_${r}`;
      const docId = `doc_${numClients}_${r}`;
      const patId = `pat_${numClients}_${r}`;

      const pairs = [
        { userId: docId, role: 'DOCTOR' as const, relId },
        { userId: patId, role: 'PATIENT' as const, relId },
      ];

      for (const p of pairs) {
        const token = generateTestToken({ id: p.userId, userId: p.userId, role: p.role });
        const startConn = performance.now();

        const promise = new Promise<void>((resolve) => {
          const client = Client(`http://localhost:${port}`, {
            auth: { token },
            transports: ['websocket'],
            forceNew: true,
            timeout: 5000,
          });

          client.on('connect', () => {
            const latency = performance.now() - startConn;
            connLatencies.push(latency);
            successfulConnections++;
            clients.push({ socket: client, role: p.role, userId: p.userId, relationId: p.relId, connLatency: latency });
            resolve();
          });

          client.on('connect_error', () => {
            failedConnections++;
            resolve();
          });
        });

        connectPromises.push(promise);
      }
    }

    await Promise.all(connectPromises);

    connLatencies.sort((a, b) => a - b);
    const avgConnectionLatencyMs = connLatencies.reduce((a, b) => a + b, 0) / (connLatencies.length || 1);
    const p95ConnectionLatencyMs = connLatencies[Math.floor(connLatencies.length * 0.95)] || avgConnectionLatencyMs;

    // 2. Join Rooms
    for (const c of clients) {
      c.socket.emit('joinRoom', { doctorPatientRelationId: c.relationId });
    }

    await new Promise((r) => setTimeout(r, 200));

    // 3. Measure Message Delivery, Latency, Uniqueness, and Cross-Room Isolation
    const deliveryLatencies: number[] = [];
    let crossRoomLeakageCount = 0;
    const receivedMessageIds = new Map<string, number>();
    let totalMessagesReceived = 0;

    // Attach listeners
    for (const c of clients) {
      c.socket.on('receiveMessage', (msg: any) => {
        totalMessagesReceived++;
        if (msg.metaSendTimestamp) {
          deliveryLatencies.push(performance.now() - msg.metaSendTimestamp);
        }
        // Verify room isolation
        if (msg.doctorPatientRelationId && msg.doctorPatientRelationId !== c.relationId) {
          crossRoomLeakageCount++;
        }
        // Track duplicate delivery
        const key = `${c.userId}_${msg.id || msg.metaMsgId}`;
        receivedMessageIds.set(key, (receivedMessageIds.get(key) || 0) + 1);
      });
    }

    // Send 2 messages per room (1 from doctor, 1 from patient)
    let totalMessagesSent = 0;
    const sendPromises = [];

    for (let r = 0; r < numRooms; r++) {
      const relId = `rel_load_${numClients}_${r}`;
      const docClient = clients.find((c) => c.relationId === relId && c.role === 'DOCTOR');
      const patClient = clients.find((c) => c.relationId === relId && c.role === 'PATIENT');

      if (docClient && patClient) {
        totalMessagesSent += 2;
        const msgId1 = `msg_d2p_${r}_${Date.now()}`;
        const msgId2 = `msg_p2d_${r}_${Date.now()}`;

        docClient.socket.emit('sendMessage', {
          doctorPatientRelationId: relId,
          message: `Hello from Doctor ${r}`,
          senderId: docClient.userId,
          metaMsgId: msgId1,
          metaSendTimestamp: performance.now(),
        });

        patClient.socket.emit('sendMessage', {
          doctorPatientRelationId: relId,
          message: `Hello Doctor, this is Patient ${r}`,
          senderId: patClient.userId,
          metaMsgId: msgId2,
          metaSendTimestamp: performance.now(),
        });
      }
    }

    await new Promise((r) => setTimeout(r, 600));

    deliveryLatencies.sort((a, b) => a - b);
    const avgDeliveryLatencyMs = deliveryLatencies.reduce((a, b) => a + b, 0) / (deliveryLatencies.length || 1);
    const p95DeliveryLatencyMs = deliveryLatencies[Math.floor(deliveryLatencies.length * 0.95)] || avgDeliveryLatencyMs;

    let duplicateDeliveryCount = 0;
    for (const count of receivedMessageIds.values()) {
      if (count > 1) duplicateDeliveryCount += (count - 1);
    }

    // 4. Test Disconnect and Reconnection
    let disconnectCount = 0;
    let reconnectSuccessCount = 0;

    // Disconnect 20% of clients and reconnect
    const clientsToTestReconnect = clients.slice(0, Math.max(2, Math.floor(clients.length * 0.2)));
    for (const c of clientsToTestReconnect) {
      c.socket.disconnect();
      disconnectCount++;
    }

    await new Promise((r) => setTimeout(r, 100));

    for (const c of clientsToTestReconnect) {
      c.socket.connect();
      if (c.socket.connected) {
        reconnectSuccessCount++;
      }
    }

    // Clean up remaining open client sockets
    for (const c of clients) {
      c.socket.disconnect();
    }

    return {
      clientCount: numClients,
      connectionAttempts: numClients,
      successfulConnections,
      failedConnections,
      avgConnectionLatencyMs: Math.round(avgConnectionLatencyMs * 100) / 100,
      p95ConnectionLatencyMs: Math.round(p95ConnectionLatencyMs * 100) / 100,
      totalMessagesSent,
      totalMessagesReceived,
      avgDeliveryLatencyMs: Math.round(avgDeliveryLatencyMs * 100) / 100,
      p95DeliveryLatencyMs: Math.round(p95DeliveryLatencyMs * 100) / 100,
      crossRoomLeakageCount,
      duplicateDeliveryCount,
      disconnectCount,
      reconnectSuccessCount,
    };
  }

  // --------------------------------------------------------------------------
  // 4.1 10 Simultaneous Clients Load Test
  // --------------------------------------------------------------------------
  it('4.1 Socket.IO Load — 10 Concurrent Clients (5 Rooms)', async () => {
    const result = await runSocketScaleScenario(10);
    console.log('[Socket Load 10 Clients]:', JSON.stringify(result, null, 2));

    expect(result.successfulConnections).toBe(10);
    expect(result.failedConnections).toBe(0);
    expect(result.avgConnectionLatencyMs).toBeLessThan(100);
    expect(result.crossRoomLeakageCount).toBe(0);
    expect(result.duplicateDeliveryCount).toBe(0);
  });

  // --------------------------------------------------------------------------
  // 4.2 50 Simultaneous Clients Load Test
  // --------------------------------------------------------------------------
  it('4.2 Socket.IO Load — 50 Concurrent Clients (25 Rooms)', async () => {
    const result = await runSocketScaleScenario(50);
    console.log('[Socket Load 50 Clients]:', JSON.stringify(result, null, 2));

    expect(result.successfulConnections).toBe(50);
    expect(result.failedConnections).toBe(0);
    expect(result.p95ConnectionLatencyMs).toBeLessThan(150);
    expect(result.crossRoomLeakageCount).toBe(0);
    expect(result.duplicateDeliveryCount).toBe(0);
  });

  // --------------------------------------------------------------------------
  // 4.3 100 Simultaneous Clients Load Test
  // --------------------------------------------------------------------------
  it('4.3 Socket.IO Load — 100 Concurrent Clients (50 Rooms)', async () => {
    const result = await runSocketScaleScenario(100);
    console.log('[Socket Load 100 Clients]:', JSON.stringify(result, null, 2));

    expect(result.successfulConnections).toBe(100);
    expect(result.failedConnections).toBe(0);
    expect(result.p95ConnectionLatencyMs).toBeLessThan(250);
    expect(result.crossRoomLeakageCount).toBe(0);
    expect(result.duplicateDeliveryCount).toBe(0);
  });
});
