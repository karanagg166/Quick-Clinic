import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";
import "dotenv/config";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is not set in environment variables");
}

const poolMax = process.env.DB_POOL_MAX ? parseInt(process.env.DB_POOL_MAX, 10) : 5;

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter: new PrismaPg({
      connectionString,
      max: poolMax,
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 15000,
    }),
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : [],
  });

// Always cache on globalThis to prevent multiple pool instances across warm serverless lambdas
globalForPrisma.prisma = prisma;

/**
 * Validates active database connectivity with bounded timeout.
 * Tolerates Neon scale-to-zero wake-up latency (up to 7s).
 */
export async function checkDatabaseReadiness(
  timeoutMs = 7000
): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const start = Date.now();
  let timer: NodeJS.Timeout | null = null;
  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`Database check timed out after ${timeoutMs}ms`)),
        timeoutMs
      );
    });
    const queryPromise = (prisma as any).$queryRaw`SELECT 1`;
    queryPromise.catch(() => {});
    await Promise.race([queryPromise, timeoutPromise]);
    return { ok: true, latencyMs: Date.now() - start };
  } catch (err: any) {
    return {
      ok: false,
      latencyMs: Date.now() - start,
      error: err?.message || String(err),
    };
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}


