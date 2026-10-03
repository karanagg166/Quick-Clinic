import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser } from "@/lib/auth";
import { logAudit } from "@/lib/logger";
import { deleteFromStorage } from "@/lib/search-sphere-client";
import { MedicalDocumentType } from "@/generated/prisma";

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
        { error: "Access denied. Only patients can view their documents." },
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

    return NextResponse.json({ document: doc }, { status: 200 });
  } catch (error: any) {
    console.error("GET medical document by ID error:", error);
    return NextResponse.json(
      { error: error?.message || "Internal server error" },
      { status: 500 }
    );
  }
}

export async function PATCH(req: NextRequest, { params }: RouteParams) {
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
        { error: "Access denied. Only patients can edit their documents." },
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

    const existingDoc = await prisma.medicalDocument.findUnique({
      where: { id: documentId },
    });

    if (!existingDoc) {
      return NextResponse.json(
        { error: "Medical document not found" },
        { status: 404 }
      );
    }

    // IDOR check: document must belong to authenticated patient
    if (existingDoc.patientId !== patient.id) {
      return NextResponse.json(
        { error: "Medical document not found or access denied" },
        { status: 404 }
      );
    }

    const body = await req.json();
    const updateData: any = {};
    const updatedFields: string[] = [];

    // Explicitly reject tampering with immutable identifiers/storage properties
    if (
      body.patientId !== undefined &&
      body.patientId !== existingDoc.patientId
    ) {
      return NextResponse.json(
        { error: "Modifying patientId is not permitted." },
        { status: 400 }
      );
    }
    if (
      body.storagePath !== undefined &&
      body.storagePath !== existingDoc.storagePath
    ) {
      return NextResponse.json(
        { error: "Modifying storagePath is not permitted." },
        { status: 400 }
      );
    }
    if (
      body.fileSize !== undefined &&
      body.fileSize !== existingDoc.fileSize
    ) {
      return NextResponse.json(
        { error: "Modifying fileSize is not permitted." },
        { status: 400 }
      );
    }
    if (
      body.mimeType !== undefined &&
      body.mimeType !== existingDoc.mimeType
    ) {
      return NextResponse.json(
        { error: "Modifying mimeType is not permitted." },
        { status: 400 }
      );
    }

    // 1. Title update
    if (body.title !== undefined) {
      const title = String(body.title).trim();
      if (!title) {
        return NextResponse.json(
          { error: "Title cannot be empty" },
          { status: 400 }
        );
      }
      if (title.length > 200) {
        return NextResponse.json(
          { error: "Title cannot exceed 200 characters" },
          { status: 400 }
        );
      }
      updateData.title = title;
      updatedFields.push("title");
    }

    // 2. Type update
    if (body.type !== undefined) {
      const typeStr = String(body.type).trim();
      if (!Object.values(MedicalDocumentType).includes(typeStr as any)) {
        return NextResponse.json(
          {
            error: `Invalid document type. Must be one of: ${Object.values(MedicalDocumentType).join(", ")}`,
          },
          { status: 400 }
        );
      }
      updateData.type = typeStr as MedicalDocumentType;
      updatedFields.push("type");
    }

    // 3. Report date update
    if (body.reportDate !== undefined) {
      const parsedDate = new Date(body.reportDate);
      if (isNaN(parsedDate.getTime())) {
        return NextResponse.json(
          { error: "Invalid report date format" },
          { status: 400 }
        );
      }
      updateData.reportDate = parsedDate;
      updatedFields.push("reportDate");
    }

    // 4. Hospital or Doctor update
    if (body.hospitalOrDoctor !== undefined) {
      const docStr =
        body.hospitalOrDoctor !== null
          ? String(body.hospitalOrDoctor).trim()
          : null;
      if (docStr && docStr.length > 200) {
        return NextResponse.json(
          { error: "Hospital / Doctor name cannot exceed 200 characters" },
          { status: 400 }
        );
      }
      updateData.hospitalOrDoctor = docStr || null;
      updatedFields.push("hospitalOrDoctor");
    }

    // 5. Notes update
    if (body.notes !== undefined) {
      const notesStr =
        body.notes !== null ? String(body.notes).trim() : null;
      if (notesStr && notesStr.length > 2000) {
        return NextResponse.json(
          { error: "Notes cannot exceed 2000 characters" },
          { status: 400 }
        );
      }
      updateData.notes = notesStr || null;
      updatedFields.push("notes");
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json(
        { document: existingDoc, message: "No fields modified" },
        { status: 200 }
      );
    }

    const updatedDoc = await prisma.medicalDocument.update({
      where: { id: documentId },
      data: updateData,
    });

    // Audit Log
    await logAudit(
      user.id,
      "MEDICAL_DOCUMENT_UPDATE",
      {
        documentId: updatedDoc.id,
        patientId: patient.id,
        updatedFields,
      },
      "MEDICAL_DOCUMENT"
    );

    return NextResponse.json({ document: updatedDoc }, { status: 200 });
  } catch (error: any) {
    console.error("PATCH medical document error:", error);
    return NextResponse.json(
      { error: error?.message || "Internal server error" },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest, { params }: RouteParams) {
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
        { error: "Access denied. Only patients can delete their documents." },
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

    const existingDoc = await prisma.medicalDocument.findUnique({
      where: { id: documentId },
    });

    if (!existingDoc) {
      return NextResponse.json(
        { error: "Medical document not found" },
        { status: 404 }
      );
    }

    // IDOR check: document must belong to authenticated patient
    if (existingDoc.patientId !== patient.id) {
      return NextResponse.json(
        { error: "Medical document not found or access denied" },
        { status: 404 }
      );
    }

    // 1. Delete object from storage via Search Sphere
    try {
      await deleteFromStorage(existingDoc.storagePath);
    } catch (storageError: any) {
      console.error(
        "Failed to delete medical document from storage service:",
        storageError
      );
      return NextResponse.json(
        {
          error:
            "Failed to delete document from object storage. Metadata was not deleted to preserve data integrity.",
          details: storageError.message,
        },
        { status: 502 }
      );
    }

    // 2. Delete metadata in Neon PostgreSQL
    await prisma.medicalDocument.delete({
      where: { id: documentId },
    });

    // 3. Audit Log
    await logAudit(
      user.id,
      "MEDICAL_DOCUMENT_DELETE",
      {
        documentId,
        patientId: patient.id,
        storagePath: existingDoc.storagePath,
        fileName: existingDoc.fileName,
      },
      "MEDICAL_DOCUMENT"
    );

    return NextResponse.json(
      { success: true, message: "Medical document deleted successfully" },
      { status: 200 }
    );
  } catch (error: any) {
    console.error("DELETE medical document error:", error);
    return NextResponse.json(
      { error: error?.message || "Internal server error" },
      { status: 500 }
    );
  }
}
