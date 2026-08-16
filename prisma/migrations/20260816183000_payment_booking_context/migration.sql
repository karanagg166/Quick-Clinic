-- Bind each Razorpay order to the slot hold and fee context it was created for.
ALTER TABLE "Payment"
ADD COLUMN "doctorId" TEXT,
ADD COLUMN "slotId" TEXT,
ADD COLUMN "holdToken" TEXT;
