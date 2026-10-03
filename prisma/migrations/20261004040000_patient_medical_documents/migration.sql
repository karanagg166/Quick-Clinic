-- CreateEnum
CREATE TYPE "MedicalDocumentType" AS ENUM (
    'LAB_REPORT',
    'PRESCRIPTION',
    'RADIOLOGY_SCAN',
    'DISCHARGE_SUMMARY',
    'MEDICAL_CERTIFICATE',
    'VACCINATION_RECORD',
    'OTHER'
);

-- CreateTable
CREATE TABLE "MedicalDocument" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "type" "MedicalDocumentType" NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "storagePath" TEXT NOT NULL,
    "reportDate" TIMESTAMP(3) NOT NULL,
    "hospitalOrDoctor" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MedicalDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MedicalDocument_storagePath_key" ON "MedicalDocument"("storagePath");

-- CreateIndex
CREATE INDEX "MedicalDocument_patientId_idx" ON "MedicalDocument"("patientId");

-- CreateIndex
CREATE INDEX "MedicalDocument_patientId_reportDate_idx" ON "MedicalDocument"("patientId", "reportDate");

-- CreateIndex
CREATE INDEX "MedicalDocument_patientId_type_idx" ON "MedicalDocument"("patientId", "type");

-- AddForeignKey
ALTER TABLE "MedicalDocument" ADD CONSTRAINT "MedicalDocument_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;
