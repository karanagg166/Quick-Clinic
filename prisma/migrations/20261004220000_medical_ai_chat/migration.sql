-- CreateEnum
CREATE TYPE "MedicalAiMessageRole" AS ENUM ('USER', 'ASSISTANT');

-- CreateEnum
CREATE TYPE "MedicalAiMessageStatus" AS ENUM ('COMPLETE', 'FAILED');

-- CreateTable
CREATE TABLE "MedicalAiConversation" (
    "id" TEXT NOT NULL,
    "doctorId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "title" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MedicalAiConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MedicalAiMessage" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "role" "MedicalAiMessageRole" NOT NULL,
    "content" TEXT NOT NULL,
    "citations" JSONB,
    "status" "MedicalAiMessageStatus" NOT NULL DEFAULT 'COMPLETE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MedicalAiMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MedicalAiConversation_doctorId_patientId_idx" ON "MedicalAiConversation"("doctorId", "patientId");

-- CreateIndex
CREATE INDEX "MedicalAiConversation_doctorId_updatedAt_idx" ON "MedicalAiConversation"("doctorId", "updatedAt");

-- CreateIndex
CREATE INDEX "MedicalAiMessage_conversationId_createdAt_idx" ON "MedicalAiMessage"("conversationId", "createdAt");

-- AddForeignKey
ALTER TABLE "MedicalAiConversation" ADD CONSTRAINT "MedicalAiConversation_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "Doctor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicalAiConversation" ADD CONSTRAINT "MedicalAiConversation_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicalAiMessage" ADD CONSTRAINT "MedicalAiMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "MedicalAiConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
