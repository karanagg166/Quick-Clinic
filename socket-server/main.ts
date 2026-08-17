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

// CORS configuration
const envFrontendUrls = (process.env.FRONTEND_URL || '')
  .split(',')
  .map((u) => u.trim().replace(/\/$/, ''))
  .filter(Boolean);

const defaultAllowedOrigins = [
  'http://localhost:3000',
  'http://localhost:3001',
  'http://127.0.0.1:3000',
  'https://quick-clinic-nine.vercel.app',
  'https://quick-clinic.vercel.app',
];

const allowedOriginsSet = new Set([...envFrontendUrls, ...defaultAllowedOrigins]);

function isOriginAllowed(origin?: string): boolean {
  if (!origin) return true;
  const normalized = origin.replace(/\/$/, '');
  if (allowedOriginsSet.has(normalized)) return true;
  if (/^https:\/\/.*\.vercel\.app$/.test(normalized)) return true;
  if (/^http:\/\/localhost(:\d+)?$/.test(normalized)) return true;
  if (/^http:\/\/127\.0\.0\.1(:\d+)?$/.test(normalized)) return true;
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

app.use(express.json());

// Root & Health check endpoints
app.get('/', (req: express.Request, res: express.Response) => {
  res.json({ status: 'ok', service: 'quick-clinic-socket-server' });
});

app.get('/health', (req: express.Request, res: express.Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

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

// Notification records are persisted by the Next.js API. This endpoint only
// broadcasts that record, preventing a second database notification per event.
app.post('/api/notifications/broadcast', (req: express.Request, res: express.Response) => {
  const { userId, notification } = req.body as { userId?: string; notification?: SocketNotification };
  if (!userId || !notification?.id || !notification.message) {
    return res.status(400).json({ error: 'userId and a notification are required' });
  }

  socketServer.sendNotificationToUser(userId, notification);
  return res.json({ success: true });
});

// A newly-booked appointment has already been persisted by Next.js. Emit its
// notification and appointment payload so the doctor's list updates instantly.
app.post('/api/notifications/new-appointment', (req: express.Request, res: express.Response) => {
  const { doctorUserId, notification, appointment } = req.body as {
    doctorUserId?: string;
    notification?: SocketNotification;
    appointment?: Parameters<SocketServer['sendAppointmentRequest']>[1];
  };
  if (!doctorUserId || !notification?.id || !appointment?.id) {
    return res.status(400).json({ error: 'doctorUserId, notification, and appointment are required' });
  }

  socketServer.sendNotificationToUser(doctorUserId, notification);
  socketServer.sendAppointmentRequest(doctorUserId, appointment);
  return res.json({ success: true });
});

// API endpoint to send appointment status update (called from Next.js API routes)
app.post('/api/notifications/appointment-status', async (req: express.Request, res: express.Response) => {
  try {
    const { patientUserId, appointmentId, status, appointmentDate, appointmentTime, doctorName } = req.body;

    if (!patientUserId || !appointmentId || !status) {
      return res.status(400).json({ error: 'patientUserId, appointmentId, and status are required' });
    }

    // Create notification message
    const statusMessages: Record<string, string> = {
      CONFIRMED: `Your appointment with Dr. ${doctorName} has been confirmed`,
      CANCELLED: `Your appointment with Dr. ${doctorName} has been cancelled`,
      COMPLETED: `Your appointment with Dr. ${doctorName} has been marked as completed`,
      RESCHEDULED: `Your appointment with Dr. ${doctorName} has been rescheduled`,
    };

    const message = statusMessages[status] || `Your appointment status has been updated to ${status}`;

    // Create notification in database
    const notification = await prisma.notification.create({
      data: {
        userId: patientUserId,
        message,
        isRead: false,
        status: 'UNREAD',
      },
    });

    // Send notification via socket
    socketServer.sendNotificationToUser(patientUserId, {
      id: notification.id,
      message: notification.message,
      createdAt: notification.createdAt.toISOString(),
      isRead: notification.isRead,
    });

    // Send appointment status update via socket
    socketServer.sendAppointmentStatusUpdate(patientUserId, {
      id: appointmentId,
      status,
      appointmentDate,
      appointmentTime,
      doctorName: doctorName || 'Doctor',
    });

    return res.json({ success: true, notification });
  } catch (error: unknown) {
    console.error('Error sending appointment status update:', error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to send status update'
    });
  }
});

// API endpoint to send appointment notification (called from Next.js API routes)
app.post('/api/notifications/appointment', async (req: express.Request, res: express.Response) => {
  try {
    const { doctorId, appointmentId } = req.body;

    if (!doctorId || !appointmentId) {
      return res.status(400).json({ error: 'doctorId and appointmentId are required' });
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

    // Get doctor's userId
    const doctorUserId = appointment.doctor.user.id;
    const patientName = appointment.patient.user.name;

    // Format date and time
    const slotDate = appointment.slot.date.toLocaleDateString();
    const slotTime = new Date(appointment.slot.startTime).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });

    // Create notification message
    const message = `New appointment booking from ${patientName} for ${slotDate} at ${slotTime}`;

    // Create notification in database
    const notification = await prisma.notification.create({
      data: {
        userId: doctorUserId,
        message,
        isRead: false,
        status: 'UNREAD',
      },
    });

    // Send notification via socket
    socketServer.sendNotificationToUser(doctorUserId, {
      id: notification.id,
      message: notification.message,
      createdAt: notification.createdAt.toISOString(),
      isRead: notification.isRead,
    });

    // Send appointment request data via socket for real-time UI update
    const appointmentData = {
      id: appointment.id,
      patientName: appointment.patient.user.name,
      patientString: appointment.patient.user.email,
      gender: appointment.patient.user.gender,
      appointmentDate: appointment.slot.date.toISOString(),
      appointmentTime: appointment.slot.startTime.toISOString(),
      status: appointment.status,
      city: appointment.patient.user.location?.city || "N/A",
      age: appointment.patient.user.age,
      paymentMethod: appointment.paymentMethod,
    };

    socketServer.sendAppointmentRequest(doctorUserId, appointmentData);

    return res.json({ success: true, notification, appointment: appointmentData });
  } catch (error: unknown) {
    console.error('Error sending appointment notification:', error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to send notification'
    });
  }
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
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, closing server...');
  await prisma.$disconnect();
  httpServer.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

// Start server when run directly (not during unit/integration tests)
if (process.env.NODE_ENV !== 'test') {
  const PORT = Number(process.env.PORT || process.env.SOCKET_PORT || 4000);
  const HOST = process.env.HOST || '0.0.0.0';

  httpServer.listen(PORT, HOST, () => {
    console.log(`🚀 Socket.IO server running on ${HOST}:${PORT}`);
    console.log(`📡 WebSocket endpoint: ws://localhost:${PORT}`);
    console.log(`🌐 Allowed origins: ${Array.from(allowedOriginsSet).join(', ')}`);
  });
}
