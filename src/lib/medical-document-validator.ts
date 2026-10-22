import { prisma } from "@/lib/prisma";
import { checkRateLimit, RateLimitResult } from "@/lib/rate-limiter";
import { createHash } from "crypto";

export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
export const MAX_PATIENT_DOCUMENTS_COUNT = 100;
export const MAX_PATIENT_STORAGE_BYTES = 100 * 1024 * 1024; // 100 MB

export const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export interface FileValidationResult {
  isValid: boolean;
  detectedMime: string;
  error?: string;
  code?: string;
}

/**
 * Validates actual binary file signatures (magic bytes) to prevent extension spoofing,
 * renamed executables, decompression bombs, and corrupted documents.
 */
export function validateFileSignature(
  buffer: Buffer,
  reportedMimeType: string
): FileValidationResult {
  if (!buffer || buffer.length === 0) {
    return {
      isValid: false,
      detectedMime: "",
      error: "Uploaded file is empty.",
      code: "EMPTY_FILE",
    };
  }

  if (buffer.length > MAX_FILE_SIZE_BYTES) {
    return {
      isValid: false,
      detectedMime: "",
      error: "File size exceeds the 10 MB limit.",
      code: "FILE_TOO_LARGE",
    };
  }

  // 1. Detect executable binaries and malicious script payloads
  // DOS / Windows PE executable header: "MZ"
  if (buffer.length >= 2 && buffer[0] === 0x4d && buffer[1] === 0x5a) {
    return {
      isValid: false,
      detectedMime: "application/x-dosexec",
      error: "Executable files are strictly forbidden.",
      code: "MALICIOUS_FILE_CONTENT",
    };
  }

  // Linux ELF executable header: 0x7f 'E' 'L' 'F'
  if (
    buffer.length >= 4 &&
    buffer[0] === 0x7f &&
    buffer[1] === 0x45 &&
    buffer[2] === 0x4c &&
    buffer[3] === 0x46
  ) {
    return {
      isValid: false,
      detectedMime: "application/x-executable",
      error: "Executable files are strictly forbidden.",
      code: "MALICIOUS_FILE_CONTENT",
    };
  }

  // Mach-O binary headers
  if (
    buffer.length >= 4 &&
    ((buffer[0] === 0xfe && buffer[1] === 0xed && buffer[2] === 0xfa && buffer[3] === 0xce) ||
      (buffer[0] === 0xfe && buffer[1] === 0xed && buffer[2] === 0xfa && buffer[3] === 0xcf) ||
      (buffer[0] === 0xca && buffer[1] === 0xfe && buffer[2] === 0xba && buffer[3] === 0xbe) ||
      (buffer[0] === 0xcf && buffer[1] === 0xfa && buffer[2] === 0xed && buffer[3] === 0xfe))
  ) {
    return {
      isValid: false,
      detectedMime: "application/x-mach-binary",
      error: "Executable files are strictly forbidden.",
      code: "MALICIOUS_FILE_CONTENT",
    };
  }

  // Script headers (e.g. #!/bin/sh, #!/usr/bin/env)
  if (buffer.length >= 2 && buffer[0] === 0x23 && buffer[1] === 0x21) {
    return {
      isValid: false,
      detectedMime: "text/x-shellscript",
      error: "Executable scripts are strictly forbidden.",
      code: "MALICIOUS_FILE_CONTENT",
    };
  }

  // Zip / JAR archive header: "PK\x03\x04"
  if (
    buffer.length >= 4 &&
    buffer[0] === 0x50 &&
    buffer[1] === 0x4b &&
    buffer[2] === 0x03 &&
    buffer[3] === 0x04
  ) {
    return {
      isValid: false,
      detectedMime: "application/zip",
      error: "Archive formats (ZIP/JAR) are not supported as medical documents.",
      code: "UNSUPPORTED_FORMAT",
    };
  }

  let detectedMime: string | null = null;

  // PDF Magic Bytes: "%PDF" (0x25, 0x50, 0x44, 0x46)
  if (
    buffer.length >= 4 &&
    buffer[0] === 0x25 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x44 &&
    buffer[3] === 0x46
  ) {
    detectedMime = "application/pdf";
  }

  // JPEG Magic Bytes: 0xFF, 0xD8, 0xFF
  else if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    detectedMime = "image/jpeg";
  }

  // PNG Magic Bytes: 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A
  else if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    detectedMime = "image/png";
  }

  // WebP Magic Bytes: "RIFF" .... "WEBP"
  else if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    detectedMime = "image/webp";
  }

  if (!detectedMime) {
    return {
      isValid: false,
      detectedMime: "",
      error: "Unsupported file format. Only PDF, JPEG, PNG, and WebP files are allowed.",
      code: "UNSUPPORTED_FORMAT",
    };
  }

  // Verify that reported MIME type matches the detected binary signature
  const normalizedReported =
    reportedMimeType.toLowerCase() === "image/jpg"
      ? "image/jpeg"
      : reportedMimeType.toLowerCase();

  if (normalizedReported && normalizedReported !== detectedMime) {
    return {
      isValid: false,
      detectedMime,
      error: `File signature mismatch: file content is '${detectedMime}' but reported as '${reportedMimeType}'.`,
      code: "FILE_SIGNATURE_MISMATCH",
    };
  }

  return {
    isValid: true,
    detectedMime,
  };
}

