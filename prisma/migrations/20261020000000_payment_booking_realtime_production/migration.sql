-- Missing PR #148 migrations: Notification eventId & ChatMessages clientMessageId
ALTER TABLE "Notification" ADD COLUMN IF NOT EXISTS "eventId" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "Notification_userId_eventId_key" ON "Notification"("userId", "eventId");
CREATE INDEX IF NOT EXISTS "Notification_userId_idx" ON "Notification"("userId");

ALTER TABLE "ChatMessages" ADD COLUMN IF NOT EXISTS "clientMessageId" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "ChatMessages_clientMessageId_key" ON "ChatMessages"("clientMessageId");

-- Production Payment & Booking Enhancements
-- CreateEnum
CREATE TYPE "RefundStatus" AS ENUM ('PENDING', 'PROCESSING', 'PROCESSED', 'FAILED');

-- CreateEnum
CREATE TYPE "WebhookEventStatus" AS ENUM ('RECEIVED', 'PROCESSING', 'PROCESSED', 'FAILED', 'IGNORED');

-- CreateEnum
CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'PROCESSING', 'DELIVERED', 'FAILED');

-- AlterTable Appointment: drop 1:1 slotId unique constraint to preserve historical cancelled bookings
ALTER TABLE "Appointment" DROP CONSTRAINT IF EXISTS "Appointment_slotId_key";
DROP INDEX IF EXISTS "Appointment_slotId_key";

-- Enforce at most one active booking per slot using partial unique index
CREATE UNIQUE INDEX IF NOT EXISTS "Appointment_active_slot_unique" ON "Appointment"("slotId") WHERE "status" IN ('PENDING', 'CONFIRMED', 'COMPLETED', 'NO_SHOW');
CREATE INDEX IF NOT EXISTS "Appointment_slotId_idx" ON "Appointment"("slotId");

-- Link Appointment directly to Payment (1:1)
ALTER TABLE "Appointment" ADD COLUMN IF NOT EXISTS "paymentId" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "Appointment_paymentId_key" ON "Appointment"("paymentId");

-- AlterTable Payment
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "idempotencyKey" TEXT;
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "capturedAt" TIMESTAMP(3);
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE UNIQUE INDEX IF NOT EXISTS "Payment_idempotencyKey_key" ON "Payment"("idempotencyKey");
CREATE UNIQUE INDEX IF NOT EXISTS "Payment_razorpayPaymentId_key" ON "Payment"("razorpayPaymentId");
CREATE INDEX IF NOT EXISTS "Payment_userId_status_idx" ON "Payment"("userId", "status");
CREATE INDEX IF NOT EXISTS "Payment_slotId_idx" ON "Payment"("slotId");
CREATE INDEX IF NOT EXISTS "Payment_razorpayPaymentId_idx" ON "Payment"("razorpayPaymentId");

-- AddForeignKey for Appointment -> Payment
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable Refund
CREATE TABLE IF NOT EXISTS "Refund" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "reason" TEXT NOT NULL,
    "status" "RefundStatus" NOT NULL DEFAULT 'PENDING',
    "idempotencyKey" TEXT NOT NULL,
    "razorpayRefundId" TEXT,
    "failureReason" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "Refund_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Refund_idempotencyKey_key" ON "Refund"("idempotencyKey");
CREATE UNIQUE INDEX IF NOT EXISTS "Refund_razorpayRefundId_key" ON "Refund"("razorpayRefundId");
CREATE INDEX IF NOT EXISTS "Refund_paymentId_idx" ON "Refund"("paymentId");
CREATE INDEX IF NOT EXISTS "Refund_status_idx" ON "Refund"("status");

ALTER TABLE "Refund" ADD CONSTRAINT "Refund_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable WebhookEvent
CREATE TABLE IF NOT EXISTS "WebhookEvent" (
    "id" TEXT NOT NULL,
    "providerEventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "paymentId" TEXT,
    "status" "WebhookEventStatus" NOT NULL DEFAULT 'RECEIVED',
    "payload" JSONB NOT NULL,
    "processingError" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "WebhookEvent_providerEventId_key" ON "WebhookEvent"("providerEventId");
CREATE INDEX IF NOT EXISTS "WebhookEvent_status_idx" ON "WebhookEvent"("status");
CREATE INDEX IF NOT EXISTS "WebhookEvent_eventType_idx" ON "WebhookEvent"("eventType");
CREATE INDEX IF NOT EXISTS "WebhookEvent_paymentId_idx" ON "WebhookEvent"("paymentId");

ALTER TABLE "WebhookEvent" ADD CONSTRAINT "WebhookEvent_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable NotificationOutbox
CREATE TABLE IF NOT EXISTS "NotificationOutbox" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "targetUserId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "lastAttemptAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredAt" TIMESTAMP(3),

    CONSTRAINT "NotificationOutbox_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "NotificationOutbox_eventId_key" ON "NotificationOutbox"("eventId");
CREATE INDEX IF NOT EXISTS "NotificationOutbox_status_createdAt_idx" ON "NotificationOutbox"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "NotificationOutbox_targetUserId_idx" ON "NotificationOutbox"("targetUserId");
