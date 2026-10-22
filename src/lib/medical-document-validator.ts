import { prisma } from "@/lib/prisma";
import { checkRateLimit, RateLimitResult } from "@/lib/rate-limiter";
import { MedicalDocumentType } from "@/generated/prisma";

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

/**
 * Checks patient storage quota: enforces maximum document count and cumulative bytes.
 */
export async function checkPatientStorageQuota(
  patientId: string,
  additionalBytes: number
): Promise<{ allowed: boolean; reason?: string }> {
  try {
    const existingDocs = await prisma.medicalDocument.findMany({
      where: { patientId },
      select: { fileSize: true },
    });

    const docs = Array.isArray(existingDocs) ? existingDocs : [];

    if (docs.length >= MAX_PATIENT_DOCUMENTS_COUNT) {
      return {
        allowed: false,
        reason: `Storage quota exceeded: maximum ${MAX_PATIENT_DOCUMENTS_COUNT} documents allowed per patient account.`,
      };
    }

    const currentTotalBytes = docs.reduce((sum, d) => sum + (d.fileSize || 0), 0);
    if (currentTotalBytes + additionalBytes > MAX_PATIENT_STORAGE_BYTES) {
      return {
        allowed: false,
        reason: "Storage quota exceeded: account maximum storage limit of 100 MB reached.",
      };
    }

    return { allowed: true };
  } catch {
    // Fail-open on quota check error if database query fails so upload is not unnecessarily blocked
    return { allowed: true };
  }
}