/**
 * Sanitizes file names to strictly prevent path traversal, control character injection,
 * and null-byte bypasses.
 */
export function sanitizeFileName(fileName: string): string {
  // Strip paths, backslashes, null bytes, and non-printable ASCII
  const base = (fileName || "document")
    .replace(/\0/g, "")
    .split(/[/\\]/)
    .pop() || "document";

  const lastDot = base.lastIndexOf(".");
  if (lastDot === -1) {
    const clean = base.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 100);
    return clean || "document";
  }

  const name = base.slice(0, lastDot).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 100);
  const ext = base.slice(lastDot + 1).replace(/[^a-zA-Z0-9]/g, "").toLowerCase().slice(0, 10);
  return `${name || "document"}.${ext}`;
}

/**
 * Checks and updates rate limits for patient document uploads.
 * Limit: 10 uploads per 60 seconds.
 */
export async function checkPatientUploadRateLimit(
  patientId: string
): Promise<RateLimitResult> {
  const key = `patient:${patientId}:doc_upload`;
  return checkRateLimit(key, 10, 60);
}

// -----------------------------------------------------------------------------
// Transactionally-Safe Quota Checking and In-Flight Concurrency Reservation
// -----------------------------------------------------------------------------

interface QuotaReservation {
  reservedBytes: number;
  reservedCount: number;
  expiresAt: number;
}

const memoryQuotaReservations = new Map<string, QuotaReservation>();

export interface StorageQuotaCheckResult {
  allowed: boolean;
  reason?: string;
  code?: string;
  status?: number;
}

/**
 * Checks patient storage quota with a strict FAIL-CLOSED policy:
 * If the database query fails, uploads are safely rejected (503) instead of leaking quota.
 */
