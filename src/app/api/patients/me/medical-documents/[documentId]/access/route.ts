import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser } from "@/lib/auth";
import { logAccess } from "@/lib/logger";
import { getSignedStorageUrl } from "@/lib/search-sphere-client";

interface RouteParams {
  params: Promise<{
    documentId: string;
  }>;
}

export async function GET(req: NextRequest, { params }: RouteParams) {
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
        { error: "Access denied. Only patients can access their documents." },
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

    // IDOR check: document must belong to authenticated patient
    if (doc.patientId !== patient.id) {
      return NextResponse.json(
        { error: "Medical document not found or access denied" },
        { status: 404 }
      );
    }

    // Call Search Sphere to generate a short-lived signed URL (default 10 min = 600 seconds)
    let signedResult;
    try {
      signedResult = await getSignedStorageUrl(doc.storagePath, 600);
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

    // Access Log for document viewing/downloading
    const { searchParams } = new URL(req.url);
    const actionQuery = searchParams.get("action")?.toLowerCase();
    const actionName =
      actionQuery === "download"
        ? "MEDICAL_DOCUMENT_DOWNLOAD"
        : "MEDICAL_DOCUMENT_VIEW";

    // Strictly log identifiers only - no signed URLs or file content
    await logAccess(
      user.id,
      doc.id,
      actionName,
      "MEDICAL_RECORD"
    );

    return NextResponse.json(
      {
        url: signedResult.url,
        expiresIn: signedResult.expiresIn,
      },
      { status: 200 }
    );
  } catch (error: any) {
    console.error("GET signed URL access error:", error);
    return NextResponse.json(
      { error: error?.message || "Internal server error" },
      { status: 500 }
    );
  }
}
