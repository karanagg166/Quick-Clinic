import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import type { PrismaClient as PrismaClientType } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import cors from 'cors';
import { SocketServer } from './server';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

// Load environment variables
dotenv.config();
if (!process.env.DATABASE_URL) {
  dotenv.config({ path: path.resolve(__dirname, '../.env') });
}
if (!process.env.DATABASE_URL) {
  dotenv.config({ path: path.resolve(process.cwd(), '.env') });
}

const app = express();
const httpServer = createServer(app);

// Initialize Prisma with PostgreSQL adapter
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL is not set in environment variables');
}

// Dynamically locate Prisma Client across development, ts-node, and compiled dist runtime
const prismaCandidatePaths = [
  path.resolve(__dirname, '../../src/generated/prisma/client'),
  path.resolve(__dirname, '../src/generated/prisma/client'),
  path.resolve(process.cwd(), 'src/generated/prisma/client'),
  path.resolve(process.cwd(), '../src/generated/prisma/client'),
];

const prismaClientPath = prismaCandidatePaths.find(
  (p) => fs.existsSync(p) || fs.existsSync(`${p}.js`)
);

const { PrismaClient } = prismaClientPath ? require(prismaClientPath) : require('@prisma/client');

const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({
  adapter,
  log: ['error', 'warn'],
}) as PrismaClientType;

// Origin & CORS configuration
const envFrontendUrls = (process.env.FRONTEND_URL || process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((u) => u.trim().replace(/\/$/, ''))
  .filter(Boolean);

const defaultProductionOrigins = [
  'https://quick-clinic-nine.vercel.app',
  'https://quick-clinic.vercel.app',
];

const developmentOrigins = [
  'http://localhost:3000',
  'http://localhost:3001',
  'http://127.0.0.1:3000',
];

const isProduction = process.env.NODE_ENV === 'production';
const PREVIEW_REGEX = /^https:\/\/quick-clinic(-[a-zA-Z0-9-]+)?-karan-aggarwals-projects\.vercel\.app$/;

export function isOriginAllowed(origin?: string): boolean {
  if (!origin) return true; // non-browser clients or direct HTTP (handled by internal auth)
  let normalized: string;
  try {
    const url = new URL(origin);
    normalized = `${url.protocol}//${url.host}`;
  } catch {
    return false;
  }

  // Explicit env configuration
  if (envFrontendUrls.includes(normalized)) return true;

  // Production allowlist
  if (defaultProductionOrigins.includes(normalized)) return true;

  // Development allowlist (disabled in production)
  if (!isProduction && developmentOrigins.includes(normalized)) return true;

  // Strictly-scoped Vercel preview domain pattern for this project
  if (PREVIEW_REGEX.test(normalized)) return true;

  return false;
}

app.use(
  cors({
    origin: (origin, callback) => {
      if (isOriginAllowed(origin)) {
        callback(null, true);
      } else {
        callback(null, false);
      }
    },
    credentials: true,
  })
);

app.use(express.json({ limit: '1mb' }));

const gitRevision =
  process.env.RENDER_GIT_COMMIT ||
  process.env.GIT_COMMIT ||
  process.env.COMMIT_SHA ||
  'development';

// Root & Health check endpoints
app.get('/', (req: express.Request, res: express.Response) => {
  res.json({ status: 'ok', service: 'quick-clinic-socket-server' });
});

app.get('/health', (req: express.Request, res: express.Response) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    gitCommit: gitRevision,
  });
});

app.get('/ready', async (req: express.Request, res: express.Response) => {
  try {
    await (prisma as any).$queryRaw`SELECT 1`;
    res.json({
      status: 'ready',
      database: 'connected',
      connections: io.engine.clientsCount,
      gitCommit: gitRevision,
    });
  } catch (err: any) {
    res.status(503).json({
      status: 'error',
      database: 'disconnected',
      error: err?.message || 'Database unavailable',
    });
  }
});

app.get('/metrics', requireInternalAuth, (req: express.Request, res: express.Response) => {
  res.json({
    connectedSockets: io.engine.clientsCount,
    roomsCount: io.sockets.adapter.rooms.size,
    uptimeSeconds: process.uptime(),
    memoryUsage: process.memoryUsage(),
  });
});