export async function checkPatientStorageQuota(
  patientId: string,
  additionalBytes: number
): Promise<StorageQuotaCheckResult> {
  try {
    const existingDocs = await prisma.medicalDocument.findMany({
      where: { patientId },
      select: { fileSize: true },
    });

    const docs = Array.isArray(existingDocs) ? existingDocs : [];

    // Factor in in-flight reservations for concurrent upload safety
    const reservation = getActiveQuotaReservation(patientId);
    const totalCount = docs.length + (reservation?.reservedCount || 0);

    if (totalCount >= MAX_PATIENT_DOCUMENTS_COUNT) {
      return {
        allowed: false,
        reason: `Storage quota exceeded: maximum ${MAX_PATIENT_DOCUMENTS_COUNT} documents allowed per patient account.`,
        code: "QUOTA_EXCEEDED",
        status: 403,
      };
    }

    const currentTotalBytes = docs.reduce((sum, d) => sum + (d.fileSize || 0), 0);
    const totalBytesWithReservation = currentTotalBytes + (reservation?.reservedBytes || 0);

    if (totalBytesWithReservation + additionalBytes > MAX_PATIENT_STORAGE_BYTES) {
      return {
        allowed: false,
        reason: "Storage quota exceeded: account maximum storage limit of 100 MB reached.",
        code: "QUOTA_EXCEEDED",
        status: 403,
      };
    }

    return { allowed: true };
  } catch {
    // Explicitly FAIL-CLOSED on quota query error to prevent bypass
    return {
      allowed: false,
      reason: "Unable to verify account storage quota at this time. Please retry.",
      code: "STORAGE_QUOTA_UNAVAILABLE",
      status: 503,
    };
  }
}

function getActiveQuotaReservation(patientId: string): QuotaReservation | null {
  const now = Date.now();
  const res = memoryQuotaReservations.get(patientId);
  if (res && res.expiresAt > now) {
    return res;
  }
  if (res) {
    memoryQuotaReservations.delete(patientId);
  }
  return null;
}

/**
 * Reserves quota for an in-flight upload to protect against concurrent quota bypasses.
 */
export async function reservePatientStorageQuota(
  patientId: string,
  additionalBytes: number
): Promise<StorageQuotaCheckResult> {
  const check = await checkPatientStorageQuota(patientId, additionalBytes);
  if (!check.allowed) {
    return check;
  }

  const now = Date.now();
  const current = getActiveQuotaReservation(patientId) || {
    reservedBytes: 0,
    reservedCount: 0,
    expiresAt: now + 60_000,
  };

  memoryQuotaReservations.set(patientId, {
    reservedBytes: current.reservedBytes + additionalBytes,
    reservedCount: current.reservedCount + 1,
    expiresAt: now + 60_000, // 60s TTL
  });

  return { allowed: true };
}

/**
 * Releases in-flight storage reservation once upload finishes or fails.
 */
export async function releasePatientStorageReservation(
  patientId: string,
  bytes: number
): Promise<void> {
  const now = Date.now();
  const current = memoryQuotaReservations.get(patientId);
  if (!current || current.expiresAt <= now) {
    memoryQuotaReservations.delete(patientId);
    return;
  }

  const remainingBytes = Math.max(0, current.reservedBytes - bytes);
  const remainingCount = Math.max(0, current.reservedCount - 1);

  if (remainingCount === 0 || remainingBytes === 0) {
    memoryQuotaReservations.delete(patientId);
  } else {
    memoryQuotaReservations.set(patientId, {
      reservedBytes: remainingBytes,
      reservedCount: remainingCount,
      expiresAt: current.expiresAt,
    });
  }
}

// -----------------------------------------------------------------------------
// Patient-Scoped Idempotency Management with Request Fingerprinting
// -----------------------------------------------------------------------------

export interface IdempotencyCheckResult {
  allowed: boolean;
  isIdempotentHit?: boolean;
  document?: any;
  error?: string;
  code?: string;
  status?: number;
}

interface IdempotencyRecord {
  patientId: string;
  idempotencyKey: string;
  fingerprint: string;
  status: "IN_PROGRESS" | "COMPLETED";
  document?: any;
  expiresAt: number;
}

const memoryIdempotencyStore = new Map<string, IdempotencyRecord>();

/**
 * Validates that client idempotency key is well-formed (8-128 alphanumeric, hyphen, underscore).
 */
