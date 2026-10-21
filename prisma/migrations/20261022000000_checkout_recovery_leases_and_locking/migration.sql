-- AlterEnum
ALTER TYPE "CheckoutStatus" ADD VALUE IF NOT EXISTS 'MANUAL_REVIEW';

-- AlterTable Payment
ALTER TABLE "Payment"
  ADD COLUMN IF NOT EXISTS "leaseExpiresAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "leaseOwner" TEXT,
  ADD COLUMN IF NOT EXISTS "attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "nextAttemptAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "Payment_status_nextAttemptAt_idx" ON "Payment"("status", "nextAttemptAt");

-- AlterTable Checkout
ALTER TABLE "Checkout"
  ADD COLUMN IF NOT EXISTS "providerReference" TEXT,
  ADD COLUMN IF NOT EXISTS "processingStartedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "leaseExpiresAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "leaseOwner" TEXT,
  ADD COLUMN IF NOT EXISTS "attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "lastAttemptAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "nextAttemptAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "lastError" TEXT;

CREATE INDEX IF NOT EXISTS "Checkout_providerReference_idx" ON "Checkout"("providerReference");
CREATE INDEX IF NOT EXISTS "Checkout_status_nextAttemptAt_idx" ON "Checkout"("status", "nextAttemptAt");

-- AlterTable Refund
ALTER TABLE "Refund"
  ADD COLUMN IF NOT EXISTS "leaseExpiresAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "leaseOwner" TEXT,
  ADD COLUMN IF NOT EXISTS "nextAttemptAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "Refund_status_nextAttemptAt_idx" ON "Refund"("status", "nextAttemptAt");

-- AlterTable WebhookEvent
ALTER TABLE "WebhookEvent"
  ADD COLUMN IF NOT EXISTS "processingStartedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "leaseExpiresAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "leaseOwner" TEXT,
  ADD COLUMN IF NOT EXISTS "attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "nextAttemptAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "WebhookEvent_status_nextAttemptAt_idx" ON "WebhookEvent"("status", "nextAttemptAt");

-- AlterTable NotificationOutbox
ALTER TABLE "NotificationOutbox"
  ADD COLUMN IF NOT EXISTS "processingStartedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "leaseExpiresAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "leaseOwner" TEXT,
  ADD COLUMN IF NOT EXISTS "nextAttemptAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "NotificationOutbox_status_nextAttemptAt_idx" ON "NotificationOutbox"("status", "nextAttemptAt");
