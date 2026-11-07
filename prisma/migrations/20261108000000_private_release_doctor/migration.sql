-- Operator-owned fixtures must never appear as practitioners or enter checkout.
-- Existing profiles retain their public behavior through the false default.
ALTER TABLE "Doctor" ADD COLUMN "isReleaseFixture" BOOLEAN NOT NULL DEFAULT false;
