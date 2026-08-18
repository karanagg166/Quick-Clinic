-- AlterTable Slot
ALTER TABLE "Slot"
ADD COLUMN "holdToken" TEXT,
ADD COLUMN "holdExpiresAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Slot_holdExpiresAt_idx" ON "Slot"("holdExpiresAt");

-- CreateIndex on AuditLog
CREATE INDEX "AuditLog_userId_idx" ON "AuditLog"("userId");
CREATE INDEX "AuditLog_tag_idx" ON "AuditLog"("tag");
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");
CREATE INDEX "AuditLog_userId_createdAt_idx" ON "AuditLog"("userId", "createdAt");

-- CreateIndex on AccessLog
CREATE INDEX "AccessLog_userId_idx" ON "AccessLog"("userId");
CREATE INDEX "AccessLog_targetId_idx" ON "AccessLog"("targetId");
CREATE INDEX "AccessLog_tag_idx" ON "AccessLog"("tag");
CREATE INDEX "AccessLog_createdAt_idx" ON "AccessLog"("createdAt");
CREATE INDEX "AccessLog_userId_createdAt_idx" ON "AccessLog"("userId", "createdAt");