// Internal server-to-server publishing authentication middleware
export function requireInternalAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  const secret = process.env.INTERNAL_SECRET || process.env.INTERNAL_API_SECRET || process.env.JWT_SECRET;
  if (!secret) {
    return res.status(500).json({ error: 'Server misconfiguration: internal secret not set' });
  }

  const headerSecret =
    req.headers['x-internal-secret'] ||
    (req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : null);

  if (!headerSecret || typeof headerSecret !== 'string' || headerSecret !== secret) {
    return res.status(401).json({ error: 'Unauthorized: valid internal credential required' });
  }

  next();
}

// Initialize Socket.IO
const io = new Server(httpServer, {
  cors: {
    origin: (origin, callback) => {
      if (isOriginAllowed(origin)) {
        callback(null, true);
      } else {
        callback(null, false);
      }
    },
    methods: ['GET', 'POST'],
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization'],
  },
  allowRequest: (req, callback) => {
    const origin = req.headers.origin;
    if (origin && !isOriginAllowed(origin)) {
      return callback('Origin not allowed', false);
    }
    callback(null, true);
  },
  allowEIO3: true,
  transports: ['websocket', 'polling'],
});

// Initialize Socket.IO server with event handlers
const socketServer = new SocketServer(io, prisma);

type SocketNotification = {
  id: string;
  message: string;
  actionHref?: string | null;
  actionLabel?: string | null;
  createdAt: string;
  isRead: boolean;
};

