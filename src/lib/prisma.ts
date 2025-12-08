import { PrismaClient } from "../generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import 'dotenv/config';

const globalForPrisma = globalThis as any;

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL is not set in environment variables');
}

const adapter = new PrismaPg({ connectionString });

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === 'development' && process.env.DEBUG?.includes('prisma') ? ['query'] : []
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
