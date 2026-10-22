import { Redis } from "@upstash/redis";

let redis: Redis | undefined;
let redisCircuitBreakerUntil = 0;
const REDIS_FAILOVER_COOLDOWN_MS = 30_000; // 30-second circuit breaker cooldown on Redis/DNS failure

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

// In-memory sliding window fallback
const memoryStore = new Map<string, { count: number; resetAt: number }>();

function pruneMemoryStore(now: number): void {
  if (memoryStore.size > 1000) {
    for (const [k, v] of memoryStore.entries()) {
      if (v.resetAt <= now) {
        memoryStore.delete(k);
      }
    }
  }
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetSeconds: number;
}

export type DoctorMedicalEndpoint =
  | "answer"
  | "search"
  | "chat"
  | "stream"
  | "observations";

const ENDPOINT_LIMITS: Record<DoctorMedicalEndpoint, { limit: number; windowSeconds: number }> = {
  answer: { limit: 20, windowSeconds: 60 },
  search: { limit: 30, windowSeconds: 60 },
  chat: { limit: 20, windowSeconds: 60 },
  stream: { limit: 20, windowSeconds: 60 },
  observations: { limit: 40, windowSeconds: 60 },
};

/**
 * Checks and increments rate limit for a specific key.
 * Backed by Redis with instantaneous in-memory fallback on DNS or network failure.
 */
export async function checkRateLimit(
  key: string,
  limit: number,
  windowSeconds: number
): Promise<RateLimitResult> {
  const now = Date.now();
  const isCircuitOpen = now < redisCircuitBreakerUntil;

  if (!isCircuitOpen) {
    const client = getRedis();
    if (client) {
      try {
        const fullKey = `ratelimit:${key}`;
        const count = await client.incr(fullKey);
        if (count === 1) {
          await client.expire(fullKey, windowSeconds);
        }
        const ttl = await client.ttl(fullKey);
        const resetSeconds = ttl > 0 ? ttl : windowSeconds;
        const allowed = count <= limit;
        const remaining = Math.max(0, limit - count);

        return { allowed, limit, remaining, resetSeconds };
      } catch (e: any) {
        // Trip circuit breaker immediately on DNS or network failure to prevent multi-second request stalls
        redisCircuitBreakerUntil = Date.now() + REDIS_FAILOVER_COOLDOWN_MS;
        console.warn(`[RateLimiter] Upstash Redis unavailable (circuit open for 30s): ${e?.message || e}`);
      }
    }
  }

  // In-memory fallback
  pruneMemoryStore(now);
  const entry = memoryStore.get(key);
  if (!entry || entry.resetAt <= now) {
    memoryStore.set(key, { count: 1, resetAt: now + windowSeconds * 1000 });
    return {
      allowed: true,
      limit,
      remaining: limit - 1,
      resetSeconds: windowSeconds,
    };
  }

  entry.count += 1;
  const resetSeconds = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
  const allowed = entry.count <= limit;
  const remaining = Math.max(0, limit - entry.count);

  return { allowed, limit, remaining, resetSeconds };
}

/**
 * Enforces doctor-level rate limits across medical AI and retrieval endpoints.
 * Keyed by authenticated doctor ID + endpoint (not patient ID).
 */
export async function checkDoctorMedicalRateLimit(
  doctorId: string,
  endpoint: DoctorMedicalEndpoint
): Promise<RateLimitResult> {
  const config = ENDPOINT_LIMITS[endpoint] || { limit: 20, windowSeconds: 60 };
  const key = `doctor:${doctorId}:${endpoint}`;
  return checkRateLimit(key, config.limit, config.windowSeconds);
}

/**
 * Clears in-memory rate limit counters and circuit breaker (useful for unit and integration testing).
 */
export function clearInMemoryRateLimits(): void {
  memoryStore.clear();
  redisCircuitBreakerUntil = 0;
}

export function isRedisCircuitBreakerOpen(): boolean {
  return Date.now() < redisCircuitBreakerUntil;
}

export function tripRedisCircuitBreaker(durationMs = REDIS_FAILOVER_COOLDOWN_MS): void {
  redisCircuitBreakerUntil = Date.now() + durationMs;
}
