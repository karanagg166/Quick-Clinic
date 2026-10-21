import { Server as SocketIOServer, Socket } from 'socket.io';
import crypto from 'crypto';
import type { PrismaClient } from '../src/generated/prisma/client';
import { persistChatMessage, formatChatMessage, FormattedChatMessage } from './chat-persistence';

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

    // Enforce required audience (quick-clinic-socket)
    if (payload.aud !== 'quick-clinic-socket') {
      return { valid: false, error: 'Invalid token audience: quick-clinic-socket required' };
    }

    // Enforce short expiry: maximum 1 hour lifetime for socket tickets
    if (payload.iat && typeof payload.iat === 'number' && payload.exp - payload.iat > 3600) {
      return { valid: false, error: 'Token lifetime exceeds maximum allowed for socket connection' };
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

class SocketRateLimiter {
  private timestamps: Map<string, number[]> = new Map();

  public check(key: string, maxEvents: number, windowMs: number): boolean {
    const now = Date.now();
    const list = this.timestamps.get(key) || [];
    const valid = list.filter((t) => now - t < windowMs);
    if (valid.length >= maxEvents) {
      this.timestamps.set(key, valid);
      return false;
    }
    valid.push(now);
    this.timestamps.set(key, valid);
    return true;
  }

  public clear(key: string): void {
    this.timestamps.delete(key);
  }
}

/**
 * Socket.IO server configuration and event handlers
 */
export class SocketServer {
  private io: SocketIOServer;
  private prisma: PrismaClient;
  private jwtSecret?: string;
  private rateLimiter: SocketRateLimiter;

  constructor(io: SocketIOServer, prisma: PrismaClient, jwtSecret?: string) {
    this.io = io;
    this.prisma = prisma;
    this.jwtSecret = jwtSecret;
    this.rateLimiter = new SocketRateLimiter();
    this.setupAuthentication();
    this.setupEventHandlers();
  }

  /**
   * Disconnect any sockets associated with a revoked or deactivated user
   */
  public disconnectUser(userId: string, reason = 'Account updated or session terminated'): void {
    const room = this.io.sockets.adapter.rooms.get(`user_${userId}`);
    if (room) {
      for (const socketId of room) {
        const s = this.io.sockets.sockets.get(socketId);
        if (s) {
          s.emit('account_revoked', { reason });
          s.disconnect(true);
        }
      }
    }
  }

  /**
   * Disconnect any sockets in a conversation where access was revoked
   */
  public disconnectRelation(relationId: string, reason = 'Conversation access revoked'): void {
    const room = this.io.sockets.adapter.rooms.get(`relation_${relationId}`);
    if (room) {
      for (const socketId of room) {
        const s = this.io.sockets.sockets.get(socketId);
        if (s) {
          s.emit('relation_revoked', { relationId, reason });
          s.leave(`relation_${relationId}`);
        }
      }
    }
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

        // Enforce role consistency if claim is present in token
        if (tokenPayload.role && typeof tokenPayload.role === 'string') {
          if (tokenPayload.role.toUpperCase() !== user.role.toUpperCase()) {
            return next(new Error('Conflicting identity claims'));
          }
        }

        const relationId = rawAuth.relationId || socket.handshake.query?.relationId;

        // If relationId is requested, authenticate chat connection and verify relation membership
        if (relationId && typeof relationId === 'string') {
          // If ticket specifies a relationId, ensure it matches the requested relation
          if (tokenPayload.relationId && tokenPayload.relationId !== relationId) {
            return next(new Error('Unauthorized'));
          }

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
          const isAdmin = user.role === 'ADMIN';

          if (!isDoctor && !isPatient && !isAdmin) {
            return next(new Error('Unauthorized'));
          }

          const userName = isDoctor
            ? (relation.doctor?.user?.name || user.name || 'Doctor')
            : (relation.patient?.user?.name || user.name || 'Patient');
          const userRole = isDoctor ? 'DOCTOR' : (isPatient ? 'PATIENT' : 'ADMIN');

          (socket as any).relationId = relationId;
          (socket as any).userId = verifiedUserId;
          (socket as any).userName = userName;
          (socket as any).userRole = userRole;
          (socket as any).tokenExp = tokenPayload.exp;
        } else {
          // Notification connection - verified user in database
          (socket as any).relationId = undefined;
          (socket as any).userId = verifiedUserId;
          (socket as any).userRole = user.role;
          (socket as any).userName = user.name;
          (socket as any).tokenExp = tokenPayload.exp;
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
      const tokenExp = (socket as any).tokenExp;

      // Always join user's own private notification room
      socket.join(`user_${userId}`);

      // Handle connected socket ticket expiration
      if (tokenExp && typeof tokenExp === 'number') {
        const msUntilExpiry = tokenExp * 1000 - Date.now();
        if (msUntilExpiry > 0) {
          const expiryTimer = setTimeout(() => {
            socket.emit('auth_expired', { message: 'Authentication ticket expired' });
            socket.disconnect(true);
          }, msUntilExpiry);
          (socket as any).expiryTimer = expiryTimer;
        }
      }

      // Handle re-authentication before or after ticket refresh
      this.handleReauthentication(socket, userId, relationId);

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

      // Handle sync/missed-message recovery
      this.handleSyncMessages(socket, relationId);

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
   * Handle in-flight re-authentication ticket refresh
   */
  private handleReauthentication(socket: Socket, currentUserId: string, currentRelationId?: string): void {
    socket.on('reauthenticate', async (data: { token?: string }, callback?: (ack: any) => void) => {
      try {
        if (!data?.token || typeof data.token !== 'string') {
          const errRes = { success: false, error: 'Missing token' };
          if (typeof callback === 'function') callback(errRes);
          return;
        }

        const authResult = verifySocketJWT(data.token, this.jwtSecret);
        if (!authResult.valid || !authResult.payload) {
          const errRes = { success: false, error: authResult.error || 'Authentication failed' };
          if (typeof callback === 'function') callback(errRes);
          return;
        }

        const freshUserId = authResult.payload.id || authResult.payload.userId;
        if (freshUserId !== currentUserId) {
          const errRes = { success: false, error: 'Cannot switch user identity on connected socket' };
          if (typeof callback === 'function') callback(errRes);
          return;
        }

        if (currentRelationId && authResult.payload.relationId && authResult.payload.relationId !== currentRelationId) {
          const errRes = { success: false, error: 'Relation mismatch in fresh ticket' };
          if (typeof callback === 'function') callback(errRes);
          return;
        }

        // Reset expiry timer
        if ((socket as any).expiryTimer) {
          clearTimeout((socket as any).expiryTimer);
        }

        const newExpMs = authResult.payload.exp! * 1000 - Date.now();
        if (newExpMs > 0) {
          (socket as any).expiryTimer = setTimeout(() => {
            socket.emit('auth_expired', { message: 'Authentication ticket expired' });
            socket.disconnect(true);
          }, newExpMs);
        }

        const okRes = { success: true, exp: authResult.payload.exp };
        if (typeof callback === 'function') callback(okRes);
        socket.emit('reauthenticated', okRes);
      } catch (err: any) {
        const errRes = { success: false, error: 'Reauthentication failed' };
        if (typeof callback === 'function') callback(errRes);
      }
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
    socket.on('get_initial_messages', async (data: { page?: number; limit?: number }, callback?: (ack: any) => void) => {
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
          ...(msg.clientMessageId ? { clientMessageId: msg.clientMessageId } : {}),
          text: msg.text,
          senderId: msg.senderId,
          senderName: msg.sender?.name,
          senderRole: msg.sender?.role,
          createdAt: msg.createdAt instanceof Date ? msg.createdAt.toISOString() : String(msg.createdAt),
          ...(msg.isRead !== undefined ? { isRead: Boolean(msg.isRead) } : {}),
          ...(msg.readAt !== undefined ? { readAt: msg.readAt instanceof Date ? msg.readAt.toISOString() : String(msg.readAt) } : {}),
        }));

        const responsePayload = {
          messages: formattedMessages,
          pagination: {
            page,
            limit,
            total: totalCount,
            hasMore: skip + limit < totalCount,
          },
        };

        if (typeof callback === 'function') {
          callback({ success: true, ...responsePayload });
        }
        socket.emit('initial_messages', responsePayload);
      } catch (error) {
        console.error('Error fetching initial messages:', error);
        if (typeof callback === 'function') {
          callback({ success: false, error: 'Failed to load messages' });
        }
        socket.emit('error', { message: 'Failed to load messages' });
      }
    });
  }

  /**
   * Handle sync / missed-message recovery across disconnections
   */
  private handleSyncMessages(socket: Socket, relationId: string): void {
    socket.on('sync_messages', async (data: { since?: string; lastMessageId?: string; limit?: number }, callback?: (ack: any) => void) => {
      try {
        if (!relationId) {
          const errRes = { success: false, error: 'Unauthorized: not connected to a chat room', messages: [] };
          if (typeof callback === 'function') callback(errRes);
          return socket.emit('error', { message: 'Unauthorized: not connected to a chat room' });
        }

        const limit = Math.min(Math.max(1, data?.limit || 100), 100);
        let whereClause: any = { doctorPatientRelationId: relationId };

        if (data?.since) {
          const sinceDate = new Date(data.since);
          if (!isNaN(sinceDate.getTime())) {
            if (data.lastMessageId && typeof data.lastMessageId === 'string' && data.lastMessageId.trim()) {
              whereClause = {
                doctorPatientRelationId: relationId,
                OR: [
                  { createdAt: { gt: sinceDate } },
                  { AND: [{ createdAt: sinceDate }, { id: { gt: data.lastMessageId.trim() } }] },
                ],
              };
            } else {
              whereClause = {
                doctorPatientRelationId: relationId,
                createdAt: { gt: sinceDate },
              };
            }
          }
        }

        const messages = await this.prisma.chatMessages.findMany({
          where: whereClause,
          include: {
            sender: { select: { id: true, name: true, role: true } },
          },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          take: limit,
        });

        const formatted = messages.map(formatChatMessage);
        const result = {
          success: true,
          messages: formatted,
          hasMore: messages.length === limit,
        };

        if (typeof callback === 'function') {
          callback(result);
        }
        socket.emit('sync_messages_result', result);
      } catch (err: any) {
        console.error('Error syncing messages:', err);
        const errRes = { success: false, error: 'Failed to sync messages', messages: [] };
        if (typeof callback === 'function') callback(errRes);
        socket.emit('error', { message: 'Failed to sync messages' });
      }
    });
  }

  /**
   * Handle sending new message with typed acknowledgement, deduplication, and single broadcast
   */
  private handleSendMessage(socket: Socket, relationId: string, userId: string, _userName: string): void {
    socket.on('send_message', async (data: any, callback?: (ack: any) => void) => {
      try {
        if (!relationId) {
          const errRes = { success: false, error: 'Unauthorized: not connected to a chat room' };
          if (typeof callback === 'function') callback(errRes);
          return socket.emit('error', { message: 'Unauthorized: not connected to a chat room' });
        }

        if (!this.rateLimiter.check(`msg_${socket.id}`, 30, 60_000)) {
          const errRes = { success: false, error: 'Rate limit exceeded: maximum 30 messages per minute' };
          if (typeof callback === 'function') callback(errRes);
          return socket.emit('error', { message: 'Rate limit exceeded: maximum 30 messages per minute' });
        }

        if (!data || typeof data !== 'object') {
          const errRes = { success: false, error: 'Invalid message payload' };
          if (typeof callback === 'function') callback(errRes);
          return socket.emit('error', { message: 'Invalid message payload' });
        }

        const rawText = data.text !== undefined ? data.text : data.message;
        const clientMessageId = data.clientMessageId !== undefined ? data.clientMessageId : data.idempotencyKey;

        // Persist using shared canonical persistence service
        const result = await persistChatMessage({
          doctorPatientRelationId: relationId,
          senderId: userId,
          text: rawText,
          clientMessageId,
          prismaClient: this.prisma,
          includeSender: true,
          skipRelationCheck: true,
        });

        if (!result.success) {
          const errRes = { success: false, error: result.error || 'Failed to send message' };
          if (typeof callback === 'function') callback(errRes);
          return socket.emit('error', { message: result.error || 'Failed to send message' });
        }

        const formattedMessage: FormattedChatMessage = result.chat;

        // Acknowledge sending client FIRST with canonical stored message
        if (typeof callback === 'function') {
          callback({ success: true, message: formattedMessage });
        }

        // Only broadcast if this was an original new message (do NOT produce duplicate room broadcasts on replay)
        if (!result.isDuplicate) {
          this.io.to(`relation_${relationId}`).emit('new_message', {
            message: formattedMessage,
          });
        }
      } catch (error) {
        console.error('Error saving message:', error);
        const errRes = { success: false, error: 'Failed to send message' };
        if (typeof callback === 'function') callback(errRes);
        socket.emit('error', { message: 'Failed to send message' });
      }
    });
  }

  /**
   * Handle typing indicator with throttling
   */
  private handleTypingIndicator(
    socket: Socket,
    relationId: string,
    userId: string,
    userName: string,
    userRole: string
  ): void {
    socket.on('user_typing', () => {
      if (!this.rateLimiter.check(`typing_${socket.id}`, 1, 1500)) {
        return; // Throttled
      }
      socket.to(`relation_${relationId}`).emit('user_typing', {
        userId,
        userName,
        userRole,
      });
    });

    socket.on('user_stop_typing', () => {
      socket.to(`relation_${relationId}`).emit('user_stop_typing', {
        userId,
      });
    });
  }

  /**
   * Handle message read status with monotonic cursor update and cross-device sync
   */
  private handleMarkAsRead(socket: Socket, relationId: string, userId: string): void {
    socket.on('mark_as_read', async (data: { messageId?: string; lastReadAt?: string }, callback?: (ack: any) => void) => {
      try {
        if (!relationId) return;
        if (!data || typeof data !== 'object') return;
        const messageId = typeof data.messageId === 'string' ? data.messageId.trim() : null;

        let targetMessage: any = null;
        if (messageId) {
          targetMessage = await this.prisma.chatMessages.findUnique({
            where: { id: messageId },
            select: { id: true, doctorPatientRelationId: true, senderId: true, createdAt: true },
          });
        } else if (data.lastReadAt) {
          const d = new Date(data.lastReadAt);
          if (!isNaN(d.getTime())) {
            targetMessage = await this.prisma.chatMessages.findFirst({
              where: { doctorPatientRelationId: relationId, createdAt: { lte: d } },
              orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
              select: { id: true, doctorPatientRelationId: true, senderId: true, createdAt: true },
            });
          }
        }

        if (!targetMessage || targetMessage.doctorPatientRelationId !== relationId) {
          return;
        }

        // Users do not mark their own messages as read
        if (targetMessage.senderId === userId) {
          return;
        }

        const now = new Date();

        // Monotonically mark all unread messages up to targetMessage.createdAt
        if (typeof this.prisma.chatMessages?.updateMany === 'function') {
          await this.prisma.chatMessages.updateMany({
            where: {
              doctorPatientRelationId: relationId,
              senderId: { not: userId },
              createdAt: { lte: targetMessage.createdAt || now },
              isRead: false,
            },
            data: {
              isRead: true,
              readAt: now,
            },
          }).catch(() => undefined);
        }

        // Update conversation monotonic read cursor on DoctorPatientRelation
        const isDoctor = (socket as any).userRole === 'DOCTOR';
        if (typeof this.prisma.doctorPatientRelation?.updateMany === 'function') {
          if (isDoctor) {
            await this.prisma.doctorPatientRelation.updateMany({
              where: {
                id: relationId,
                OR: [{ doctorLastReadAt: null }, { doctorLastReadAt: { lt: targetMessage.createdAt || now } }],
              },
              data: { doctorLastReadAt: targetMessage.createdAt || now },
            }).catch(() => undefined);
          } else {
            await this.prisma.doctorPatientRelation.updateMany({
              where: {
                id: relationId,
                OR: [{ patientLastReadAt: null }, { patientLastReadAt: { lt: targetMessage.createdAt || now } }],
              },
              data: { patientLastReadAt: targetMessage.createdAt || now },
            }).catch(() => undefined);
          }
        }

        const receiptPayload = {
          messageId: targetMessage.id,
          readBy: userId,
        };

        // Broadcast to conversation room (counterparty)
        socket.to(`relation_${relationId}`).emit('message_read', receiptPayload);

        // Synchronize this user's other open tabs/devices if available
        try {
          socket.to(`user_${userId}`).emit('message_read', { ...receiptPayload, relationId });
        } catch {}

        if (typeof callback === 'function') {
          callback({ success: true, ...receiptPayload, relationId, readAt: now.toISOString() });
        }
      } catch (error) {
        console.error('Error marking message as read:', error);
      }
    });
  }

  /**
   * Handle socket disconnect and cleanup
   */
  private handleDisconnect(socket: Socket, _userName: string, relationId: string, userId: string): void {
    socket.on('disconnect', () => {
      if ((socket as any).expiryTimer) {
        clearTimeout((socket as any).expiryTimer);
      }
      this.rateLimiter.clear(`msg_${socket.id}`);
      this.rateLimiter.clear(`typing_${socket.id}`);
      socket.leave(`user_${userId}`);
      if (relationId) {
        socket.to(`relation_${relationId}`).emit('user_stop_typing', { userId });
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
