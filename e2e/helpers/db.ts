import { PrismaClient } from "../../src/generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
const url = process.env.QC_TEST_DATABASE_URL;
if (!url || !new URL(url.replace("postgresql+asyncpg:", "postgresql:")).pathname.toLowerCase().includes("test")) {
  throw new Error("Browser database fixtures require QC_TEST_DATABASE_URL pointing at a disposable test database");
}
const connectionString = url.replace("postgresql+asyncpg:", "postgresql:");
export const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
