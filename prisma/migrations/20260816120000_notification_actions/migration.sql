-- Store an explicit, safe in-app destination instead of embedding URLs in text.
ALTER TABLE "Notification"
ADD COLUMN "actionHref" TEXT,
ADD COLUMN "actionLabel" TEXT;