// Notification records are persisted by the Next.js API. This endpoint broadcasts
// that record, preventing a second database notification per event.
app.post('/api/notifications/broadcast', requireInternalAuth, (req: express.Request, res: express.Response) => {
  try {
    const { userId, notification } = req.body as { userId?: string; notification?: SocketNotification };
    if (!userId || typeof userId !== 'string' || !notification?.id || !notification.message) {
      return res.status(400).json({ error: 'userId and a valid notification object are required' });
    }

    socketServer.sendNotificationToUser(userId, notification);
    return res.json({ success: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('Error broadcasting notification:', msg);
    return res.status(500).json({ error: msg });
  }
});

// A newly-booked appointment has already been persisted by Next.js. Emit its
// notification and appointment payload so the doctor's list updates instantly.
app.post('/api/notifications/new-appointment', requireInternalAuth, (req: express.Request, res: express.Response) => {
  try {
    const { doctorUserId, notification, appointment } = req.body as {
      doctorUserId?: string;
      notification?: SocketNotification;
      appointment?: Parameters<SocketServer['sendAppointmentRequest']>[1];
    };
    if (!doctorUserId || typeof doctorUserId !== 'string' || !notification?.id || !appointment?.id) {
      return res.status(400).json({ error: 'doctorUserId, notification, and appointment are required' });
    }

    socketServer.sendNotificationToUser(doctorUserId, notification);
    socketServer.sendAppointmentRequest(doctorUserId, appointment);
    return res.json({ success: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('Error handling new appointment notification:', msg);
    return res.status(500).json({ error: msg });
  }
});

// API endpoint to send appointment status update (replay-safe)
app.post('/api/notifications/appointment-status', requireInternalAuth, async (req: express.Request, res: express.Response) => {
  try {
    const { patientUserId, appointmentId, status, appointmentDate, appointmentTime, doctorName, notification } = req.body;

    if (!patientUserId || typeof patientUserId !== 'string' || !appointmentId || typeof appointmentId !== 'string' || !status || typeof status !== 'string') {
      return res.status(400).json({ error: 'patientUserId, appointmentId, and status are required strings' });
    }

    // Authoritative verification against database
    const appointment = await prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: {
        patient: { include: { user: true } },
        doctor: { include: { user: true } },
      },
    });

    if (!appointment) {
      return res.status(404).json({ error: 'Appointment not found' });
    }

    if (appointment.patient?.user?.id !== patientUserId) {
      return res.status(400).json({ error: 'Mismatched appointment or recipient' });
    }

    let canonicalNotification = notification;

    // Stable business event identity surviving retries: apt:<appointmentId>:<status>
    const eventId = `apt:${appointmentId}:${status}`;

    // If caller didn't provide pre-persisted notification, create/reuse replay-safe canonical notification
    if (!canonicalNotification || !canonicalNotification.id) {
      const existing = await prisma.notification.findUnique({
        where: {
          userId_eventId: {
            userId: patientUserId,
            eventId,
          },
        },
      });

      if (existing) {
        canonicalNotification = {
          id: existing.id,
          message: existing.message,
          actionHref: existing.actionHref,
          actionLabel: existing.actionLabel,
          createdAt: existing.createdAt.toISOString(),
          isRead: existing.isRead,
        };
      } else {
        const statusMessages: Record<string, string> = {
          CONFIRMED: `Your appointment with Dr. ${doctorName || appointment.doctor?.user?.name || 'Doctor'} has been confirmed`,
          CANCELLED: `Your appointment with Dr. ${doctorName || appointment.doctor?.user?.name || 'Doctor'} has been cancelled`,
          COMPLETED: `Your appointment with Dr. ${doctorName || appointment.doctor?.user?.name || 'Doctor'} has been marked as completed`,
          RESCHEDULED: `Your appointment with Dr. ${doctorName || appointment.doctor?.user?.name || 'Doctor'} has been rescheduled`,
        };

        const message = statusMessages[status] || `Your appointment status has been updated to ${status}`;

        try {
          const created = await prisma.notification.create({
            data: {
              userId: patientUserId,
              message,
              eventId,
              actionHref: `/patient/appointments/${appointmentId}`,
              actionLabel: 'View appointment',
              isRead: false,
              status: 'UNREAD',
            },
          });

          canonicalNotification = {
            id: created.id,
            message: created.message,
            actionHref: created.actionHref,
            actionLabel: created.actionLabel,
            createdAt: created.createdAt.toISOString(),
            isRead: created.isRead,
          };
        } catch (createErr: any) {
          if (createErr?.code === 'P2002') {
            const retryExisting = await prisma.notification.findUnique({
              where: {
                userId_eventId: {
                  userId: patientUserId,
                  eventId,
                },
              },
            });
            if (retryExisting) {
              canonicalNotification = {
                id: retryExisting.id,
                message: retryExisting.message,
                actionHref: retryExisting.actionHref,
                actionLabel: retryExisting.actionLabel,
                createdAt: retryExisting.createdAt.toISOString(),
                isRead: retryExisting.isRead,
              };
            } else {
              throw createErr;
            }
          } else {
            throw createErr;
          }
        }
      }
    }

    // Persist before emitting; emit safely so socket emission failure does not fail persistence
    try {
      socketServer.sendNotificationToUser(patientUserId, canonicalNotification);
      socketServer.sendAppointmentStatusUpdate(patientUserId, {
        id: appointmentId,
        status,
        appointmentDate: appointmentDate || new Date().toISOString(),
        appointmentTime: appointmentTime || new Date().toISOString(),
        doctorName: doctorName || appointment.doctor?.user?.name || 'Doctor',
      });
    } catch (emitErr) {
      console.warn('Socket emission warning during status update:', emitErr);
    }

    return res.json({ success: true, notification: canonicalNotification });
  } catch (error: unknown) {
    console.error('Error sending appointment status update:', error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to send status update',
    });
  }
});

// API endpoint to send appointment notification (replay-safe)
app.post('/api/notifications/appointment', requireInternalAuth, async (req: express.Request, res: express.Response) => {
  try {
    const { doctorId, appointmentId } = req.body;

    if (!doctorId || typeof doctorId !== 'string' || !appointmentId || typeof appointmentId !== 'string') {
      return res.status(400).json({ error: 'doctorId and appointmentId are required strings' });
    }

    // Get appointment details
    const appointment = await prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: {
        patient: { include: { user: { include: { location: true } } } },
        doctor: { include: { user: true } },
        slot: true,
      },
    });

    if (!appointment) {
      return res.status(404).json({ error: 'Appointment not found' });
    }

    if (appointment.doctorId !== doctorId) {
      return res.status(400).json({ error: 'Appointment does not belong to specified doctor' });
    }

    const doctorUserId = appointment.doctor?.user?.id;
    const patientUser = appointment.patient?.user;

    if (!doctorUserId || !patientUser) {
      return res.status(400).json({ error: 'Doctor or patient user record not found for appointment' });
    }

    const patientName = patientUser.name || 'Patient';

    const eventId = `apt:${appointmentId}:BOOKED`;

    // Deduplication check: check if notification already exists for doctorUserId and eventId
    let notificationRecord = await prisma.notification.findUnique({
      where: {
        userId_eventId: {
          userId: doctorUserId,
          eventId,
        },
      },
    });

    if (!notificationRecord) {
      const slotDate = appointment.slot?.date ? appointment.slot.date.toLocaleDateString() : '';
      const slotTime = appointment.slot?.startTime
        ? new Date(appointment.slot.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : '';

      const message = `New appointment booking from ${patientName} for ${slotDate} at ${slotTime}`;

      try {
        notificationRecord = await prisma.notification.create({
          data: {
            userId: doctorUserId,
            message,
            eventId,
            actionHref: `/doctor/appointments/${appointment.id}`,
            actionLabel: 'View appointment',
            isRead: false,
            status: 'UNREAD',
          },
        });
      } catch (createErr: any) {
        if (createErr?.code === 'P2002') {
          notificationRecord = await prisma.notification.findUnique({
            where: {
              userId_eventId: {
                userId: doctorUserId,
                eventId,
              },
            },
          });
          if (!notificationRecord) throw createErr;
        } else {
          throw createErr;
        }
      }
    }

    const canonicalNotification = {
      id: notificationRecord.id,
      message: notificationRecord.message,
      actionHref: notificationRecord.actionHref,
      actionLabel: notificationRecord.actionLabel,
      createdAt: notificationRecord.createdAt.toISOString(),
      isRead: notificationRecord.isRead,
    };

    const appointmentData = {
      id: appointment.id,
      patientName: patientUser.name || 'Patient',
      patientString: patientUser.email || 'N/A',
      gender: patientUser.gender || 'MALE',
      appointmentDate: appointment.slot?.date?.toISOString() || new Date().toISOString(),
      appointmentTime: appointment.slot?.startTime?.toISOString() || new Date().toISOString(),
      status: appointment.status,
      city: patientUser.location?.city || 'N/A',
      age: patientUser.age || 0,
      paymentMethod: appointment.paymentMethod,
    };

    // Persist before emitting; emit safely so socket emission failure does not fail persistence
    try {
      socketServer.sendNotificationToUser(doctorUserId, canonicalNotification);
      socketServer.sendAppointmentRequest(doctorUserId, appointmentData);
    } catch (emitErr) {
      console.warn('Socket emission warning during new appointment:', emitErr);
    }

    return res.json({ success: true, notification: canonicalNotification, appointment: appointmentData });
  } catch (error: unknown) {
    console.error('Error sending appointment notification:', error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to send notification',
    });
  }
});