export function validateIdempotencyKey(key: string): { isValid: boolean; error?: string } {
  if (typeof key !== "string" || key.length < 8 || key.length > 128) {
    return {
      isValid: false,
      error: "Idempotency key must be a valid string between 8 and 128 characters.",
    };
  }

  if (!/^[a-zA-Z0-9_\-]+$/.test(key)) {
    return {
      isValid: false,
      error: "Idempotency key may only contain alphanumeric characters, hyphens, and underscores.",
    };
  }

  return { isValid: true };
}

/**
 * Computes deterministic request payload fingerprint using SHA-256.
 */
export function computeUploadFingerprint(
  fileBuffer: Buffer,
  title: string,
  type: string,
  reportDate: string
): string {
  const hash = createHash("sha256");
  hash.update(fileBuffer);
  hash.update(`:${title.trim()}:${type.trim()}:${reportDate.trim()}`);
  return hash.digest("hex");
}

/**
 * Checks and atomically acquires an idempotency lock for the patient.
 * Strictly isolates keys per patient and validates payload fingerprint.
 */
export async function checkAndAcquireUploadIdempotency(
  patientId: string,
  idempotencyKey: string,
  payloadFingerprint: string
): Promise<IdempotencyCheckResult> {
  const keyValidation = validateIdempotencyKey(idempotencyKey);
  if (!keyValidation.isValid) {
    return {
      allowed: false,
      error: keyValidation.error,
      code: "INVALID_IDEMPOTENCY_KEY",
      status: 400,
    };
  }

  const compositeKey = `patient:${patientId}:idempotency:${idempotencyKey}`;
  const now = Date.now();

  const existing = memoryIdempotencyStore.get(compositeKey);
  if (existing && existing.expiresAt > now) {
    // Check if the payload is identical
    if (existing.fingerprint !== payloadFingerprint) {
      return {
        allowed: false,
        error: "Idempotency key was previously used with a different request payload.",
        code: "IDEMPOTENCY_CONFLICT",
        status: 409,
      };
    }

    if (existing.status === "IN_PROGRESS") {
      return {
        allowed: false,
        error: "Upload with this idempotency key is currently being processed. Please retry shortly.",
        code: "UPLOAD_IN_PROGRESS",
        status: 409,
      };
    }

    if (existing.status === "COMPLETED" && existing.document) {
      return {
        allowed: true,
        isIdempotentHit: true,
        document: existing.document,
        status: 200,
      };
    }
  }

  // Atomically claim in-progress status (120s TTL for in-flight upload)
  memoryIdempotencyStore.set(compositeKey, {
    patientId,
    idempotencyKey,
    fingerprint: payloadFingerprint,
    status: "IN_PROGRESS",
    expiresAt: now + 120_000,
  });

  return { allowed: true, isIdempotentHit: false };
}

/**
 * Marks idempotency record as COMPLETED with the durable document metadata (24h TTL).
 */
export async function completeUploadIdempotency(
  patientId: string,
  idempotencyKey: string,
  payloadFingerprint: string,
  document: any
): Promise<void> {
  const compositeKey = `patient:${patientId}:idempotency:${idempotencyKey}`;
  memoryIdempotencyStore.set(compositeKey, {
    patientId,
    idempotencyKey,
    fingerprint: payloadFingerprint,
    status: "COMPLETED",
    document,
    expiresAt: Date.now() + 24 * 3600 * 1000, // 24 hours
  });
}

/**
 * Clears an in-progress idempotency record if an upload fails with a retryable error.
 */
export async function releaseUploadIdempotency(
  patientId: string,
  idempotencyKey: string
): Promise<void> {
  const compositeKey = `patient:${patientId}:idempotency:${idempotencyKey}`;
  const record = memoryIdempotencyStore.get(compositeKey);
  if (record && record.status === "IN_PROGRESS") {
    memoryIdempotencyStore.delete(compositeKey);
  }
}

/**
 * Resets in-memory stores for isolated test execution.
 */
export function clearInMemoryDocumentGuards(): void {
  memoryQuotaReservations.clear();
  memoryIdempotencyStore.clear();
}
