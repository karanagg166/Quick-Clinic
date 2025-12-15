const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const { PrismaClient } = require('../src/generated/prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const cors = require('cors');
require('dotenv').config();

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
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true,
}));

app.use(express.json());

// Initialize Socket.IO
const io = new Server(httpServer, {
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Socket.IO Authentication Middleware
io.use(async (socket, next) => {
  try {
    const { relationId, userId } = socket.handshake.auth;

    if (!relationId || !userId) {
      return next(new Error('Missing relationId or userId'));
    }

    // Verify user has access to this relation
    const relation = await prisma.doctorPatientRelation.findUnique({
      where: { id: relationId },
      include: {
        doctor: { include: { user: true } },
        patient: { include: { user: true } },
      },
    });

    if (!relation) {
      return next(new Error('Relation not found'));
    }

    const hasAccess =
      relation.doctor.user.id === userId || relation.patient.user.id === userId;

    if (!hasAccess) {
      return next(new Error('Unauthorized'));
    }

    // Attach user info to socket
    socket.relationId = relationId;
    socket.userId = userId;
    socket.userName = relation.doctor.user.id === userId 
      ? relation.doctor.user.name 
      : relation.patient.user.name;
    socket.userRole = relation.doctor.user.id === userId ? 'DOCTOR' : 'PATIENT';

    next();
  } catch (error) {
    console.error('Authentication error:', error);
    next(new Error('Authentication failed'));
  }
});

// Socket.IO Connection Handler
io.on('connection', (socket) => {
  const { relationId, userId, userName, userRole } = socket;

  console.log(`User ${userName} (${userRole}) connected to relation ${relationId}`);

  // Join room for the relation
  socket.join(`relation_${relationId}`);

  // Emit connection confirmation
  socket.emit('connected', {
    message: 'Connected successfully',
    userId,
    userName,
    userRole,
  });

  // Handle request for initial messages
  socket.on('get_initial_messages', async (data) => {
    try {
      const page = data?.page || 1;
      const limit = Math.min(data?.limit || 20, 100); // Max 100 messages
      const skip = (page - 1) * limit;

      const [messages, totalCount] = await Promise.all([
        prisma.chatMessages.findMany({
          where: { doctorPatientRelationId: relationId },
          include: {
            sender: {
              select: {
                id: true,
                name: true,
                role: true,
              },
            },
          },
          orderBy: { createdAt: 'asc' },
          skip,
          take: limit,
        }),
        prisma.chatMessages.count({
          where: { doctorPatientRelationId: relationId },
        }),
      ]);

      const formattedMessages = messages.map((msg) => ({
        id: msg.id,
        text: msg.text,
        senderId: msg.senderId,
        senderName: msg.sender.name,
        senderRole: msg.sender.role,
        createdAt: msg.createdAt.toISOString(),
      }));

      socket.emit('initial_messages', {
        messages: formattedMessages,
        pagination: {
          page,
          limit,
          total: totalCount,
          hasMore: skip + limit < totalCount,
        },
      });
    } catch (error) {
      console.error('Error fetching initial messages:', error);
      socket.emit('error', { message: 'Failed to load messages' });
    }
  });

  // Handle sending new message
  socket.on('send_message', async (data) => {
    try {
      const { text } = data;

      if (!text || !text.trim()) {
        return socket.emit('error', { message: 'Message cannot be empty' });
      }

      // Save message to database
      const message = await prisma.chatMessages.create({
        data: {
          text: text.trim(),
          senderId: userId,
          doctorPatientRelationId: relationId,
        },
        include: {
          sender: {
            select: {
              id: true,
              name: true,
              role: true,
            },
          },
        },
      });

      const formattedMessage = {
        id: message.id,
        text: message.text,
        senderId: message.senderId,
        senderName: message.sender.name,
        senderRole: message.sender.role,
        createdAt: message.createdAt.toISOString(),
      };

      // Broadcast to all users in the relation (including sender)
      io.to(`relation_${relationId}`).emit('new_message', {
        message: formattedMessage,
      });

      console.log(`Message sent by ${userName} in relation ${relationId}`);
    } catch (error) {
      console.error('Error saving message:', error);
      socket.emit('error', { message: 'Failed to send message' });
    }
  });

  // Handle typing indicator
  socket.on('user_typing', () => {
    // Broadcast to others in the room (not sender)
    socket.to(`relation_${relationId}`).emit('user_typing', {
      userId,
      userName,
      userRole,
    });
  });

  // Handle message read status
  socket.on('mark_as_read', async (data) => {
    try {
      const { messageId } = data;

      // Update message read status in database if needed
      // Currently ChatMessages doesn't have isRead field
      // Add this field to schema if you want read receipts

      socket.to(`relation_${relationId}`).emit('message_read', {
        messageId,
        readBy: userId,
      });
    } catch (error) {
      console.error('Error marking message as read:', error);
    }
  });

  // Handle disconnect
  socket.on('disconnect', (reason) => {
    console.log(`User ${userName} disconnected from relation ${relationId}. Reason: ${reason}`);
    socket.leave(`relation_${relationId}`);
  });

  // Handle errors
  socket.on('error', (error) => {
    console.error(`Socket error for user ${userName}:`, error);
  });
});

// Error handling
process.on('unhandledRejection', (error) => {
  console.error('Unhandled rejection:', error);
});

process.on('uncaughtException', (error) => {
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
const PORT = process.env.PORT || process.env.SOCKET_PORT || 4000;
const HOST = process.env.HOST || '0.0.0.0';
httpServer.listen(PORT, HOST, () => {
  console.log(`🚀 Socket.IO server running on ${HOST}:${PORT}`);
  console.log(`📡 WebSocket endpoint: ws://localhost:${PORT}`);
  console.log(`🌐 Frontend allowed from: ${process.env.FRONTEND_URL || 'http://localhost:3000'}`);
});
