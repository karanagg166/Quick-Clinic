import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser } from "@/lib/auth";
import { logAudit, logAccess } from "@/lib/logger";
import {
  uploadToStorage,
  deleteFromStorage,
  queueMedicalDocumentIngestion,
} from "@/lib/search-sphere-client";
import { MedicalDocumentType } from "@/generated/prisma";

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

function sanitizeFileName(fileName: string): string {
  const base = fileName.split(/[/\\]/).pop() || "document";
  const lastDot = base.lastIndexOf(".");
  if (lastDot === -1) {
    return base.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 100);
  }
  const name = base.slice(0, lastDot).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 100);
  const ext = base.slice(lastDot + 1).replace(/[^a-zA-Z0-9]/g, "").toLowerCase().slice(0, 10);
  return `${name || "document"}.${ext}`;
}

export async function POST(req: NextRequest) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 }
      );
    }

    if (user.role !== "PATIENT") {
      return NextResponse.json(
        { error: "Access denied. Only patients can manage medical documents." },
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

    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const title = (formData.get("title") as string | null)?.trim();
    const typeStr = (formData.get("type") as string | null)?.trim();
    const reportDateStr = (formData.get("reportDate") as string | null)?.trim();
    const hospitalOrDoctor =
      (formData.get("hospitalOrDoctor") as string | null)?.trim() || null;
    const notes = (formData.get("notes") as string | null)?.trim() || null;

    // 1. Validate File
    if (!file || typeof file === "string" || !file.size) {
      return NextResponse.json(
        { error: "File is required and must not be empty" },
        { status: 400 }
      );
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
      return NextResponse.json(
        { error: "File size exceeds 10 MB limit" },
        { status: 413 }
      );
    }

    let mimeType = file.type?.toLowerCase() || "";
    if (mimeType === "image/jpg") {
      mimeType = "image/jpeg";
    }

    if (!ALLOWED_MIME_TYPES.has(mimeType)) {
      return NextResponse.json(
        {
          error:
            "Unsupported file type. Only PDF, JPEG, PNG, and WebP files are allowed.",
        },
        { status: 400 }
      );
    }

    // 2. Validate Title
    if (!title) {
      return NextResponse.json(
        { error: "Document title is required" },
        { status: 400 }
      );
    }
    if (title.length > 200) {
      return NextResponse.json(
        { error: "Document title must not exceed 200 characters" },
        { status: 400 }
      );
    }

    // 3. Validate Document Type
    if (!typeStr || !Object.values(MedicalDocumentType).includes(typeStr as any)) {
      return NextResponse.json(
        {
          error: `Invalid document type. Must be one of: ${Object.values(MedicalDocumentType).join(", ")}`,
        },
        { status: 400 }
      );
    }
    const docType = typeStr as MedicalDocumentType;

    // 4. Validate Report Date
    if (!reportDateStr) {
      return NextResponse.json(
        { error: "Report date is required" },
        { status: 400 }
      );
    }
    const reportDate = new Date(reportDateStr);
    if (isNaN(reportDate.getTime())) {
      return NextResponse.json(
        { error: "Invalid report date format" },
        { status: 400 }
      );
    }

    // 5. Validate optional metadata
    if (hospitalOrDoctor && hospitalOrDoctor.length > 200) {
      return NextResponse.json(
        { error: "Hospital / Doctor name must not exceed 200 characters" },
        { status: 400 }
      );
    }
    if (notes && notes.length > 2000) {
      return NextResponse.json(
        { error: "Notes must not exceed 2000 characters" },
        { status: 400 }
      );
    }

    const documentId = crypto.randomUUID();
    const sanitizedFileName = sanitizeFileName(file.name);

    // 6. Call Search Sphere storage API
    let storageResult;
    try {
      storageResult = await uploadToStorage({
        file,
        fileName: sanitizedFileName,
        patientId: patient.id,
        documentId,
      });
    } catch (storageError: any) {
      console.error("Search Sphere storage upload failed:", storageError);
      return NextResponse.json(
        { error: "Failed to upload document to storage" },
        { status: 502 }
      );
    }

    // 7. Persist metadata in Neon PostgreSQL
    let createdDoc;
    try {
      createdDoc = await prisma.medicalDocument.create({
        data: {
          id: documentId,
          patientId: patient.id,
          title,
          type: docType,
          fileName: sanitizedFileName,
          mimeType: storageResult.mimeType || mimeType,
          fileSize: storageResult.fileSize || file.size,
          storagePath: storageResult.storagePath,
          reportDate,
          hospitalOrDoctor,
          notes,
        },
      });
    } catch (dbError) {
      console.error("Database metadata insert failed. Compensating storage:", dbError);
      // Compensation: remove orphaned storage object
      try {
        await deleteFromStorage(storageResult.storagePath);
      } catch (compensateError) {
        console.error("Failed to compensate storage object deletion:", compensateError);
      }
      return NextResponse.json(
        { error: "Failed to save medical document metadata" },
        { status: 500 }
      );
    }

    // 8. Trigger asynchronous Search Sphere indexing
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
      });

      createdDoc = await prisma.medicalDocument.update({
        where: { id: createdDoc.id },
        data: {
          processingStatus: "QUEUED",
          processingError: null,
        },
      });
    } catch (ingestError: any) {
      console.error("Search Sphere ingestion queue failed:", ingestError);
      // Important: Do NOT delete document or fail the upload. Mark FAILED so patient can still view/download and retry.
      createdDoc = await prisma.medicalDocument.update({
        where: { id: createdDoc.id },
        data: {
          processingStatus: "FAILED",
          processingError: ingestError?.message || "Failed to trigger ingestion pipeline",
        },
      });
    }

    // 9. Audit Log
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

    return NextResponse.json({ document: createdDoc }, { status: 201 });
  } catch (error: any) {
    console.error("Unhandled medical document upload error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  try {
    const user = await getAuthenticatedUser(req);
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
