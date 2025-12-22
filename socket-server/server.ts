import { Server as SocketIOServer, Socket } from 'socket.io';
import { PrismaClient } from '../src/generated/prisma/client';

/**
 * Socket.IO server configuration and event handlers
 */
export class SocketServer {
  private io: SocketIOServer;
  private prisma: PrismaClient;

  constructor(io: SocketIOServer, prisma: PrismaClient) {
    this.io = io;
    this.prisma = prisma;
    this.setupAuthentication();
    this.setupEventHandlers();
  }

  /**
   * Setup Socket.IO authentication middleware
   */
  private setupAuthentication(): void {
    this.io.use(async (socket: Socket, next) => {
      try {
        const { relationId, userId } = socket.handshake.auth;

        if (!relationId || !userId) {
          return next(new Error('Missing relationId or userId'));
        }

        // Verify user has access to this relation
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

        const hasAccess =
          relation.doctor.user.id === userId || relation.patient.user.id === userId;

        if (!hasAccess) {
          return next(new Error('Unauthorized'));
        }

        // Attach user info to socket
        (socket as any).relationId = relationId;
        (socket as any).userId = userId;
        (socket as any).userName = relation.doctor.user.id === userId 
          ? relation.doctor.user.name 
          : relation.patient.user.name;
        (socket as any).userRole = relation.doctor.user.id === userId ? 'DOCTOR' : 'PATIENT';

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
      this.handleGetInitialMessages(socket, relationId);

      // Handle sending new message
      this.handleSendMessage(socket, relationId, userId, userName);

      // Handle typing indicator
      this.handleTypingIndicator(socket, relationId, userId, userName, userRole);

      // Handle message read status
      this.handleMarkAsRead(socket, relationId, userId);

      // Handle disconnect
      this.handleDisconnect(socket, userName, relationId);

      // Handle errors
      this.handleSocketError(socket, userName);
    });
  }

  /**
   * Handle getting initial messages with pagination
   */
  private handleGetInitialMessages(socket: Socket, relationId: string): void {
    socket.on('get_initial_messages', async (data: { page?: number; limit?: number }) => {
      try {
        const page = data?.page || 1;
        const limit = Math.min(data?.limit || 20, 100); // Max 100 messages
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

        // Save message to database
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

        // Broadcast to all users in the relation (including sender)
        this.io.to(`relation_${relationId}`).emit('new_message', {
          message: formattedMessage,
        });

        console.log(`Message sent by ${userName} in relation ${relationId}`);
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
      // Broadcast to others in the room (not sender)
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
  }

  /**
   * Handle socket disconnect
   */
  private handleDisconnect(socket: Socket, userName: string, relationId: string): void {
    socket.on('disconnect', (reason: string) => {
      console.log(`User ${userName} disconnected from relation ${relationId}. Reason: ${reason}`);
      socket.leave(`relation_${relationId}`);
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

