import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser } from "@/lib/auth";
import { logAccess, logAudit } from "@/lib/logger";
import { verifyDoctorPatientMedicalAccess } from "@/lib/medical-record-access";
import { getSignedStorageUrl } from "@/lib/search-sphere-client";

interface RouteParams {
  params: Promise<{
    patientId: string;
    documentId: string;
  }>;
}

export async function GET(req: NextRequest, { params }: RouteParams) {
  try {
    const authUser = await getAuthenticatedUser(req);
    if (!authUser) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 }
      );
    }

    if (authUser.role !== "DOCTOR") {
      return NextResponse.json(
        { error: "Access denied. Only doctors can access this endpoint." },
        { status: 403 }
      );
    }

    const { patientId, documentId } = await params;
    if (!patientId || !documentId) {
      return NextResponse.json(
        { error: "Patient ID and Document ID are required" },
        { status: 400 }
      );
    }

    const doctor = await prisma.doctor.findUnique({
      where: { userId: authUser.id },
      select: { id: true },
    });

    if (!doctor) {
      return NextResponse.json(
        { error: "Doctor profile not found" },
        { status: 404 }
      );
    }

    // 1. Server-side appointment authorization
    const accessCheck = await verifyDoctorPatientMedicalAccess(doctor.id, patientId);
    if (!accessCheck.allowed) {
      await logAudit(
        authUser.id,
        "MEDICAL_DOCUMENT_ACCESS_DENIED",
        {
          patientId,
          documentId,
          doctorId: doctor.id,
          reason: accessCheck.reason || "NO_ELIGIBLE_APPOINTMENT",
        },
        "MEDICAL_RECORD"
      );

      return NextResponse.json(
        { error: "Access denied. You do not have an active or completed appointment with this patient." },
        { status: 403 }
      );
    }

    // 2. IDOR Protection: Query document ensuring it matches documentId AND patientId
    const document = await prisma.medicalDocument.findFirst({
      where: {
        id: documentId,
        patientId: patientId,
      },
      select: {
        id: true,
        patientId: true,
        title: true,
        fileName: true,
        mimeType: true,
        fileSize: true,
        storagePath: true,
      },
    });

    if (!document) {
      await logAudit(
        authUser.id,
        "MEDICAL_DOCUMENT_ACCESS_DENIED",
        {
          patientId,
          documentId,
          doctorId: doctor.id,
          reason: "DOCUMENT_NOT_FOUND_OR_PATIENT_MISMATCH",
        },
        "MEDICAL_RECORD"
      );

      return NextResponse.json(
        { error: "Medical document not found or access denied" },
        { status: 404 }
      );
    }

    // 3. Request temporary signed URL via Search Sphere backend
    let signedResult;
    try {
      signedResult = await getSignedStorageUrl(document.storagePath, 600);
    } catch (storageError: any) {
      console.error("Failed to generate signed URL from Search Sphere:", storageError);
      return NextResponse.json(
        {
          error: "Failed to generate temporary document access link",
          details: storageError.message,
        },
        { status: 502 }
      );
    }

    // 4. Log Access: distinguish between view and download
    const { searchParams } = new URL(req.url);
    const actionQuery = searchParams.get("action")?.toLowerCase();
    const actionName =
      actionQuery === "download"
        ? "MEDICAL_DOCUMENT_DOWNLOAD"
        : "MEDICAL_DOCUMENT_VIEW";

    // Strictly log identifiers only - no signed URLs or file content
    await logAccess(
      authUser.id,
      document.id,
      actionName,
      "MEDICAL_RECORD"
    );

    return NextResponse.json(
      {
        url: signedResult.url,
        expiresIn: signedResult.expiresIn,
        document: {
          id: document.id,
          title: document.title,
          fileName: document.fileName,
          mimeType: document.mimeType,
          fileSize: document.fileSize,
        },
      },
      { status: 200 }
    );
  } catch (error: any) {
    console.error("Failed to generate doctor medical document access link:", error);
    return NextResponse.json(
      { error: error?.message || "Internal server error" },
      { status: 500 }
    );
  }
}
