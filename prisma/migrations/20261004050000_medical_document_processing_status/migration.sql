-- CreateEnum
CREATE TYPE "MedicalDocumentProcessingStatus" AS ENUM ('PENDING', 'QUEUED', 'PROCESSING', 'READY', 'FAILED');

-- AlterTable
ALTER TABLE "MedicalDocument" ADD COLUMN "processingStatus" "MedicalDocumentProcessingStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN "processingError" TEXT,
ADD COLUMN "processedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "MedicalDocument_patientId_processingStatus_idx" ON "MedicalDocument"("patientId", "processingStatus");
