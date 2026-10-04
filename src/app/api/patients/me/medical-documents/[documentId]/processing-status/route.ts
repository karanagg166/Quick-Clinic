import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser } from "@/lib/auth";
import { getMedicalDocumentProcessingStatus } from "@/lib/search-sphere-client";
import { MedicalDocumentProcessingStatus } from "@/generated/prisma";

interface RouteParams {
  params: Promise<{
    documentId: string;
  }>;
}

export async function GET(req: NextRequest, { params }: RouteParams) {
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
        { error: "Access denied. Only patients can check document status." },
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

    // Call Search Sphere processing status API
    try {
      const statusResult = await getMedicalDocumentProcessingStatus(documentId);

      const normalizedStatus = statusResult.status.toUpperCase() as MedicalDocumentProcessingStatus;
      const validStatuses = Object.values(MedicalDocumentProcessingStatus);

      const newStatus = validStatuses.includes(normalizedStatus)
        ? normalizedStatus
        : doc.processingStatus;
      const newProcessedAt = statusResult.processedAt
        ? new Date(statusResult.processedAt)
        : doc.processedAt;
      const newError = statusResult.error ?? null;

      // Update lightweight local status in Neon if changed
      if (
        newStatus !== doc.processingStatus ||
        newError !== doc.processingError ||
        (newProcessedAt && (!doc.processedAt || newProcessedAt.getTime() !== doc.processedAt.getTime()))
      ) {
        await prisma.medicalDocument.update({
          where: { id: documentId },
          data: {
            processingStatus: newStatus,
            processingError: newError,
            processedAt: newProcessedAt,
          },
        });
      }

      return NextResponse.json(
        {
          documentId,
          status: newStatus,
          processedAt: newProcessedAt?.toISOString() ?? null,
          error: newError,
        },
        { status: 200 }
      );
    } catch {
      // If Search Sphere is unreachable or hasn't recorded it, return local DB status safely
      return NextResponse.json(
        {
          documentId,
          status: doc.processingStatus,
          processedAt: doc.processedAt?.toISOString() ?? null,
          error: doc.processingError,
        },
        { status: 200 }
      );
    }
  } catch (error: any) {
    console.error("GET medical document processing status error:", error);
    return NextResponse.json(
      { error: error?.message || "Internal server error" },
      { status: 500 }
    );
  }
}
