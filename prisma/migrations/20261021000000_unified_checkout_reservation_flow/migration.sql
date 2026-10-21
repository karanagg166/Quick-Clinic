-- CreateEnum
CREATE TYPE "CheckoutStatus" AS ENUM ('PENDING_ORDER', 'READY_FOR_PAYMENT', 'CONFIRMED', 'EXPIRED', 'FAILED', 'UNRESOLVED');

-- CreateTable Checkout
CREATE TABLE IF NOT EXISTS "Checkout" (
    "id" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "doctorId" TEXT NOT NULL,
    "slotId" TEXT NOT NULL,
    "holdToken" TEXT NOT NULL,
    "paymentMethod" "PaymentMethod" NOT NULL DEFAULT 'ONLINE',
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "status" "CheckoutStatus" NOT NULL DEFAULT 'PENDING_ORDER',
    "razorpayOrderId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "paymentId" TEXT,
    "appointmentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMP(3),

    CONSTRAINT "Checkout_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Checkout_idempotencyKey_key" ON "Checkout"("idempotencyKey");
CREATE UNIQUE INDEX IF NOT EXISTS "Checkout_razorpayOrderId_key" ON "Checkout"("razorpayOrderId");
CREATE UNIQUE INDEX IF NOT EXISTS "Checkout_paymentId_key" ON "Checkout"("paymentId");
CREATE UNIQUE INDEX IF NOT EXISTS "Checkout_appointmentId_key" ON "Checkout"("appointmentId");
CREATE INDEX IF NOT EXISTS "Checkout_userId_status_idx" ON "Checkout"("userId", "status");
CREATE INDEX IF NOT EXISTS "Checkout_doctorId_slotId_idx" ON "Checkout"("doctorId", "slotId");
CREATE INDEX IF NOT EXISTS "Checkout_expiresAt_status_idx" ON "Checkout"("expiresAt", "status");
CREATE INDEX IF NOT EXISTS "Checkout_razorpayOrderId_idx" ON "Checkout"("razorpayOrderId");

-- AddForeignKey
ALTER TABLE "Checkout" ADD CONSTRAINT "Checkout_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Checkout" ADD CONSTRAINT "Checkout_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Checkout" ADD CONSTRAINT "Checkout_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "Doctor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Checkout" ADD CONSTRAINT "Checkout_slotId_fkey" FOREIGN KEY ("slotId") REFERENCES "Slot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Checkout" ADD CONSTRAINT "Checkout_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Checkout" ADD CONSTRAINT "Checkout_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
