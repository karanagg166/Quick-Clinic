import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser } from "@/lib/auth";
import { logAudit } from "@/lib/logger";
import { retryMedicalDocumentIngestion } from "@/lib/search-sphere-client";

interface RouteParams {
  params: Promise<{
    documentId: string;
  }>;
}

export async function POST(req: NextRequest, { params }: RouteParams) {
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
        { error: "Access denied. Only patients can retry document processing." },
        { status: 403 }
      );
    }

    const { documentId } = await params;
    if (!documentId) {
      return NextResponse.json(
        { error: "Document ID is required" },
        { status: 400 }
      );
    }

    const patient = await prisma.patient.findUnique({
      where: { userId: user.id },
      select: { id: true },
    });

    if (!patient) {
      return NextResponse.json(
        { error: "Patient record not found" },
        { status: 404 }
      );
    }

    const doc = await prisma.medicalDocument.findUnique({
      where: { id: documentId },
    });

    if (!doc) {
      return NextResponse.json(
        { error: "Medical document not found" },
        { status: 404 }
      );
    }

    // IDOR verification: verify document belongs to authenticated patient
    if (doc.patientId !== patient.id) {
      return NextResponse.json(
        { error: "Medical document not found or access denied" },
        { status: 404 }
      );
    }

    // Call Search Sphere ingestion endpoint to re-enqueue
    try {
      await retryMedicalDocumentIngestion({
        documentId: doc.id,
        patientId: patient.id,
        storagePath: doc.storagePath,
        fileName: doc.fileName,
        mimeType: doc.mimeType,
        fileSize: doc.fileSize,
        documentType: doc.type,
        reportDate: doc.reportDate,
      });

      // Update local state to QUEUED
      const updatedDoc = await prisma.medicalDocument.update({
        where: { id: doc.id },
        data: {
          processingStatus: "QUEUED",
          processingError: null,
        },
      });

      // Audit Log
      await logAudit(
        user.id,
        "MEDICAL_DOCUMENT_RETRY_PROCESSING",
        {
          documentId: doc.id,
          patientId: patient.id,
        },
        "MEDICAL_RECORD"
      );

      return NextResponse.json(
        {
          documentId: updatedDoc.id,
          status: updatedDoc.processingStatus,
          message: "Document processing re-enqueued successfully",
        },
        { status: 200 }
      );
    } catch (ingestError: any) {
      console.error("Retry ingestion failed:", ingestError);
      return NextResponse.json(
        {
          error: ingestError?.message || "Failed to re-enqueue document processing",
        },
        { status: 502 }
      );
    }
  } catch (error: any) {
    console.error("POST retry medical document processing error:", error);
    return NextResponse.json(
      { error: error?.message || "Internal server error" },
      { status: 500 }
    );
  }
}
