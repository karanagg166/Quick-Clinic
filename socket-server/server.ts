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
  nbf?: number;
  aud?: string;
  [key: string]: any;
}

/**
 * Verify HS256 JWT cryptographically without external runtime dependencies.
 * Matches Next.js jose SignJWT signature format and enforces strict security.
 */
export function verifySocketJWT(
  token: string,
  secretKey?: string
): { valid: boolean; payload?: JWTPayload; error?: string } {
  try {
    if (!token || typeof token !== 'string') {
      return { valid: false, error: 'Missing token' };
    }

    const secret = secretKey || process.env.JWT_SECRET;
    if (!secret || typeof secret !== 'string' || !secret.trim()) {
      return { valid: false, error: 'JWT_SECRET is not configured' };
    }

    const parts = token.trim().split('.');
    if (parts.length !== 3) {
      return { valid: false, error: 'Invalid token format' };
    }

    const [headerB64, payloadB64, signatureB64] = parts;

    // Validate header
    let header: any;
    try {
      header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf8'));
    } catch {
      return { valid: false, error: 'Invalid token header' };
    }

    if (!header || typeof header !== 'object' || header.alg !== 'HS256') {
      return { valid: false, error: 'Unsupported signing algorithm' };
    }

    // Verify signature
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(`${headerB64}.${payloadB64}`)
      .digest('base64url');

    const expectedBuf = Buffer.from(expectedSignature);
    const receivedBuf = Buffer.from(signatureB64);

    if (expectedBuf.length !== receivedBuf.length || !crypto.timingSafeEqual(expectedBuf, receivedBuf)) {
      return { valid: false, error: 'Invalid token signature' };
    }

    // Parse payload
    let payload: JWTPayload;
    try {
      payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    } catch {
      return { valid: false, error: 'Invalid token payload' };
    }

    if (!payload || typeof payload !== 'object') {
      return { valid: false, error: 'Invalid token payload' };
    }

    // Enforce required finite numeric expiration (exp)
    if (payload.exp === undefined || payload.exp === null) {
      return { valid: false, error: 'Missing expiration claim' };
    }
    if (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp)) {
      return { valid: false, error: 'Invalid expiration claim' };
    }
    if (Date.now() >= payload.exp * 1000) {
      return { valid: false, error: 'Token expired' };
    }

    // Enforce not-before (nbf) if provided
    if (payload.nbf !== undefined && payload.nbf !== null) {
      if (typeof payload.nbf !== 'number' || !Number.isFinite(payload.nbf)) {
        return { valid: false, error: 'Invalid not-before claim' };
      }
      if (Date.now() < (payload.nbf - 60) * 1000) {
        return { valid: false, error: 'Token not yet valid' };
      }
    }

    // Enforce issued-at (iat) if provided
    if (payload.iat !== undefined && payload.iat !== null) {
      if (typeof payload.iat !== 'number' || !Number.isFinite(payload.iat)) {
        return { valid: false, error: 'Invalid issued-at claim' };
      }
    }

    // Enforce valid nonempty identity (id or userId)
    const id = payload.id ?? payload.userId;
    if (typeof id !== 'string' || !id.trim()) {
      return { valid: false, error: 'Missing identity claim' };
    }

    // Enforce consistency between id and userId if both are present
    if (payload.id !== undefined && payload.userId !== undefined && payload.id !== payload.userId) {
      return { valid: false, error: 'Conflicting identity claims' };
    }

    // Role check if present
    if (payload.role !== undefined && payload.role !== null) {
      if (typeof payload.role !== 'string' || !['PATIENT', 'DOCTOR', 'ADMIN'].includes(payload.role.toUpperCase())) {
        return { valid: false, error: 'Invalid role claim' };
      }
    }

    return { valid: true, payload };
  } catch {
    return { valid: false, error: 'Authentication failed' };
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
   * Requires a signed JWT token and validates relation ownership.
   * Never accepts unverified client-supplied userId.
   */
  private setupAuthentication(): void {
    this.io.use(async (socket: Socket, next) => {
      try {
        const rawAuth = socket.handshake.auth || {};
        const headerAuth = socket.handshake.headers?.authorization;
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

        const tokenPayload = authResult.payload;
        const verifiedUserId = (tokenPayload.id || tokenPayload.userId) as string;

        // Reject conflicting client-supplied userId
        if (rawAuth.userId && typeof rawAuth.userId === 'string' && rawAuth.userId !== verifiedUserId) {
          return next(new Error('Conflicting identity claims'));
        }

        // Authoritative database check: load current active user
        const user = await this.prisma.user.findUnique({
          where: { id: verifiedUserId },
          select: { id: true, role: true, name: true, isActive: true },
        });

        if (!user) {
          return next(new Error('User not found'));
        }

        if (user.isActive === false) {
          return next(new Error('Account inactive'));
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

          const isDoctor =
            relation.doctor?.user?.id === verifiedUserId || (relation as any).doctorsUserId === verifiedUserId;
          const isPatient =
            relation.patient?.user?.id === verifiedUserId || (relation as any).patientsUserId === verifiedUserId;

          if (!isDoctor && !isPatient) {
            return next(new Error('Unauthorized'));
          }

          const userName = isDoctor
            ? (relation.doctor?.user?.name || user.name || 'Doctor')
            : (relation.patient?.user?.name || user.name || 'Patient');
          const userRole = isDoctor ? 'DOCTOR' : 'PATIENT';

          (socket as any).relationId = relationId;
          (socket as any).userId = verifiedUserId;
          (socket as any).userName = userName;
          (socket as any).userRole = userRole;
        } else {
          // Notification connection - verified user in database
          (socket as any).userId = verifiedUserId;
          (socket as any).userRole = user.role;
          (socket as any).userName = user.name;
        }

        next();
      } catch (error: any) {
        if (
          error?.message === 'Relation not found' ||
          error?.message === 'User not found' ||
          error?.message === 'Unauthorized' ||
          error?.message === 'Account inactive' ||
          error?.message === 'Missing token' ||
          error?.message === 'Conflicting identity claims'
        ) {
          return next(error);
        }
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

      // Handle sending new message with acknowledgement and deduplication
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
   * Handle getting initial messages with pagination and recent ordering
   */
  private handleGetInitialMessages(socket: Socket, relationId: string): void {
    socket.on('get_initial_messages', async (data: { page?: number; limit?: number }) => {
      try {
        const page = Math.max(1, data?.page || 1);
        const limit = Math.min(Math.max(1, data?.limit || 50), 100);
        const skip = (page - 1) * limit;

        const totalCount = await this.prisma.chatMessages.count({
          where: { doctorPatientRelationId: relationId },
        });

        // Retrieve latest messages descending then reverse to send in chronological order
        const messagesDesc = await this.prisma.chatMessages.findMany({
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
          orderBy: { createdAt: 'desc' },
          skip,
          take: limit,
        });

        const messages = messagesDesc.reverse();

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
   * Handle sending new message with typed acknowledgement and deduplication
   */
  private handleSendMessage(socket: Socket, relationId: string, userId: string, _userName: string): void {
    socket.on('send_message', async (data: any, callback?: (ack: any) => void) => {
      try {
        if (!data || typeof data !== 'object') {
          const errRes = { success: false, error: 'Invalid message payload' };
          if (typeof callback === 'function') callback(errRes);
          return socket.emit('error', { message: 'Invalid message payload' });
        }

        const rawText = data.text;
        if (typeof rawText !== 'string' || !rawText.trim()) {
          const errRes = { success: false, error: 'Message cannot be empty' };
          if (typeof callback === 'function') callback(errRes);
          return socket.emit('error', { message: 'Message cannot be empty' });
        }

        const text = rawText.trim();
        if (text.length > 5000) {
          const errRes = { success: false, error: 'Message exceeds maximum length of 5000 characters' };
          if (typeof callback === 'function') callback(errRes);
          return socket.emit('error', { message: 'Message exceeds maximum length of 5000 characters' });
        }

        const clientMessageId =
          typeof data.clientMessageId === 'string' && data.clientMessageId.trim()
            ? data.clientMessageId.trim()
            : typeof data.idempotencyKey === 'string' && data.idempotencyKey.trim()
            ? data.idempotencyKey.trim()
            : null;

        // Deduplication: check if message with this id already exists in database
        if (clientMessageId) {
          const existing = await this.prisma.chatMessages.findUnique({
            where: { id: clientMessageId },
            include: {
              sender: {
                select: { id: true, name: true, role: true },
              },
            },
          });

          if (existing && existing.doctorPatientRelationId === relationId) {
            const formattedExisting = {
              id: existing.id,
              text: existing.text,
              senderId: existing.senderId,
              senderName: existing.sender.name,
              senderRole: existing.sender.role,
              createdAt: existing.createdAt.toISOString(),
            };
            if (typeof callback === 'function') {
              callback({ success: true, message: formattedExisting });
            }
            return;
          }
        }

        // Save message to database using verified userId
        const message = await this.prisma.chatMessages.create({
          data: {
            ...(clientMessageId ? { id: clientMessageId } : {}),
            text,
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

        // Acknowledge sending client
        if (typeof callback === 'function') {
          callback({ success: true, message: formattedMessage });
        }

        // Broadcast to all users in the relation
        this.io.to(`relation_${relationId}`).emit('new_message', {
          message: formattedMessage,
        });
      } catch (error) {
        console.error('Error saving message:', error);
        const errRes = { success: false, error: 'Failed to send message' };
        if (typeof callback === 'function') callback(errRes);
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
    socket.on('mark_as_read', (data: { messageId: string }) => {
      try {
        if (!data || typeof data.messageId !== 'string') return;
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
  private handleDisconnect(socket: Socket, _userName: string, relationId: string, userId: string): void {
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
