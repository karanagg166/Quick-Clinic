-- Enable pgvector for MedicalChunkEmbedding

CREATE EXTENSION IF NOT EXISTS vector;

-- CreateEnum
CREATE TYPE "AgentApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "AgentExecutionStatus" AS ENUM ('NOT_STARTED', 'EXECUTING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "AgentActionRiskLevel" AS ENUM ('LOW_AUTONOMOUS', 'MEDIUM_HUMAN_APPROVAL', 'HIGH_CLINICAL_RESTRICTED');

-- CreateEnum
CREATE TYPE "MedicalPipelineStatus" AS ENUM ('PENDING', 'QUEUED', 'RUNNING', 'PARTIAL', 'COMPLETED', 'RETRYABLE', 'FAILED', 'REVOKED');

-- CreateEnum
CREATE TYPE "AgentThreadStatus" AS ENUM ('ACTIVE', 'ARCHIVED', 'REDACTED');

-- CreateEnum
CREATE TYPE "AgentMessageRole" AS ENUM ('USER', 'ASSISTANT', 'TOOL', 'SYSTEM');

-- CreateEnum
CREATE TYPE "AgentMessageStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED', 'REDACTED');

-- CreateTable
CREATE TABLE "MedicalDocumentVersion" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "sourceSha256" TEXT NOT NULL,
    "schemaVersion" TEXT NOT NULL,
    "pipelineVersion" TEXT NOT NULL,
    "configFingerprint" TEXT NOT NULL,
    "tokenizerName" TEXT,
    "extractionStatus" "MedicalPipelineStatus" NOT NULL DEFAULT 'PENDING',
    "indexStatus" "MedicalPipelineStatus" NOT NULL DEFAULT 'PENDING',
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "pageCount" INTEGER NOT NULL DEFAULT 0,
    "objectCount" INTEGER NOT NULL DEFAULT 0,
    "chunkCount" INTEGER NOT NULL DEFAULT 0,
    "issueCount" INTEGER NOT NULL DEFAULT 0,
    "manifest" JSONB,
    "pipelineMetadata" JSONB,
    "contentSha256" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "MedicalDocumentVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MedicalIngestionJob" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "versionId" TEXT,
    "generation" INTEGER NOT NULL DEFAULT 1,
    "status" "MedicalPipelineStatus" NOT NULL DEFAULT 'QUEUED',
    "stage" TEXT NOT NULL DEFAULT 'registered',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "lastHeartbeatAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "leaseToken" TEXT,
    "leaseOwner" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "errorCode" TEXT,
    "retryable" BOOLEAN NOT NULL DEFAULT false,
    "progress" JSONB,
    "resourceMetrics" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MedicalIngestionJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MedicalDocumentPage" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "pageNumber" INTEGER NOT NULL,
    "width" DOUBLE PRECISION NOT NULL,
    "height" DOUBLE PRECISION NOT NULL,
    "rotation" INTEGER NOT NULL DEFAULT 0,
    "selectableChars" INTEGER NOT NULL DEFAULT 0,
    "coordinateSystem" TEXT NOT NULL DEFAULT 'unrotated_pdf_points',
    "cropbox" JSONB NOT NULL,
    "pdfToPage" JSONB,
    "status" "MedicalPipelineStatus" NOT NULL DEFAULT 'COMPLETED',
    "metadata" JSONB,

    CONSTRAINT "MedicalDocumentPage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MedicalDocumentSection" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "sectionStableId" TEXT NOT NULL,
    "parentSectionId" TEXT,
    "title" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "headingPath" JSONB NOT NULL,
    "source" JSONB NOT NULL,
    "readingOrder" INTEGER,

    CONSTRAINT "MedicalDocumentSection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MedicalDocumentObject" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "objectStableId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "subtype" TEXT,
    "title" TEXT,
    "text" TEXT,
    "sectionStableId" TEXT,
    "headingPath" JSONB,
    "firstPage" INTEGER,
    "lastPage" INTEGER,
    "readingOrder" INTEGER,
    "status" "MedicalPipelineStatus" NOT NULL DEFAULT 'PARTIAL',
    "reviewRequired" BOOLEAN NOT NULL DEFAULT false,
    "confidence" DOUBLE PRECISION,
    "normalized" JSONB NOT NULL,
    "sourceSha256" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MedicalDocumentObject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MedicalObjectRegion" (
    "id" TEXT NOT NULL,
    "objectId" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "regionStableId" TEXT NOT NULL,
    "parentRegionId" TEXT,
    "readingOrder" INTEGER NOT NULL,
    "coordinateSystem" TEXT NOT NULL,
    "x0" DOUBLE PRECISION NOT NULL,
    "y0" DOUBLE PRECISION NOT NULL,
    "x1" DOUBLE PRECISION NOT NULL,
    "y1" DOUBLE PRECISION NOT NULL,
    "sourceImageId" TEXT,
    "provider" TEXT,
    "model" TEXT,
    "confidence" DOUBLE PRECISION,
    "evidence" JSONB,
    "source" JSONB NOT NULL,

    CONSTRAINT "MedicalObjectRegion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MedicalDocumentAsset" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "objectId" TEXT,
    "kind" TEXT NOT NULL,
    "opaqueAssetId" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "pageNumber" INTEGER,
    "geometry" JSONB,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "MedicalDocumentAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MedicalExtractionIssue" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "pageNumber" INTEGER,
    "objectStableId" TEXT,
    "stage" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "retryable" BOOLEAN NOT NULL DEFAULT false,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MedicalExtractionIssue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MedicalDocumentChunk" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "chunkStableId" TEXT NOT NULL,
    "chunkIndex" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "contentSha256" TEXT NOT NULL,
    "tokenCount" INTEGER NOT NULL,
    "tokenizer" TEXT NOT NULL,
    "headingPath" JSONB,
    "sourceObjectIds" JSONB NOT NULL,
    "paragraphIds" JSONB,
    "sentenceIds" JSONB,
    "pageNumbers" JSONB NOT NULL,
    "startPage" INTEGER NOT NULL,
    "endPage" INTEGER NOT NULL,
    "rowStart" INTEGER,
    "rowEnd" INTEGER,
    "isFragment" BOOLEAN NOT NULL DEFAULT false,
    "provenance" JSONB NOT NULL,
    "pipelineVersion" TEXT NOT NULL,
    "status" "MedicalPipelineStatus" NOT NULL DEFAULT 'COMPLETED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MedicalDocumentChunk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MedicalChunkObject" (
    "id" TEXT NOT NULL,
    "chunkId" TEXT NOT NULL,
    "objectId" TEXT NOT NULL,
    "sourceRefs" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MedicalChunkObject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MedicalChunkEmbedding" (
    "id" TEXT NOT NULL,
    "chunkId" TEXT NOT NULL,
    "vectorId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "dimension" INTEGER NOT NULL DEFAULT 384,
    "embeddingVersion" TEXT NOT NULL,
    "indexGeneration" INTEGER NOT NULL DEFAULT 1,
    "inputSha256" TEXT NOT NULL,
    "status" "MedicalPipelineStatus" NOT NULL DEFAULT 'PENDING',
    "embedding" vector(384),
    "embeddingMetadata" JSONB,
    "indexedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MedicalChunkEmbedding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MedicalObservation" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "objectId" TEXT,
    "chunkId" TEXT,
    "observationType" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "valueNumeric" DOUBLE PRECISION,
    "valueSecondaryNumeric" DOUBLE PRECISION,
    "valueText" TEXT,
    "unit" TEXT,
    "referenceRange" JSONB,
    "observedAt" TIMESTAMP(3),
    "reportedAt" TIMESTAMP(3),
    "dateInferred" BOOLEAN NOT NULL DEFAULT false,
    "pageNumber" INTEGER,
    "extractionMethod" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION,
    "reviewStatus" TEXT NOT NULL DEFAULT 'UNREVIEWED',
    "source" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MedicalObservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MedicalAccessGrant" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "doctorId" TEXT NOT NULL,
    "documentId" TEXT,
    "grantedByUserId" TEXT NOT NULL,
    "relationshipAppointmentId" TEXT,
    "scope" JSONB NOT NULL,
    "consentSource" TEXT NOT NULL,
    "policyVersion" INTEGER NOT NULL DEFAULT 1,
    "effectiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revokedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MedicalAccessGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MedicalDocumentCleanup" (
    "id" TEXT NOT NULL,
    "documentId" TEXT,
    "documentIdSnapshot" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseToken" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "lastErrorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "MedicalDocumentCleanup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentThread" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "doctorId" TEXT,
    "patientId" TEXT,
    "scopeType" TEXT NOT NULL DEFAULT 'GENERAL',
    "purpose" TEXT NOT NULL DEFAULT 'CLINIC_ASSISTANT',
    "title" TEXT NOT NULL DEFAULT 'New conversation',
    "status" "AgentThreadStatus" NOT NULL DEFAULT 'ACTIVE',
    "permissionRevision" INTEGER NOT NULL DEFAULT 1,
    "latestMemoryVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastMessageAt" TIMESTAMP(3),
    "redactedAt" TIMESTAMP(3),

    CONSTRAINT "AgentThread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentTurn" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "turnIndex" INTEGER NOT NULL,
    "originalQuery" TEXT NOT NULL,
    "retrievalQuery" TEXT,
    "rewritten" BOOLEAN NOT NULL DEFAULT false,
    "requiresHistory" BOOLEAN NOT NULL DEFAULT false,
    "queryRoute" TEXT,
    "queryPolicyVersion" TEXT,
    "classification" JSONB,
    "plannedTools" JSONB,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "responseHash" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "AgentTurn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentMessage" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "turnId" TEXT,
    "sequence" INTEGER NOT NULL,
    "role" "AgentMessageRole" NOT NULL,
    "status" "AgentMessageStatus" NOT NULL DEFAULT 'COMPLETED',
    "content" TEXT NOT NULL,
    "contentSha256" TEXT,
    "messageMetadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "redactedAt" TIMESTAMP(3),
    "redactionReason" TEXT,

    CONSTRAINT "AgentMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentContextLink" (
    "id" TEXT NOT NULL,
    "turnId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL,
    "permissionRevision" INTEGER NOT NULL,
    "includedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentContextLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentMemorySnapshot" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "summary" TEXT NOT NULL,
    "summarySha256" TEXT NOT NULL,
    "coveredMessageIds" JSONB NOT NULL,
    "sourceChunkIds" JSONB,
    "topics" JSONB,
    "latestMessageId" TEXT,
    "tokenCount" INTEGER NOT NULL DEFAULT 0,
    "summarizerModel" TEXT,
    "permissionRevision" INTEGER NOT NULL,
    "authorizationHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "invalidatedAt" TIMESTAMP(3),
    "invalidationReason" TEXT,

    CONSTRAINT "AgentMemorySnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentRetrievalRun" (
    "id" TEXT NOT NULL,
    "turnId" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "strategy" TEXT NOT NULL,
    "queryFilters" JSONB,
    "indexVersion" TEXT,
    "embeddingModel" TEXT,
    "rerankerModel" TEXT,
    "topK" INTEGER NOT NULL,
    "candidateCount" INTEGER NOT NULL DEFAULT 0,
    "selectedCount" INTEGER NOT NULL DEFAULT 0,
    "authorizationHash" TEXT,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "durationMs" INTEGER,
    "metrics" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentRetrievalRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentRetrievalHit" (
    "id" TEXT NOT NULL,
    "retrievalRunId" TEXT NOT NULL,
    "chunkId" TEXT,
    "chunkStableId" TEXT NOT NULL,
    "versionStableId" TEXT,
    "sourceObjectIds" JSONB,
    "sourceRefs" JSONB,
    "contentSha256" TEXT NOT NULL,
    "candidateRank" INTEGER NOT NULL,
    "finalRank" INTEGER,
    "denseScore" DOUBLE PRECISION,
    "sparseScore" DOUBLE PRECISION,
    "hybridScore" DOUBLE PRECISION,
    "rerankScore" DOUBLE PRECISION,
    "includedInPrompt" BOOLEAN NOT NULL DEFAULT false,
    "citedInAnswer" BOOLEAN NOT NULL DEFAULT false,
    "reviewRequired" BOOLEAN NOT NULL DEFAULT false,
    "authorizedAtRetrieval" BOOLEAN NOT NULL DEFAULT false,
    "excludedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentRetrievalHit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentMessageCitation" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "retrievalHitId" TEXT,
    "label" TEXT NOT NULL,
    "claimSpan" JSONB,
    "chunkStableId" TEXT,
    "documentVersionId" TEXT,
    "sourceObjectId" TEXT,
    "pageNumber" INTEGER,
    "sourceRefs" JSONB,
    "contentSha256" TEXT,
    "reviewRequired" BOOLEAN NOT NULL DEFAULT false,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentMessageCitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentToolCall" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "turnId" TEXT NOT NULL,
    "toolCallId" TEXT NOT NULL,
    "toolName" TEXT NOT NULL,
    "actionType" TEXT,
    "riskLevel" TEXT,
    "inputJson" JSONB NOT NULL,
    "inputSha256" TEXT NOT NULL,
    "resultJson" JSONB,
    "resultSha256" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PROPOSED',
    "approvalId" TEXT,
    "errorCode" TEXT,
    "durationMs" INTEGER,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "AgentToolCall_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentModelCall" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "turnId" TEXT,
    "purpose" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "modelVersion" TEXT,
    "promptVersion" TEXT,
    "requestSha256" TEXT,
    "responseSha256" TEXT,
    "promptTokens" INTEGER,
    "completionTokens" INTEGER,
    "totalTokens" INTEGER,
    "latencyMs" INTEGER,
    "providerRequestId" TEXT,
    "traceId" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "fallbackFrom" TEXT,
    "privacyPolicyRef" TEXT,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "errorCode" TEXT,
    "usageMetadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "AgentModelCall_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentApproval" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "toolCallId" TEXT NOT NULL,
    "requestedByUserId" TEXT NOT NULL,
    "approvedByUserId" TEXT,
    "actionType" TEXT NOT NULL,
    "riskLevel" "AgentActionRiskLevel" NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "parameters" JSONB NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "status" "AgentApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "executionStatus" "AgentExecutionStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "decidedAt" TIMESTAMP(3),
    "decisionReason" TEXT,
    "executedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "executionResult" JSONB,
    "executionLeaseExpiresAt" TIMESTAMP(3),
    "executionAttempts" INTEGER NOT NULL DEFAULT 0,
    "lastErrorCode" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentApproval_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MedicalDocumentVersion_documentId_isPublished_revokedAt_idx" ON "MedicalDocumentVersion"("documentId", "isPublished", "revokedAt");

-- CreateIndex
CREATE INDEX "MedicalDocumentVersion_sourceSha256_idx" ON "MedicalDocumentVersion"("sourceSha256");

-- CreateIndex
CREATE UNIQUE INDEX "MedicalDocumentVersion_documentId_versionNumber_key" ON "MedicalDocumentVersion"("documentId", "versionNumber");

-- CreateIndex
CREATE INDEX "MedicalIngestionJob_status_availableAt_idx" ON "MedicalIngestionJob"("status", "availableAt");

-- CreateIndex
CREATE INDEX "MedicalIngestionJob_leaseExpiresAt_idx" ON "MedicalIngestionJob"("leaseExpiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "MedicalIngestionJob_documentId_generation_key" ON "MedicalIngestionJob"("documentId", "generation");

-- CreateIndex
CREATE UNIQUE INDEX "MedicalDocumentPage_versionId_pageNumber_key" ON "MedicalDocumentPage"("versionId", "pageNumber");

-- CreateIndex
CREATE UNIQUE INDEX "MedicalDocumentSection_versionId_sectionStableId_key" ON "MedicalDocumentSection"("versionId", "sectionStableId");

-- CreateIndex
CREATE INDEX "MedicalDocumentObject_versionId_kind_firstPage_idx" ON "MedicalDocumentObject"("versionId", "kind", "firstPage");

-- CreateIndex
CREATE INDEX "MedicalDocumentObject_sectionStableId_idx" ON "MedicalDocumentObject"("sectionStableId");

-- CreateIndex
CREATE UNIQUE INDEX "MedicalDocumentObject_versionId_objectStableId_key" ON "MedicalDocumentObject"("versionId", "objectStableId");

-- CreateIndex
CREATE INDEX "MedicalObjectRegion_pageId_readingOrder_idx" ON "MedicalObjectRegion"("pageId", "readingOrder");

-- CreateIndex
CREATE UNIQUE INDEX "MedicalObjectRegion_objectId_pageId_regionStableId_key" ON "MedicalObjectRegion"("objectId", "pageId", "regionStableId");

-- CreateIndex
CREATE UNIQUE INDEX "MedicalDocumentAsset_storagePath_key" ON "MedicalDocumentAsset"("storagePath");

-- CreateIndex
CREATE INDEX "MedicalDocumentAsset_objectId_idx" ON "MedicalDocumentAsset"("objectId");

-- CreateIndex
CREATE UNIQUE INDEX "MedicalDocumentAsset_versionId_opaqueAssetId_key" ON "MedicalDocumentAsset"("versionId", "opaqueAssetId");

-- CreateIndex
CREATE INDEX "MedicalExtractionIssue_versionId_stage_pageNumber_idx" ON "MedicalExtractionIssue"("versionId", "stage", "pageNumber");

-- CreateIndex
CREATE INDEX "MedicalDocumentChunk_versionId_kind_startPage_idx" ON "MedicalDocumentChunk"("versionId", "kind", "startPage");

-- CreateIndex
CREATE INDEX "MedicalDocumentChunk_contentSha256_idx" ON "MedicalDocumentChunk"("contentSha256");

-- CreateIndex
CREATE UNIQUE INDEX "MedicalDocumentChunk_versionId_chunkStableId_key" ON "MedicalDocumentChunk"("versionId", "chunkStableId");

-- CreateIndex
CREATE UNIQUE INDEX "MedicalDocumentChunk_versionId_chunkIndex_key" ON "MedicalDocumentChunk"("versionId", "chunkIndex");

-- CreateIndex
CREATE INDEX "MedicalChunkObject_objectId_idx" ON "MedicalChunkObject"("objectId");

-- CreateIndex
CREATE UNIQUE INDEX "MedicalChunkObject_chunkId_objectId_key" ON "MedicalChunkObject"("chunkId", "objectId");

-- CreateIndex
CREATE UNIQUE INDEX "MedicalChunkEmbedding_vectorId_key" ON "MedicalChunkEmbedding"("vectorId");

-- CreateIndex
CREATE INDEX "MedicalChunkEmbedding_status_model_dimension_idx" ON "MedicalChunkEmbedding"("status", "model", "dimension");

-- CreateIndex
CREATE UNIQUE INDEX "MedicalChunkEmbedding_chunkId_model_embeddingVersion_key" ON "MedicalChunkEmbedding"("chunkId", "model", "embeddingVersion");

-- CreateIndex
CREATE INDEX "MedicalObservation_patientId_observationType_observedAt_idx" ON "MedicalObservation"("patientId", "observationType", "observedAt");

-- CreateIndex
CREATE INDEX "MedicalObservation_versionId_pageNumber_idx" ON "MedicalObservation"("versionId", "pageNumber");

-- CreateIndex
CREATE INDEX "MedicalAccessGrant_doctorId_patientId_revokedAt_expiresAt_idx" ON "MedicalAccessGrant"("doctorId", "patientId", "revokedAt", "expiresAt");

-- CreateIndex
CREATE INDEX "MedicalAccessGrant_documentId_idx" ON "MedicalAccessGrant"("documentId");

-- CreateIndex
CREATE INDEX "MedicalDocumentCleanup_status_availableAt_idx" ON "MedicalDocumentCleanup"("status", "availableAt");

-- CreateIndex
CREATE INDEX "MedicalDocumentCleanup_documentIdSnapshot_idx" ON "MedicalDocumentCleanup"("documentIdSnapshot");

-- CreateIndex
CREATE INDEX "AgentThread_ownerUserId_status_updatedAt_idx" ON "AgentThread"("ownerUserId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "AgentThread_doctorId_patientId_idx" ON "AgentThread"("doctorId", "patientId");

-- CreateIndex
CREATE INDEX "AgentTurn_threadId_startedAt_idx" ON "AgentTurn"("threadId", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AgentTurn_threadId_turnIndex_key" ON "AgentTurn"("threadId", "turnIndex");

-- CreateIndex
CREATE INDEX "AgentMessage_turnId_createdAt_idx" ON "AgentMessage"("turnId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentMessage_threadId_createdAt_idx" ON "AgentMessage"("threadId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AgentMessage_threadId_sequence_key" ON "AgentMessage"("threadId", "sequence");

-- CreateIndex
CREATE INDEX "AgentContextLink_messageId_idx" ON "AgentContextLink"("messageId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentContextLink_turnId_messageId_key" ON "AgentContextLink"("turnId", "messageId");

-- CreateIndex
CREATE INDEX "AgentMemorySnapshot_threadId_invalidatedAt_idx" ON "AgentMemorySnapshot"("threadId", "invalidatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AgentMemorySnapshot_threadId_version_key" ON "AgentMemorySnapshot"("threadId", "version");

-- CreateIndex
CREATE INDEX "AgentRetrievalRun_turnId_createdAt_idx" ON "AgentRetrievalRun"("turnId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentRetrievalHit_chunkId_idx" ON "AgentRetrievalHit"("chunkId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentRetrievalHit_retrievalRunId_candidateRank_key" ON "AgentRetrievalHit"("retrievalRunId", "candidateRank");

-- CreateIndex
CREATE INDEX "AgentMessageCitation_messageId_idx" ON "AgentMessageCitation"("messageId");

-- CreateIndex
CREATE INDEX "AgentMessageCitation_chunkStableId_idx" ON "AgentMessageCitation"("chunkStableId");

-- CreateIndex
CREATE INDEX "AgentMessageCitation_documentVersionId_idx" ON "AgentMessageCitation"("documentVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentToolCall_approvalId_key" ON "AgentToolCall"("approvalId");

-- CreateIndex
CREATE INDEX "AgentToolCall_turnId_startedAt_idx" ON "AgentToolCall"("turnId", "startedAt");

-- CreateIndex
CREATE INDEX "AgentToolCall_status_idx" ON "AgentToolCall"("status");

-- CreateIndex
CREATE UNIQUE INDEX "AgentToolCall_threadId_toolCallId_key" ON "AgentToolCall"("threadId", "toolCallId");

-- CreateIndex
CREATE INDEX "AgentModelCall_threadId_createdAt_idx" ON "AgentModelCall"("threadId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentModelCall_provider_model_createdAt_idx" ON "AgentModelCall"("provider", "model", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AgentApproval_idempotencyKey_key" ON "AgentApproval"("idempotencyKey");

-- CreateIndex
CREATE INDEX "AgentApproval_requestedByUserId_status_expiresAt_idx" ON "AgentApproval"("requestedByUserId", "status", "expiresAt");

-- CreateIndex
CREATE INDEX "AgentApproval_status_executionStatus_idx" ON "AgentApproval"("status", "executionStatus");

-- CreateIndex
CREATE INDEX "AgentApproval_executionStatus_executionLeaseExpiresAt_idx" ON "AgentApproval"("executionStatus", "executionLeaseExpiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "AgentApproval_threadId_toolCallId_key" ON "AgentApproval"("threadId", "toolCallId");

-- AddForeignKey
ALTER TABLE "MedicalDocumentVersion" ADD CONSTRAINT "MedicalDocumentVersion_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "MedicalDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicalIngestionJob" ADD CONSTRAINT "MedicalIngestionJob_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "MedicalDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicalIngestionJob" ADD CONSTRAINT "MedicalIngestionJob_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "MedicalDocumentVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicalDocumentPage" ADD CONSTRAINT "MedicalDocumentPage_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "MedicalDocumentVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicalDocumentSection" ADD CONSTRAINT "MedicalDocumentSection_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "MedicalDocumentVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicalDocumentObject" ADD CONSTRAINT "MedicalDocumentObject_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "MedicalDocumentVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicalObjectRegion" ADD CONSTRAINT "MedicalObjectRegion_objectId_fkey" FOREIGN KEY ("objectId") REFERENCES "MedicalDocumentObject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicalObjectRegion" ADD CONSTRAINT "MedicalObjectRegion_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "MedicalDocumentPage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicalDocumentAsset" ADD CONSTRAINT "MedicalDocumentAsset_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "MedicalDocumentVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicalDocumentAsset" ADD CONSTRAINT "MedicalDocumentAsset_objectId_fkey" FOREIGN KEY ("objectId") REFERENCES "MedicalDocumentObject"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicalExtractionIssue" ADD CONSTRAINT "MedicalExtractionIssue_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "MedicalDocumentVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicalDocumentChunk" ADD CONSTRAINT "MedicalDocumentChunk_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "MedicalDocumentVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicalChunkObject" ADD CONSTRAINT "MedicalChunkObject_chunkId_fkey" FOREIGN KEY ("chunkId") REFERENCES "MedicalDocumentChunk"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicalChunkObject" ADD CONSTRAINT "MedicalChunkObject_objectId_fkey" FOREIGN KEY ("objectId") REFERENCES "MedicalDocumentObject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicalChunkEmbedding" ADD CONSTRAINT "MedicalChunkEmbedding_chunkId_fkey" FOREIGN KEY ("chunkId") REFERENCES "MedicalDocumentChunk"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicalObservation" ADD CONSTRAINT "MedicalObservation_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicalObservation" ADD CONSTRAINT "MedicalObservation_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "MedicalDocumentVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicalObservation" ADD CONSTRAINT "MedicalObservation_objectId_fkey" FOREIGN KEY ("objectId") REFERENCES "MedicalDocumentObject"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicalObservation" ADD CONSTRAINT "MedicalObservation_chunkId_fkey" FOREIGN KEY ("chunkId") REFERENCES "MedicalDocumentChunk"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicalAccessGrant" ADD CONSTRAINT "MedicalAccessGrant_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicalAccessGrant" ADD CONSTRAINT "MedicalAccessGrant_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "Doctor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicalAccessGrant" ADD CONSTRAINT "MedicalAccessGrant_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "MedicalDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicalAccessGrant" ADD CONSTRAINT "MedicalAccessGrant_grantedByUserId_fkey" FOREIGN KEY ("grantedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicalDocumentCleanup" ADD CONSTRAINT "MedicalDocumentCleanup_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "MedicalDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentThread" ADD CONSTRAINT "AgentThread_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentThread" ADD CONSTRAINT "AgentThread_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "Doctor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentThread" ADD CONSTRAINT "AgentThread_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentTurn" ADD CONSTRAINT "AgentTurn_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "AgentThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentMessage" ADD CONSTRAINT "AgentMessage_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "AgentThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentMessage" ADD CONSTRAINT "AgentMessage_turnId_fkey" FOREIGN KEY ("turnId") REFERENCES "AgentTurn"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentContextLink" ADD CONSTRAINT "AgentContextLink_turnId_fkey" FOREIGN KEY ("turnId") REFERENCES "AgentTurn"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentContextLink" ADD CONSTRAINT "AgentContextLink_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "AgentMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentMemorySnapshot" ADD CONSTRAINT "AgentMemorySnapshot_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "AgentThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRetrievalRun" ADD CONSTRAINT "AgentRetrievalRun_turnId_fkey" FOREIGN KEY ("turnId") REFERENCES "AgentTurn"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRetrievalHit" ADD CONSTRAINT "AgentRetrievalHit_retrievalRunId_fkey" FOREIGN KEY ("retrievalRunId") REFERENCES "AgentRetrievalRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRetrievalHit" ADD CONSTRAINT "AgentRetrievalHit_chunkId_fkey" FOREIGN KEY ("chunkId") REFERENCES "MedicalDocumentChunk"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentMessageCitation" ADD CONSTRAINT "AgentMessageCitation_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "AgentMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentMessageCitation" ADD CONSTRAINT "AgentMessageCitation_retrievalHitId_fkey" FOREIGN KEY ("retrievalHitId") REFERENCES "AgentRetrievalHit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentToolCall" ADD CONSTRAINT "AgentToolCall_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "AgentThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentToolCall" ADD CONSTRAINT "AgentToolCall_turnId_fkey" FOREIGN KEY ("turnId") REFERENCES "AgentTurn"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentToolCall" ADD CONSTRAINT "AgentToolCall_approvalId_fkey" FOREIGN KEY ("approvalId") REFERENCES "AgentApproval"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentModelCall" ADD CONSTRAINT "AgentModelCall_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "AgentThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentModelCall" ADD CONSTRAINT "AgentModelCall_turnId_fkey" FOREIGN KEY ("turnId") REFERENCES "AgentTurn"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentApproval" ADD CONSTRAINT "AgentApproval_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "AgentThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentApproval" ADD CONSTRAINT "AgentApproval_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentApproval" ADD CONSTRAINT "AgentApproval_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Vector similarity index for pgvector retrieval
CREATE INDEX IF NOT EXISTS "MedicalChunkEmbedding_embedding_hnsw_idx"
ON "MedicalChunkEmbedding" USING hnsw ("embedding" vector_cosine_ops);

-- Preserve historical MedicalAiConversation / MedicalAiMessage rows without dropping legacy tables
DO $$
BEGIN
    IF to_regclass('"MedicalAiConversation"') IS NOT NULL THEN
        INSERT INTO "AgentThread" (
            "id", "ownerUserId", "doctorId", "patientId",
            "scopeType", "purpose", "title", "status", "createdAt", "updatedAt"
        )
        SELECT
            c."id", d."userId", c."doctorId", c."patientId",
            'SINGLE_PATIENT', 'MEDICAL_RAG_LEGACY',
            COALESCE(c."title", 'Imported medical conversation'),
            'ACTIVE'::"AgentThreadStatus",
            c."createdAt", c."updatedAt"
        FROM "MedicalAiConversation" c
        JOIN "Doctor" d ON d."id" = c."doctorId"
        ON CONFLICT ("id") DO NOTHING;
    END IF;

    IF to_regclass('"MedicalAiMessage"') IS NOT NULL THEN
        INSERT INTO "AgentMessage" (
            "id", "threadId", "sequence", "role", "status", "content", "messageMetadata", "createdAt"
        )
        SELECT
            m."id",
            m."conversationId",
            ROW_NUMBER() OVER (PARTITION BY m."conversationId" ORDER BY m."createdAt", m."id"),
            CASE WHEN m."role"::text = 'USER' THEN 'USER'::"AgentMessageRole" ELSE 'ASSISTANT'::"AgentMessageRole" END,
            CASE WHEN m."status"::text = 'FAILED' THEN 'FAILED'::"AgentMessageStatus" ELSE 'COMPLETED'::"AgentMessageStatus" END,
            m."content",
            CASE WHEN m."citations" IS NOT NULL THEN jsonb_build_object('legacyCitations', m."citations") ELSE NULL END,
            m."createdAt"
        FROM "MedicalAiMessage" m
        WHERE EXISTS (SELECT 1 FROM "AgentThread" t WHERE t."id" = m."conversationId")
        ON CONFLICT ("id") DO NOTHING;
    END IF;
END $$;
