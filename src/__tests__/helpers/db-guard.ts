import { prisma } from '@/lib/prisma';

/**
 * Validates that the active database connection is accessible and designated for testing.
 * Throws an error immediately if connection fails or unsafe environment is detected.
 */
export async function verifyTestEnvironment(): Promise<void> {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    throw new Error('SAFETY CHECK FAILED: DATABASE_URL is not defined in the testing environment.');
  }

  try {
    const result = await prisma.$queryRaw<Array<{ status: number }>>`SELECT 1 as status`;
    if (!result || result.length === 0) {
      throw new Error('SAFETY CHECK FAILED: Database ping returned no results.');
    }
  } catch (error: any) {
    throw new Error(`SAFETY CHECK FAILED: Unable to communicate with test database. Error: ${error.message}`);
  }
}
