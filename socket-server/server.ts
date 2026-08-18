import { Server as SocketIOServer, Socket } from 'socket.io';
import crypto from 'crypto';
import type { PrismaClient } from '../src/generated/prisma/client';

export interface JWTPayload {
  id?: string;
  userId?: string;
  role?: string;
  email?: string;
  name?: string;
  exp?: number;
  iat?: number;
  [key: string]: any;
}

/**
 * Verify HS256 JWT cryptographically without external runtime dependencies.
 * Matches Next.js jose SignJWT signature format.
 */
export function verifySocketJWT(
  token: string,
  secretKey?: string
): { valid: boolean; payload?: JWTPayload; error?: string } {
  try {
    if (!token || typeof token !== 'string') {
      return { valid: false, error: 'Missing token' };
    }

    const parts = token.trim().split('.');
    if (parts.length !== 3) {
      return { valid: false, error: 'Invalid token format' };
    }

    const secret = secretKey || process.env.JWT_SECRET;
    if (!secret || typeof secret !== 'string' || !secret.trim()) {
      return { valid: false, error: 'JWT_SECRET is not configured' };
    }

    const [headerB64, payloadB64, signatureB64] = parts;

    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(`${headerB64}.${payloadB64}`)
      .digest('base64url');

    const expectedBuf = Buffer.from(expectedSignature);
    const receivedBuf = Buffer.from(signatureB64);

    if (expectedBuf.length !== receivedBuf.length || !crypto.timingSafeEqual(expectedBuf, receivedBuf)) {
      return { valid: false, error: 'Invalid token signature' };
    }

    const payloadJson = Buffer.from(payloadB64, 'base64url').toString('utf8');
    const payload: JWTPayload = JSON.parse(payloadJson);

    if (payload.exp && typeof payload.exp === 'number') {
      if (Date.now() >= payload.exp * 1000) {
        return { valid: false, error: 'Token expired' };
      }
    }

    return { valid: true, payload };
  } catch (err: any) {
    return { valid: false, error: err?.message || 'Authentication failed' };
  }
}

/**
 * Socket.IO server configuration and event handlers
 */
export class SocketServer {
  private io: SocketIOServer;
  private prisma: PrismaClient;
  private jwtSecret?: string;

  constructor(io: SocketIOServer, prisma: PrismaClient, jwtSecret?: string) {
    this.io = io;
    this.prisma = prisma;
    this.jwtSecret = jwtSecret;
    this.setupAuthentication();
    this.setupEventHandlers();
  }

  /**
   * Setup Socket.IO cryptographic authentication middleware
   * Requires a signed JWT token and validates relation ownership
   */
  private setupAuthentication(): void {
    this.io.use(async (socket: Socket, next) => {
      try {
        const rawAuth = socket.handshake.auth || {};
        const headerAuth = socket.handshake.headers.authorization;
        const token =
          rawAuth.token ||
          (headerAuth?.startsWith('Bearer ') ? headerAuth.slice(7) : null) ||
          socket.handshake.query?.token;

        if (!token || typeof token !== 'string') {
          return next(new Error('Missing token'));
        }

        const authResult = verifySocketJWT(token, this.jwtSecret);
        if (!authResult.valid || !authResult.payload) {
          return next(new Error(authResult.error || 'Authentication failed'));
        }

        const verifiedUserId = authResult.payload.id || authResult.payload.userId;
        if (!verifiedUserId) {
          return next(new Error('Invalid token payload: missing user identifier'));
        }

        const relationId = rawAuth.relationId || socket.handshake.query?.relationId;

        // If relationId is present, authenticate chat connection and verify relation membership
        if (relationId && typeof relationId === 'string') {
          const relation = await this.prisma.doctorPatientRelation.findUnique({
            where: { id: relationId },
            include: {
              doctor: { include: { user: true } },
              patient: { include: { user: true } },
            },
          });

          if (!relation) {
            return next(new Error('Relation not found'));
          }

          const isDoctor = relation.doctor.user.id === verifiedUserId;
          const isPatient = relation.patient.user.id === verifiedUserId;

          if (!isDoctor && !isPatient) {
            return next(new Error('Unauthorized'));
          }

          const userName = isDoctor ? relation.doctor.user.name : relation.patient.user.name;
          const userRole = isDoctor ? 'DOCTOR' : 'PATIENT';

          (socket as any).relationId = relationId;
          (socket as any).userId = verifiedUserId;
          (socket as any).userName = userName;
          (socket as any).userRole = userRole;
        } else {
          // Notification connection - load and verify user in database
          const user = await this.prisma.user.findUnique({
            where: { id: verifiedUserId },
          });

          if (!user) {
            return next(new Error('User not found'));
          }

          (socket as any).userId = verifiedUserId;
          (socket as any).userRole = user.role;
          (socket as any).userName = user.name;
        }

        next();
      } catch (error) {
        console.error('Authentication error:', error);
        next(new Error('Authentication failed'));
      }
    });
  }

