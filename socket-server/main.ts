import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import cors from 'cors';
import { SocketServer } from './server';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const app = express();
const httpServer = createServer(app);

// Initialize Prisma with PostgreSQL adapter
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL is not set in environment variables');
}

const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({
  adapter,
  log: ['error', 'warn'],
});

// CORS configuration
// Normalize frontend URL by removing trailing slash to avoid CORS mismatches
const frontendUrl = (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, '');
// Create array of allowed origins (with and without trailing slash for compatibility)
const allowedOrigins = [frontendUrl, `${frontendUrl}/`];

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);

    // Normalize origin by removing trailing slash for comparison
    const normalizedOrigin = origin.replace(/\/$/, '');

    if (normalizedOrigin === frontendUrl || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
}));

app.use(express.json());

// Health check endpoint
app.get('/health', (req: express.Request, res: express.Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Initialize Socket.IO
const io = new Server(httpServer, {
  cors: {
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps or curl requests)
      if (!origin) return callback(null, true);

      // Normalize origin by removing trailing slash for comparison
      const normalizedOrigin = origin.replace(/\/$/, '');

      if (normalizedOrigin === frontendUrl || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
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

// Export socket server instance for use in API routes
export { socketServer };

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

// Start server
const PORT = Number(process.env.PORT || process.env.SOCKET_PORT || 4000);
const HOST = process.env.HOST || '0.0.0.0';

httpServer.listen(PORT, HOST, () => {
  console.log(`🚀 Socket.IO server running on ${HOST}:${PORT}`);
  console.log(`📡 WebSocket endpoint: ws://localhost:${PORT}`);
  console.log(`🌐 Frontend allowed from: ${frontendUrl}`);
});

