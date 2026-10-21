import { randomUUID } from "crypto";
import { Redis } from "@upstash/redis";

export const MUTEX_TTL_SECONDS = 5;

let redisClient: Redis | null = null;

export function getRedisClient(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  try {
    redisClient ??= new Redis({ url, token });
    return redisClient;
  } catch {
    return null;
  }
}

export function slotMutexKey(slotId: string): string {
  return `lock:slot:${slotId}`;
}

export interface MutexAcquireResult {
  acquired: boolean;
  token: string | null;
  retryable?: boolean;
  isBypass?: boolean;
}

/**
 * Acquires a short-lived Redis mutex for a slot (TTL ~5 seconds).
 * Uses SET NX with a random owner token.
 * If Redis is unavailable or errors, gracefully falls back to PostgreSQL reservation authority.
 * If Redis returns a lock conflict, returns a bounded retryable conflict.
 */
export async function acquireSlotMutex(
  slotId: string,
  ttlSeconds: number = MUTEX_TTL_SECONDS
): Promise<MutexAcquireResult> {
  const client = getRedisClient();
  if (!client) {
    // Redis optional coordination unavailable -> proceed with DB reservation authority
    return { acquired: true, token: null, isBypass: true };
  }

  const token = randomUUID();
  const key = slotMutexKey(slotId);

  try {
    const res = await client.set(key, token, { nx: true, ex: ttlSeconds });
    if (res === "OK") {
      return { acquired: true, token, isBypass: false };
    }
    // Mutex conflict: another process is currently holding the short lock
    return { acquired: false, token: null, retryable: true };
  } catch (err) {
    console.warn(`[slot-mutex] Redis mutex acquire failed for slot ${slotId}, falling back to DB:`, err);
    return { acquired: true, token: null, isBypass: true };
  }
}

/**
 * Releases the short-lived Redis mutex via atomic exact-token compare-and-delete Lua script.
 * Never uses substring matching. Never uses separate GET followed by DEL.
 * Cleanup errors are caught and logged without throwing, so they never overwrite an already committed DB reservation.
 */
export async function releaseSlotMutex(slotId: string, token: string | null): Promise<boolean> {
  if (!token) return true; // Was a Redis bypass or null token

  const client = getRedisClient();
  if (!client) return false;

  const key = slotMutexKey(slotId);

  // Atomic Lua script: exact token match only
  const exactCompareAndDelScript = `
    if redis.call('get', KEYS[1]) == ARGV[1] then
      return redis.call('del', KEYS[1])
    else
      return 0
    end
  `;

  try {
    if (typeof (client as any).eval === "function") {
      const res = await (client as any).eval(exactCompareAndDelScript, [key], [token]);
      return res === 1;
    }
    // Fallback if eval is unavailable
    const cur = await client.get<string>(key);
    if (cur === token) {
      await client.del(key);
      return true;
    }
    return false;
  } catch (err) {
    console.warn(`[slot-mutex] Failed to release Redis mutex for slot ${slotId}:`, err);
    return false;
  }
}