  /**
   * Setup Socket.IO event handlers
   */
  private setupEventHandlers(): void {
    this.io.on('connection', (socket: Socket) => {
      const relationId = (socket as any).relationId;
      const userId = (socket as any).userId;
      const userName = (socket as any).userName;
      const userRole = (socket as any).userRole;

      // Always join user's own private notification room
      socket.join(`user_${userId}`);

      // Handle notification connections (no relationId)
      if (!relationId) {
        this.handleNotificationConnection(socket, userId, userRole, userName);
        return;
      }

      // Handle chat connections (has verified relationId)
      socket.join(`relation_${relationId}`);

      // Emit connection confirmation
      socket.emit('connected', {
        message: 'Connected successfully',
        userId,
        userName,
        userRole,
      });

      // Handle request for initial messages
      this.handleGetInitialMessages(socket, relationId);

      // Handle sending new message
      this.handleSendMessage(socket, relationId, userId, userName);

      // Handle typing indicator
      this.handleTypingIndicator(socket, relationId, userId, userName, userRole);

      // Handle message read status
      this.handleMarkAsRead(socket, relationId, userId);

      // Handle disconnect
      this.handleDisconnect(socket, userName, relationId, userId);

      // Handle errors
      this.handleSocketError(socket, userName);
    });
  }

  /**
   * Handle notification connection
   */
  private handleNotificationConnection(socket: Socket, userId: string, userRole: string, userName: string): void {
    socket.emit('notification_connected', {
      message: 'Connected to notifications',
      userId,
      userRole,
      userName,
    });

    socket.on('disconnect', () => {
      socket.leave(`user_${userId}`);
    });
  }

  /**
   * Send notification to a specific user (public method)
   */
  public sendNotificationToUser(
    userId: string,
    notification: {
      id: string;
      message: string;
      actionHref?: string | null;
      actionLabel?: string | null;
      createdAt: string;
      isRead: boolean;
    }
  ): void {
    this.io.to(`user_${userId}`).emit('new_notification', {
      notification,
    });
  }

  /**
   * Send appointment request to doctor (public method)
   */
  public sendAppointmentRequest(
    doctorUserId: string,
    appointment: {
      id: string;
      patientName: string;
      patientString: string;
      gender: string;
      appointmentDate: string;
      appointmentTime: string;
      status: string;
      city: string;
      age: number;
      paymentMethod: string;
    }
  ): void {
    this.io.to(`user_${doctorUserId}`).emit('new_appointment_request', {
      appointment,
    });
  }

  /**
   * Send appointment status update to patient (public method)
   */
  public sendAppointmentStatusUpdate(
    patientUserId: string,
    appointment: {
      id: string;
      status: string;
      appointmentDate: string;
      appointmentTime: string;
      doctorName: string;
    }
  ): void {
    this.io.to(`user_${patientUserId}`).emit('appointment_status_update', {
      appointment,
    });
  }

  /**
   * Handle getting initial messages with pagination
   */
  private handleGetInitialMessages(socket: Socket, relationId: string): void {
    socket.on('get_initial_messages', async (data: { page?: number; limit?: number }) => {
      try {
        const page = data?.page || 1;
        const limit = Math.min(data?.limit || 20, 100);
        const skip = (page - 1) * limit;

        const [messages, totalCount] = await Promise.all([
          this.prisma.chatMessages.findMany({
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
          this.prisma.chatMessages.count({
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
  }

  /**
   * Handle sending new message
   */
  private handleSendMessage(socket: Socket, relationId: string, userId: string, userName: string): void {
    socket.on('send_message', async (data: { text: string }) => {
      try {
        const { text } = data;

        if (!text || !text.trim()) {
          return socket.emit('error', { message: 'Message cannot be empty' });
        }

        // Save message to database using verified userId
        const message = await this.prisma.chatMessages.create({
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

        // Broadcast to all users in the relation
        this.io.to(`relation_${relationId}`).emit('new_message', {
          message: formattedMessage,
        });
      } catch (error) {
        console.error('Error saving message:', error);
        socket.emit('error', { message: 'Failed to send message' });
      }
    });
  }

  /**
   * Handle typing indicator
   */
  private handleTypingIndicator(
    socket: Socket,
    relationId: string,
    userId: string,
    userName: string,
    userRole: string
  ): void {
    socket.on('user_typing', () => {
      socket.to(`relation_${relationId}`).emit('user_typing', {
        userId,
        userName,
        userRole,
      });
    });
  }

  /**
   * Handle message read status
   */
  private handleMarkAsRead(socket: Socket, relationId: string, userId: string): void {
    socket.on('mark_as_read', async (data: { messageId: string }) => {
      try {
        const { messageId } = data;
        socket.to(`relation_${relationId}`).emit('message_read', {
          messageId,
          readBy: userId,
        });
      } catch (error) {
        console.error('Error marking message as read:', error);
      }
    });
  }

  /**
   * Handle socket disconnect
   */
  private handleDisconnect(socket: Socket, userName: string, relationId: string, userId: string): void {
    socket.on('disconnect', () => {
      socket.leave(`user_${userId}`);
      if (relationId) {
        socket.leave(`relation_${relationId}`);
      }
    });
  }

  /**
   * Handle socket errors
   */
  private handleSocketError(socket: Socket, userName: string): void {
    socket.on('error', (error: Error) => {
      console.error(`Socket error for user ${userName}:`, error);
    });
  }
}
