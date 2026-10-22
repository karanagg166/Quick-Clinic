import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser } from "@/lib/auth";
import { logAudit, logAccess } from "@/lib/logger";
import { getOrCreateRequestId } from "@/lib/correlation-id";
import {
  uploadToStorage,
  deleteFromStorage,
  queueMedicalDocumentIngestion,
  SearchSphereConfigError,
} from "@/lib/search-sphere-client";
import {
  validateFileSignature,
  sanitizeFileName,
  checkPatientUploadRateLimit,
  reservePatientStorageQuota,
  releasePatientStorageReservation,
  computeUploadFingerprint,
  checkAndAcquireUploadIdempotency,
  completeUploadIdempotency,
  releaseUploadIdempotency,
  MAX_FILE_SIZE_BYTES,
  ALLOWED_MIME_TYPES,
} from "@/lib/medical-document-validator";
import { MedicalDocumentType } from "@/generated/prisma";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const requestId = getOrCreateRequestId(req);

  try {
    const user = await getAuthenticatedUser(req, { verifyDb: true });
    if (!user) {
      return NextResponse.json(
        {
          error: "Authentication required",
          code: "UNAUTHENTICATED",
          requestId,
          retryable: false,
        },
        { status: 401 }
      );
    }

    if (user.role !== "PATIENT") {
      return NextResponse.json(
        {
          error: "Access denied. Only patients can manage medical documents.",
          code: "UNAUTHORIZED",
          requestId,
          retryable: false,
        },
        { status: 403 }
      );
    }

    let patient = await prisma.patient.findUnique({
      where: { userId: user.id },
      select: { id: true },
    });

    if (!patient) {
      patient = await prisma.patient.create({
        data: { userId: user.id },
        select: { id: true },
      });
    }

    // 0. Enforce upload rate limiting per patient account
    const rateLimit = await checkPatientUploadRateLimit(patient.id);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        {
          error: "Upload rate limit exceeded. Please wait a minute before uploading additional documents.",
          code: "RATE_LIMIT_EXCEEDED",
          requestId,
          retryable: true,
        },
        { status: 429 }
      );
    }

    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const title = (formData.get("title") as string | null)?.trim();
    const typeStr = (formData.get("type") as string | null)?.trim();
    const reportDateStr = (formData.get("reportDate") as string | null)?.trim();
    const hospitalOrDoctor =
      (formData.get("hospitalOrDoctor") as string | null)?.trim() || null;
    const notes = (formData.get("notes") as string | null)?.trim() || null;
    const idempotencyKey =
      (formData.get("idempotencyKey") as string | null)?.trim() ||
      req.headers.get("x-idempotency-key")?.trim() ||
      null;

    // 1. Validate File Existence and Basic Type
    if (!file || typeof file === "string" || !file.size) {
      return NextResponse.json(
        {
          error: "File is required and must not be empty",
          code: "EMPTY_FILE",
          requestId,
          retryable: false,
        },
        { status: 400 }
      );
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
      return NextResponse.json(
        {
          error: "File size exceeds 10 MB limit",
          code: "FILE_TOO_LARGE",
          requestId,
          retryable: false,
        },
        { status: 413 }
      );
    }

    let reportedMime = file.type?.toLowerCase() || "";
    if (reportedMime === "image/jpg") {
      reportedMime = "image/jpeg";
    }

    if (reportedMime && !ALLOWED_MIME_TYPES.has(reportedMime)) {
      return NextResponse.json(
        {
          error:
            "Unsupported file type. Only PDF, JPEG, PNG, and WebP files are allowed.",
          code: "UNSUPPORTED_FORMAT",
          requestId,
          retryable: false,
        },
        { status: 400 }
      );
    }

    // 2. Validate Title
    if (!title) {
      return NextResponse.json(
        {
          error: "Document title is required",
          code: "INVALID_METADATA",
          requestId,
          retryable: false,
        },
        { status: 400 }
      );
    }
    if (title.length > 200) {
      return NextResponse.json(
        {
          error: "Document title must not exceed 200 characters",
          code: "INVALID_METADATA",
          requestId,
          retryable: false,
        },
        { status: 400 }
      );
    }

    // 3. Validate Document Type
    if (!typeStr || !Object.values(MedicalDocumentType).includes(typeStr as any)) {
      return NextResponse.json(
        {
          error: `Invalid document type. Must be one of: ${Object.values(MedicalDocumentType).join(", ")}`,
          code: "INVALID_METADATA",
          requestId,
          retryable: false,
        },
        { status: 400 }
      );
    }
    const docType = typeStr as MedicalDocumentType;

    // 4. Validate Report Date
    if (!reportDateStr) {
      return NextResponse.json(
        {
          error: "Report date is required",
          code: "INVALID_METADATA",
          requestId,
          retryable: false,
        },
        { status: 400 }
      );
    }
    const reportDate = new Date(reportDateStr);
    if (isNaN(reportDate.getTime())) {
      return NextResponse.json(
        {
          error: "Invalid report date format",
          code: "INVALID_METADATA",
          requestId,
          retryable: false,
        },
        { status: 400 }
      );
    }

    // 5. Validate Optional Metadata
    if (hospitalOrDoctor && hospitalOrDoctor.length > 200) {
      return NextResponse.json(
        {
          error: "Hospital / Doctor name must not exceed 200 characters",
          code: "INVALID_METADATA",
          requestId,
          retryable: false,
        },
        { status: 400 }
      );
    }
    if (notes && notes.length > 2000) {
      return NextResponse.json(
        {
          error: "Notes must not exceed 2000 characters",
          code: "INVALID_METADATA",
          requestId,
          retryable: false,
        },
        { status: 400 }
      );
    }

    // 6. Validate Binary File Signature (Magic Bytes)
    const arrayBuffer = await file.arrayBuffer();
    const fileBuffer = Buffer.from(arrayBuffer);
    const signatureCheck = validateFileSignature(fileBuffer, reportedMime);
    if (!signatureCheck.isValid) {
      return NextResponse.json(
        {
          error: signatureCheck.error || "Invalid file content",
          code: signatureCheck.code || "FILE_SIGNATURE_MISMATCH",
          requestId,
          retryable: false,
        },
        { status: 400 }
      );
    }
    const verifiedMimeType = signatureCheck.detectedMime;

    // 7. Idempotency Check with Fingerprinting & Atomic In-Progress Claim
    let payloadFingerprint = "";
    if (idempotencyKey) {
      payloadFingerprint = computeUploadFingerprint(fileBuffer, title, docType, reportDateStr);
      const idempotencyResult = await checkAndAcquireUploadIdempotency(
        patient.id,
        idempotencyKey,
        payloadFingerprint
      );
      if (!idempotencyResult.allowed) {
        return NextResponse.json(
          {
            error: idempotencyResult.error || "Idempotency conflict",
            code: idempotencyResult.code || "IDEMPOTENCY_CONFLICT",
            requestId,
            retryable: false,
          },
          { status: idempotencyResult.status || 409 }
        );
      }
      if (idempotencyResult.isIdempotentHit && idempotencyResult.document) {
        return NextResponse.json(
          { document: idempotencyResult.document, idempotencyHit: true, requestId },
          { status: 200 }
        );
      }
    }

    // 8. Check Account Storage Quota with Fail-Closed policy and Concurrency Reservation
    const quotaReservation = await reservePatientStorageQuota(patient.id, fileBuffer.length);
    if (!quotaReservation.allowed) {
      if (idempotencyKey) {
        await releaseUploadIdempotency(patient.id, idempotencyKey);
      }
      return NextResponse.json(
        {
          error: quotaReservation.reason || "Storage quota exceeded",
          code: quotaReservation.code || "QUOTA_EXCEEDED",
          requestId,
          retryable: quotaReservation.status === 503,
        },
        { status: quotaReservation.status || 403 }
      );
    }

    // Always server-generate documentId (never accept client strings directly as PK)
    const documentId = crypto.randomUUID();
    const sanitizedFileName = sanitizeFileName(file.name);

    // 9. Call Search Sphere storage API
    let storageResult;
    try {
      const uploadBlob = new Blob([fileBuffer], { type: verifiedMimeType });
      storageResult = await uploadToStorage({
        file: uploadBlob,
        fileName: sanitizedFileName,
        patientId: patient.id,
        documentId,
      });
    } catch (storageError: any) {
      if (idempotencyKey) {
        await releaseUploadIdempotency(patient.id, idempotencyKey);
      }
      await releasePatientStorageReservation(patient.id, fileBuffer.length);

      console.error(`[${requestId}] Search Sphere storage upload failed:`, storageError);
      if (storageError instanceof SearchSphereConfigError) {
        return NextResponse.json(
          {
            error: "Document storage service is not properly configured.",
            code: "PROCESSING_SERVICE_UNAVAILABLE",
            requestId,
            retryable: false,
          },
          { status: 503 }
        );
      }
      const statusCode = storageError?.status || 502;
      const errorMessage =
        statusCode === 504
          ? "Document storage request timed out. Please try again."
          : storageError?.message || "Failed to upload document to storage";
      return NextResponse.json(
        {
          error: errorMessage,
          code: storageError?.code || (statusCode === 504 ? "GATEWAY_TIMEOUT" : "STORAGE_UNAVAILABLE"),
          requestId,
          retryable: storageError?.retryable ?? true,
        },
        { status: statusCode }
      );
    }

    // 10. Persist metadata in Neon PostgreSQL
    let createdDoc;
    try {
      createdDoc = await prisma.medicalDocument.create({
        data: {
          id: documentId,
          patientId: patient.id,
          title,
          type: docType,
          fileName: sanitizedFileName,
          mimeType: storageResult.mimeType || verifiedMimeType,
          fileSize: storageResult.fileSize || fileBuffer.length,
          storagePath: storageResult.storagePath,
          reportDate,
          hospitalOrDoctor,
          notes,
          processingStatus: "PENDING",
        },
      });
    } catch (dbError) {
      if (idempotencyKey) {
        await releaseUploadIdempotency(patient.id, idempotencyKey);
      }
      await releasePatientStorageReservation(patient.id, fileBuffer.length);

      console.error(`[${requestId}] Database metadata insert failed. Compensating storage:`, dbError);
      // Compensation: remove orphaned storage object
      try {
        await deleteFromStorage(storageResult.storagePath);
      } catch (compensateError) {
        console.error(`[${requestId}] Failed to compensate storage object deletion:`, compensateError);
      }
      return NextResponse.json(
        {
          error: "Failed to save medical document metadata",
          code: "DATABASE_ERROR",
          requestId,
          retryable: true,
        },
        { status: 500 }
      );
    }

    // Release reservation now that persistent DB metadata records the document
    await releasePatientStorageReservation(patient.id, fileBuffer.length);

    if (idempotencyKey) {
      await completeUploadIdempotency(patient.id, idempotencyKey, payloadFingerprint, createdDoc);
    }

    // 11. Trigger asynchronous Search Sphere indexing
    try {
      await queueMedicalDocumentIngestion({
        documentId: createdDoc.id,
        patientId: patient.id,
        storagePath: createdDoc.storagePath,
        fileName: createdDoc.fileName,
        mimeType: createdDoc.mimeType,
        fileSize: createdDoc.fileSize,
        documentType: createdDoc.type,
        reportDate: createdDoc.reportDate,
        requestId,
      });

      const updated = await prisma.medicalDocument.update({
        where: { id: createdDoc.id },
        data: {
          processingStatus: "QUEUED",
          processingError: null,
        },
      });
      if (updated) {
        createdDoc = updated;
      }
    } catch (ingestError: any) {
      console.error(`[${requestId}] Search Sphere ingestion queue failed:`, ingestError);
      // Important: Do NOT delete document or fail the upload. Mark FAILED so patient can still view/download and retry.
      try {
        const updated = await prisma.medicalDocument.update({
          where: { id: createdDoc.id },
          data: {
            processingStatus: "FAILED",
            processingError: ingestError?.message || "Failed to trigger ingestion pipeline",
          },
        });
        if (updated) {
          createdDoc = updated;
        }
      } catch {
        // preserve createdDoc if status update fails
      }
    }

    // 12. Audit Log
    await logAudit(
      user.id,
      "MEDICAL_DOCUMENT_UPLOAD",
      {
        documentId: createdDoc.id,
        patientId: patient.id,
        type: createdDoc.type,
        fileName: createdDoc.fileName,
        fileSize: createdDoc.fileSize,
        processingStatus: createdDoc.processingStatus,
      },
      "MEDICAL_RECORD"
    );

    return NextResponse.json({ document: createdDoc, requestId }, { status: 201 });
  } catch (error: any) {
    console.error(`[${requestId}] Unhandled medical document upload error:`, error);
    return NextResponse.json(
      {
        error: "Internal server error",
        code: "INTERNAL_ERROR",
        requestId,
        retryable: false,
      },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  try {
    const user = await getAuthenticatedUser(req, { verifyDb: true });
    if (!user) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 }
      );
    }

    if (user.role !== "PATIENT") {
      return NextResponse.json(
        { error: "Access denied. Only patients can view their documents." },
        { status: 403 }
      );
    }

    const patient = await prisma.patient.findUnique({
      where: { userId: user.id },
      select: { id: true },
    });

    if (!patient) {
      return NextResponse.json({ documents: [] }, { status: 200 });
    }

    const { searchParams } = new URL(req.url);
    const search = searchParams.get("search")?.trim();
    const type = searchParams.get("type")?.trim();
    const fileType = searchParams.get("fileType")?.trim();
    const reportDateStr = searchParams.get("reportDate")?.trim();
    const sort = searchParams.get("sort")?.trim() || "newest";

    const where: any = {
      patientId: patient.id,
    };

    // Filter: document type
    if (type && type !== "ALL" && Object.values(MedicalDocumentType).includes(type as any)) {
      where.type = type;
    }

    // Filter: file type (PDF vs Image)
    if (fileType === "PDF") {
      where.mimeType = "application/pdf";
    } else if (fileType === "IMAGE") {
      where.mimeType = {
        in: ["image/jpeg", "image/png", "image/webp"],
      };
    }

    // Filter: report date
    if (reportDateStr) {
      const parsedDate = new Date(reportDateStr);
      if (!isNaN(parsedDate.getTime())) {
        const startOfDay = new Date(parsedDate);
        startOfDay.setUTCHours(0, 0, 0, 0);
        const endOfDay = new Date(parsedDate);
        endOfDay.setUTCHours(23, 59, 59, 999);
        where.reportDate = {
          gte: startOfDay,
          lte: endOfDay,
        };
      }
    }

    // Filter: search text
    if (search) {
      where.OR = [
        { title: { contains: search, mode: "insensitive" } },
        { fileName: { contains: search, mode: "insensitive" } },
        { hospitalOrDoctor: { contains: search, mode: "insensitive" } },
      ];
    }

    // Sorting
    let orderBy: any = { reportDate: "desc" };
    if (sort === "oldest") {
      orderBy = { reportDate: "asc" };
    } else if (sort === "name_asc") {
      orderBy = { title: "asc" };
    } else if (sort === "name_desc") {
      orderBy = { title: "desc" };
    }

    const documents = await prisma.medicalDocument.findMany({
      where,
      orderBy,
    });

    // Access Log for listing own medical documents
    await logAccess(
      user.id,
      patient.id,
      "MEDICAL_DOCUMENT_LIST",
      "MEDICAL_RECORD"
    );

    return NextResponse.json({ documents }, { status: 200 });
  } catch (error: any) {
    console.error("GET medical documents error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
