import { Redis } from "@upstash/redis";

let redis: Redis | undefined;

function getRedis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  try {
    redis ??= new Redis({ url, token });
    return redis;
  } catch {
    return null;
  }
}

// In-memory fallbacks
const activeLocks = new Map<string, number>(); // conversationId -> expiresAt
const seenIdempotencyKeys = new Map<string, number>(); // key -> expiresAt

/**
 * Acquires an exclusive generation lock on a medical conversation to prevent
 * simultaneous AI generation streams/messages for the same conversation.
 */
export async function acquireConversationLock(
  conversationId: string,
  ttlSeconds: number = 60
): Promise<boolean> {
  const client = getRedis();
  const now = Date.now();

  if (client) {
    try {
      const lockKey = `chat:lock:${conversationId}`;
      const res = await client.set(lockKey, "1", { nx: true, ex: ttlSeconds });
      return res === "OK";
    } catch (e) {
      console.warn("Redis acquireConversationLock failed, falling back to memory:", e);
    }
  }

  // In-memory fallback
  const expiresAt = activeLocks.get(conversationId);
  if (expiresAt && expiresAt > now) {
    return false;
  }

  activeLocks.set(conversationId, now + ttlSeconds * 1000);
  return true;
}

/**
 * Releases the exclusive generation lock on a medical conversation.
 */
export async function releaseConversationLock(conversationId: string): Promise<void> {
  const client = getRedis();
  if (client) {
    try {
      await client.del(`chat:lock:${conversationId}`);
    } catch (e) {
      console.warn("Redis releaseConversationLock failed:", e);
    }
  }
  activeLocks.delete(conversationId);
}

/**
 * Checks and sets an idempotency key for client-submitted chat messages.
 * Returns true if unique (allowed to proceed), false if duplicate.
 */
export async function checkAndSetMessageIdempotency(
  conversationId: string,
  clientMessageId: string,
  ttlSeconds: number = 60
): Promise<boolean> {
  if (!clientMessageId) return true;

  const client = getRedis();
  const now = Date.now();
  const fullKey = `chat:idempotency:${conversationId}:${clientMessageId}`;

  if (client) {
    try {
      const res = await client.set(fullKey, "1", { nx: true, ex: ttlSeconds });
      return res === "OK";
    } catch (e) {
      console.warn("Redis idempotency check failed, falling back to memory:", e);
    }
  }

  // In-memory fallback
  const expiresAt = seenIdempotencyKeys.get(fullKey);
  if (expiresAt && expiresAt > now) {
    return false;
  }

  seenIdempotencyKeys.set(fullKey, now + ttlSeconds * 1000);
  return true;
}

/**
 * Clears in-memory locks and idempotency records (for tests).
 */
export function clearInMemoryChatGuards(): void {
  activeLocks.clear();
  seenIdempotencyKeys.clear();
}
