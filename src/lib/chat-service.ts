import { prisma } from "@/lib/prisma";

type PrismaClientInstance = typeof prisma;

export interface PersistChatMessageInput {
  doctorPatientRelationId: string;
  senderId: string;
  text: unknown;
  clientMessageId?: unknown;
  isAdmin?: boolean;
  prismaClient?: PrismaClientInstance;
  includeSender?: boolean;
}

export interface PersistChatMessageResult {
  success: boolean;
  chat?: unknown;
  isDuplicate?: boolean;
  error?: string;
  statusCode: number;
}

/**
 * Canonical persistence contract for chat messages.
 * Enforces relation membership, input type validation, idempotency,
 * and concurrent race handling using database unique constraints.
 */
export async function persistChatMessage({
  doctorPatientRelationId,
  senderId,
  text,
  clientMessageId,
  isAdmin = false,
  prismaClient = prisma,
  includeSender = false,
}: PersistChatMessageInput): Promise<PersistChatMessageResult> {
  const db = (prismaClient || prisma) as PrismaClientInstance;
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
    return { success: false, error: "message and senderId are required", statusCode: 400 };
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
      normalizedClientMessageId = trimmedId;
    }
  }

  // 4. Authoritative check: relation membership
  const relation = await db.doctorPatientRelation.findUnique({
    where: { id: doctorPatientRelationId },
  });

  if (!relation) {
    return { success: false, error: "Relation not found", statusCode: 404 };
  }

  const isMember =
    isAdmin ||
    relation.doctorsUserId === senderId ||
    relation.patientsUserId === senderId;

  if (!isMember) {
    return { success: false, error: "Forbidden", statusCode: 403 };
  }

  // 5. Deduplication pre-check
  if (normalizedClientMessageId) {
    const findArgs: Record<string, unknown> = {
      where: {
        OR: [
          { clientMessageId: normalizedClientMessageId },
          { id: normalizedClientMessageId },
        ],
      },
    };
    if (includeSender) {
      findArgs.include = {
        sender: {
          select: { id: true, name: true, role: true },
        },
      };
    }
    const existing = await (db.chatMessages.findFirst as any)(findArgs);

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
      return { success: true, chat: existing, isDuplicate: true, statusCode: 200 };
    }
  }

  // 6. Persist with race condition handling
  try {
    const createArgs: Record<string, unknown> = {
      data: {
        ...(normalizedClientMessageId
          ? { id: normalizedClientMessageId, clientMessageId: normalizedClientMessageId }
          : {}),
        doctorPatientRelationId,
        text: trimmedText,
        senderId,
      },
    };
    if (includeSender) {
      createArgs.include = {
        sender: {
          select: { id: true, name: true, role: true },
        },
      };
    }
    const newChat = await (db.chatMessages.create as any)(createArgs);

    return { success: true, chat: newChat, isDuplicate: false, statusCode: 201 };
  } catch (error: unknown) {
    // Concurrent insert collision on unique constraint (P2002)
    const errObj = error as { code?: string } | null;
    if (errObj?.code === "P2002" && normalizedClientMessageId) {
      const collisionArgs: Record<string, unknown> = {
        where: {
          OR: [
            { clientMessageId: normalizedClientMessageId },
            { id: normalizedClientMessageId },
          ],
        },
      };
      if (includeSender) {
        collisionArgs.include = {
          sender: {
            select: { id: true, name: true, role: true },
          },
        };
      }
      const existing = await (db.chatMessages.findFirst as any)(collisionArgs);

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
        return { success: true, chat: existing, isDuplicate: true, statusCode: 200 };
      }
    }

    console.error("Error creating chat message in DB:", error);
    return { success: false, error: "Internal Server Error", statusCode: 500 };
  }
}
