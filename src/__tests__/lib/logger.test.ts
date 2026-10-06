import { test, expect, beforeEach, afterEach } from "vitest";
import { logAudit, logAccess } from "@/lib/logger";
import { prisma } from "@/lib/prisma";

import { createTestUser, cleanupTestUsers } from "@/__tests__/helpers/user-fixtures";

let user: Awaited<ReturnType<typeof createTestUser>>;
beforeEach(async () => { user = await createTestUser(); });
afterEach(async () => { if (user) await cleanupTestUsers([user.id]); });

test("logAudit - creates audit log record in database", async () => {

  await logAudit(user?.id, "Test Audit Action", { testKey: "testValue" }, "SECURITY");

  const log = await prisma.auditLog.findFirst({
    where: { userId: user.id, action: "Test Audit Action" },
    orderBy: { createdAt: "desc" },
  });

  expect(log).toBeDefined();
  expect(log?.tag).toBe("SECURITY");

  if (log) {
    await prisma.auditLog.delete({ where: { id: log.id } });
  }
});

test("logAccess - creates access log record in database", async () => {

  await logAccess(user?.id, "target_123", "Test Access Action", "AUTH");

  const log = await prisma.accessLog.findFirst({
    where: { userId: user.id, action: "Test Access Action" },
    orderBy: { createdAt: "desc" },
  });

  expect(log).toBeDefined();
  expect(log?.targetId).toBe("target_123");
  expect(log?.tag).toBe("AUTH");

  if (log) {
    await prisma.accessLog.delete({ where: { id: log.id } });
  }
});