// Server-side revocation endpoints
app.post('/api/sockets/revoke-user', requireInternalAuth, (req: express.Request, res: express.Response) => {
  const { userId, reason } = req.body;
  if (!userId || typeof userId !== 'string') {
    return res.status(400).json({ error: 'userId is required' });
  }
  socketServer.disconnectUser(userId, reason);
  return res.json({ success: true, message: `Sockets for user ${userId} disconnected` });
});

app.post('/api/sockets/revoke-relation', requireInternalAuth, (req: express.Request, res: express.Response) => {
  const { relationId, reason } = req.body;
  if (!relationId || typeof relationId !== 'string') {
    return res.status(400).json({ error: 'relationId is required' });
  }
  socketServer.disconnectRelation(relationId, reason);
  return res.json({ success: true, message: `Sockets in relation ${relationId} disconnected` });
});

// Export express app, httpServer, io, and socketServer instance for tests and API routes
export { app, httpServer, io, socketServer };

// Error handling
process.on('unhandledRejection', (error: unknown) => {
  console.error('Unhandled rejection:', error);
});

process.on('uncaughtException', (error: Error) => {
  console.error('Uncaught exception:', error);
  process.exit(1);
});

// Graceful shutdown
async function gracefulShutdown(signal: string) {
  console.log(`${signal} received, closing Socket.IO server gracefully...`);
  io.close();
  const shutdownTimeout = setTimeout(() => {
    console.error('Graceful shutdown timed out, forcing exit');
    process.exit(1);
  }, 5000);
  try {
    await prisma.$disconnect();
  } catch (err) {
    console.error('Error disconnecting prisma:', err);
  }
  httpServer.close(() => {
    clearTimeout(shutdownTimeout);
    console.log('Socket.IO HTTP server closed cleanly');
    process.exit(0);
  });
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Start server when run directly (not during unit/integration tests)
if (process.env.NODE_ENV !== 'test') {
  const PORT = Number(process.env.PORT || process.env.SOCKET_PORT || 4000);
  const HOST = process.env.HOST || '0.0.0.0';

  httpServer.listen(PORT, HOST, () => {
    console.log(`🚀 Socket.IO server running on ${HOST}:${PORT}`);
    console.log(`📡 WebSocket endpoint: ws://localhost:${PORT}`);
    console.log(`🌐 Allowed origins: ${Array.from(new Set([...envFrontendUrls, ...defaultProductionOrigins])).join(', ')}`);
  });
}
