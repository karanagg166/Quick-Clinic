export interface PersistChatMessageInput {
  doctorPatientRelationId: string;
  senderId: string;
  text: unknown;
  clientMessageId?: unknown;
  isAdmin?: boolean;
  prismaClient: any;
  includeSender?: boolean;
  skipRelationCheck?: boolean;
}

export interface FormattedChatMessage {
  id: string;
  clientMessageId: string;
  text: string;
  senderId: string;
  senderName?: string;
  senderRole?: string;
  isRead: boolean;
  readAt?: string | null;
  createdAt: string;
}

export interface PersistChatMessageResult {
  success: boolean;
  chat?: FormattedChatMessage | any;
  isDuplicate?: boolean;
  error?: string;
  statusCode: number;
}

export function formatChatMessage(msg: any): FormattedChatMessage {
  const formatted: any = {
    id: msg.id,
    clientMessageId: msg.clientMessageId || msg.id,
    text: msg.text,
    senderId: msg.senderId,
    senderName: msg.sender?.name || undefined,
    senderRole: msg.sender?.role || undefined,
    createdAt: msg.createdAt instanceof Date ? msg.createdAt.toISOString() : String(msg.createdAt),
  };
  if (msg.isRead !== undefined) {
    formatted.isRead = Boolean(msg.isRead);
  }
  if (msg.readAt !== undefined) {
    formatted.readAt = msg.readAt ? (msg.readAt instanceof Date ? msg.readAt.toISOString() : String(msg.readAt)) : null;
  }
  return formatted;
}

/**
 * Canonical persistence contract for chat messages.
 * Shared across Next.js REST API routes and Socket.IO server.
 * Enforces relation authorization, content validation, idempotency,
 * and concurrent collision handling using database unique constraints.
 */
export async function persistChatMessage({
  doctorPatientRelationId,
  senderId,
  text,
  clientMessageId,
  isAdmin = false,
  prismaClient,
  includeSender = true,
  skipRelationCheck = false,
}: PersistChatMessageInput): Promise<PersistChatMessageResult> {
  const db = prismaClient;
  if (!db) {
    return { success: false, error: "Database client is not available", statusCode: 500 };
  }

  // 1. Validate relationId
  if (!doctorPatientRelationId || typeof doctorPatientRelationId !== "string" || !doctorPatientRelationId.trim()) {
    return { success: false, error: "Missing relationId", statusCode: 400 };
  }

  // 2. Validate text type and content
  if (text === undefined || text === null || typeof text !== "string") {
    return { success: false, error: "message and senderId are required", statusCode: 400 };
  }

  const trimmedText = text.trim();
  if (!trimmedText) {
    return { success: false, error: "Message cannot be empty", statusCode: 400 };
  }

  if (trimmedText.length > 5000) {
    return {
      success: false,
      error: "Message exceeds maximum length of 5000 characters",
      statusCode: 400,
    };
  }

  // 3. Normalize clientMessageId
  let normalizedClientMessageId: string | null = null;
  if (clientMessageId !== undefined && clientMessageId !== null) {
    if (typeof clientMessageId !== "string") {
      return { success: false, error: "clientMessageId must be a string", statusCode: 400 };
    }
    const trimmedId = clientMessageId.trim();
    if (trimmedId) {
      if (trimmedId.length > 128) {
        return { success: false, error: "clientMessageId exceeds maximum length of 128 characters", statusCode: 400 };
      }
      normalizedClientMessageId = trimmedId;
    }
  }

  // 4. Authoritative check: relation membership (if not already verified at connection handshake)
  if (!skipRelationCheck && typeof db.doctorPatientRelation?.findUnique === "function") {
    const relation = await db.doctorPatientRelation.findUnique({
      where: { id: doctorPatientRelationId },
    });

    if (!relation) {
      return { success: false, error: "Relation not found", statusCode: 404 };
    }

    const isMember =
      isAdmin ||
      relation.doctorsUserId === senderId ||
      relation.patientsUserId === senderId ||
      relation.doctor?.user?.id === senderId ||
      relation.patient?.user?.id === senderId;

    if (!isMember) {
      return { success: false, error: "Forbidden", statusCode: 403 };
    }
  }

  const includeConfig = includeSender
    ? { sender: { select: { id: true, name: true, role: true } } }
    : undefined;

  // 5. Deduplication pre-check
  if (normalizedClientMessageId && typeof db.chatMessages?.findFirst === "function") {
    const existing = await db.chatMessages.findFirst({
      where: {
        OR: [
          { clientMessageId: normalizedClientMessageId },
          { id: normalizedClientMessageId },
        ],
      },
      include: includeConfig,
    });

    if (existing) {
      // Must not reveal messages from another relation
      if (existing.doctorPatientRelationId !== doctorPatientRelationId) {
        return {
          success: false,
          error: "Idempotency key does not belong to this relation",
          statusCode: 403,
        };
      }
      if (existing.senderId !== senderId) {
        return {
          success: false,
          error: "Conflicting reuse of clientMessageId with different sender",
          statusCode: 409,
        };
      }
      if (existing.text !== trimmedText) {
        return {
          success: false,
          error: "Conflicting reuse of clientMessageId with different content",
          statusCode: 409,
        };
      }
      return {
        success: true,
        chat: formatChatMessage(existing),
        isDuplicate: true,
        statusCode: 200,
      };
    }
  }

  // 6. Persist with race condition handling
  try {
    const createData: Record<string, any> = {
      ...(normalizedClientMessageId
        ? { id: normalizedClientMessageId, clientMessageId: normalizedClientMessageId }
        : {}),
      doctorPatientRelationId,
      text: trimmedText,
      senderId,
    };

    const newChat = await db.chatMessages.create({
      data: createData,
      include: includeConfig,
    });

    return {
      success: true,
      chat: formatChatMessage(newChat),
      isDuplicate: false,
      statusCode: 201,
    };
  } catch (error: unknown) {
    // Concurrent insert collision on unique constraint (P2002)
    const errObj = error as { code?: string } | null;
    if (errObj?.code === "P2002" && normalizedClientMessageId && typeof db.chatMessages?.findFirst === "function") {
      const existing = await db.chatMessages.findFirst({
        where: {
          OR: [
            { clientMessageId: normalizedClientMessageId },
            { id: normalizedClientMessageId },
          ],
        },
        include: includeConfig,
      });

      if (existing) {
        if (existing.doctorPatientRelationId !== doctorPatientRelationId) {
          return {
            success: false,
            error: "Idempotency key does not belong to this relation",
            statusCode: 403,
          };
        }
        if (existing.senderId !== senderId) {
          return {
            success: false,
            error: "Conflicting reuse of clientMessageId with different sender",
            statusCode: 409,
          };
        }
        if (existing.text !== trimmedText) {
          return {
            success: false,
            error: "Conflicting reuse of clientMessageId with different content",
            statusCode: 409,
          };
        }
        return {
          success: true,
          chat: formatChatMessage(existing),
          isDuplicate: true,
          statusCode: 200,
        };
      }
    }

    console.error("Error creating chat message in DB:", error);
    return { success: false, error: "Failed to send message", statusCode: 500 };
  }
}
